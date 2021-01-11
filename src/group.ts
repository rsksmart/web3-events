import { Eth } from 'web3-eth'
import { Sema } from 'async-sema'
import Emittery from 'emittery'
import { EventLog } from 'web3-core'

import {
  Batch,
  EventsEmitterEmptyEvents,
  GroupEmitterOptions,
  Logger,
  NEW_EVENT_EVENT_NAME,
  EventsFetcher,
  ManualEventsEmitterEventsNames,
  FetchOptions,
  REORG_EVENT_NAME,
  REORG_OUT_OF_RANGE_EVENT_NAME,
  INVALID_CONFIRMATION_EVENT_NAME, NEW_CONFIRMATION_EVENT_NAME, PROGRESS_EVENT_NAME, WrapWithName
} from './definitions'
import { initLogger, cumulateIterations, passTroughEvents } from './utils'
import { BlockTracker } from './block-tracker'
import { Web3Events } from './index'

function compareEvents (event1: EventLog, event2: EventLog): number {
  // First by block number
  if (event1.blockNumber !== event2.blockNumber) return event1.blockNumber - event2.blockNumber

  // Then by transaction index
  if (event1.transactionIndex !== event2.transactionIndex) return event1.transactionIndex - event2.transactionIndex

  return event1.logIndex - event2.logIndex
}

/**
 * Function that for given iterators that emits Batch (eq. EventsEmitters.fetch()), will fetch Batches for each
 * iteration, orders them and emit it in single batch.
 *
 * @param emittersIterators
 * @param bufferAllBatches Flag that will fetch all emitter's events and emit them in one Batch. Should not be used for big data!
 */
export async function * fetchBatches<E extends EventLog> (emittersIterators: AsyncIterableIterator<Batch<E>>[], bufferAllBatches = false): AsyncIterableIterator<Batch<E>> {
  while (true) {
    const [stillIterating, batches] = await cumulateIterations<Batch<E>>(emittersIterators, bufferAllBatches)

    // With bufferAllBatches we get both stillIterating false, but data in batches
    if ((!stillIterating && !bufferAllBatches) || (bufferAllBatches && !batches.length)) {
      return
    }

    const events = batches
      .map(batch => {
      // Make sure that the batches are in sync, but only if we are not buffering them all
        if (!bufferAllBatches && (batch.stepFromBlock !== batches[0].stepFromBlock || batch.stepToBlock !== batches[0].stepToBlock)) {
          throw new Error(`Batches are out of sync! From: ${batch.stepFromBlock} != ${batches[0].stepFromBlock} or ${batch.stepToBlock} != ${batches[0].stepToBlock}`)
        }
        return batch.events
      })
      .reduce((previousValue, currentValue) => {
        previousValue.push(...currentValue)
        return previousValue
      }, [])
      .sort(compareEvents)

    yield {
      stepsComplete: batches[0].stepsComplete,
      totalSteps: batches[0].totalSteps,
      stepFromBlock: batches[0].stepFromBlock,
      stepToBlock: batches[0].stepToBlock,
      events
    }
  }
}

/**
 * EventsFetcher implementation that takes other Emitters and group then under one Emitter.
 * The Emitters have to have same `batchSize`, `confirmations` and must not have any `newEvent` listeners (in `AutoEventsEmitter` case).
 *
 * Also supports ordering of events across the emitters based on the blockchain's blockNumber, transactionIndex and logIndex values.
 *
 * It re-emits events from the Emitters, but the data of the events are wrapped in object: { name: string, data: any}
 * Where `name` is the name of the Emitter and that `data` is data passed into the `emit` function.
 */
export class GroupEventsEmitter<E extends EventLog> extends Emittery.Typed<WrapWithName<ManualEventsEmitterEventsNames>, EventsEmitterEmptyEvents> implements EventsFetcher<E> {
  private readonly emitters: EventsFetcher<E>[]
  private readonly orderedProcessing?: boolean
  private readonly eth: Eth
  private readonly semaphore: Sema
  private readonly logger: Logger
  private readonly groupName: string

  constructor (eth: Eth, emitters: EventsFetcher<any>[], options?: GroupEmitterOptions) {
    super()
    this.eth = eth
    this.emitters = emitters
    this.orderedProcessing = options?.orderedProcessing
    this.groupName = options?.name ?? `Group(${emitters.map(emitter => emitter.name).join(', ')})`
    this.logger = initLogger(this.groupName, options?.logger)
    this.semaphore = new Sema(1) // Allow only one caller

    if (!Web3Events.isInitialized) {
      throw new Error('You have to run Web3Events.init() before creating instance!')
    }

    for (const emitter of emitters) {
      if (emitter.listenerCount(NEW_EVENT_EVENT_NAME) > 0) {
        throw new Error(`Emitter for contract ${emitter.name} has newEvent listeners!`)
      }

      if (emitter.batchSize !== emitters[0].batchSize) {
        throw new Error(`Emitter for contract ${emitter.name} has different batch size! ${emitter.batchSize} != ${emitters[0].batchSize}`)
      }

      if (emitter.confirmations !== emitters[0].confirmations) {
        throw new Error(`Emitter for contract ${emitter.name} has different confirmations! ${emitter.confirmations} != ${emitters[0].confirmations}`)
      }

      // TODO: Awaiting resolution of https://github.com/sindresorhus/emittery/issues/63
      // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
      // @ts-ignore
      emitter.on(Emittery.listenerAdded, ({ eventName }: Emittery.ListenerChangedData) => {
        if (eventName === NEW_EVENT_EVENT_NAME) {
          this.logger.error(`newEvent listener was attached to emitter for contract ${emitter.name}! That is not allowed!`)
          throw new Error('It is not allowed EventsEmitter which was grouped to have newEvent handler!')
        }
      })

      passTroughEvents(emitter, this,
        [
          'error',
          REORG_EVENT_NAME,
          REORG_OUT_OF_RANGE_EVENT_NAME,
          INVALID_CONFIRMATION_EVENT_NAME,
          NEW_CONFIRMATION_EVENT_NAME,
          PROGRESS_EVENT_NAME
        ], emitter.name)
    }
  }

  async * fetch (options: FetchOptions = {}): AsyncIterableIterator<Batch<E>> {
    this.logger.verbose('Acquiring lock for fetch()')

    if (this.semaphore.nrWaiting() > 0) {
      this.logger.warn(`There is multiple fetch() call queued up! Count: ${this.semaphore.nrWaiting()}`)
    }

    await this.semaphore.acquire()
    this.logger.verbose('Lock acquired for fetch()')

    try {
      options.currentBlock = options?.currentBlock ?? await this.eth.getBlock('latest')

      // Order of events does not matter, lets pass through batches from all the emitters
      // without any limitations / orderings etc.
      if (!this.orderedProcessing) {
        this.logger.verbose('Processing without ordering.')
        for (const emitter of this.emitters) {
          yield * emitter.fetch(options)
        }

        return
      }

      this.logger.verbose('Processing WITH ordering.')
      const syncPoint = this.findSyncPoint()

      if (syncPoint) {
        this.logger.verbose(`Emitters out of sync! Syncing to block ${syncPoint}`)

        const iterators = this.emitters.map(emitter => emitter.fetch({ ...options, toBlockNumber: syncPoint as number }))

        // This will yield only one batch with all batches up to the syncPoint grouped into the one batch.
        // BatchSize is not honored here.
        yield * fetchBatches(iterators, true)
      }

      // Normal processing of batches
      this.logger.verbose('Fetching and ordering expected blocks')
      const iterators = this.emitters.map(emitter => emitter.fetch(options))
      yield * fetchBatches(iterators)
    } finally {
      this.semaphore.release()
    }
  }

  /**
   * Search for synchronization point.
   *
   * If the emitters are not in sync (eq. all of them have same lastFetchedBlock), then
   * the sync point is defined as the furthest lastFetchedBlock (eq. highest block number).
   *
   * Undefined is valid value, which means that the emitter has never fetched any events.
   * It can't be returned as sync point, because it is a starting value and if sync is needed then it has to be
   * some "higher" number.
   *
   * If all emitter's lastFetchedBlock are undefined than no emitter yet fetched events and
   * there is no need of syncing.
   *
   * @private
   * @returns false if no need to sync or a number that is the sync point.
   */
  private findSyncPoint (): number | boolean {
    let syncNeeded = false
    let point: number | undefined = this.emitters[0].blockTracker.getLastFetchedBlock()[0]

    for (const emitter of this.emitters) {
      const lastFetchedBlockNumber = emitter.blockTracker.getLastFetchedBlock()[0]

      if (point !== lastFetchedBlockNumber) {
        this.logger.debug(`Emitter ${emitter.name} out of sync (${lastFetchedBlockNumber} !== ${point})`)
        syncNeeded = true

        if (point === undefined || (lastFetchedBlockNumber !== undefined && point < lastFetchedBlockNumber)) {
          point = lastFetchedBlockNumber
        }
      }
    }

    if (syncNeeded) {
      return point as number
    }

    return false
  }

  public get name (): string {
    return this.groupName
  }

  public get blockTracker (): BlockTracker {
    throw new Error('GroupEventsEmitter does not support getting its BlockTracker instance!')
  }

  /**
   * All Emitters has to have the same batchSize so we can return just the first one
   */
  public get batchSize (): number {
    return this.emitters[0].batchSize
  }

  /**
   * All Emitters has to have the same confirmations so we can return just the first one
   */
  public get confirmations (): number {
    return this.emitters[0].confirmations
  }
}
