import { PastEventOptions } from 'web3-eth-contract'
import { Sema } from 'async-sema'
import type { BlockHeader, Eth } from 'web3-eth'
import { EventLog } from 'web3-core'

import Emittery from 'emittery'

import { Contract } from './contract'
import { Event } from './event.model'
import {
  ManualEventsEmitterEventsNames, EventsEmitterEmptyEvents,
  ManualEventsEmitterOptions,
  Logger,
  REORG_EVENT_NAME, REORG_OUT_OF_RANGE_EVENT_NAME, PROGRESS_EVENT_NAME, Batch, EventsFetcher, FetchOptions
} from './definitions'
import { hashTopics, initLogger, split } from './utils'
import { ModelConfirmator } from './confirmator'
import type { BlockTracker } from './block-tracker'
import type { EventInterface } from './event.model'
import { Web3Events } from './index'

const DEFAULT_BATCH_SIZE = 120 // 120 blocks = RSK one hour of blocks

/**
 * EventsEmitter implementation where you have to manually call fetch() function to get events.
 * It still supports emitting of all events like AutoEventsEmitter excecept the 'newEvent' with events.
 * It supports block's confirmation, where new events are stored to DB and only after configured number of new
 * blocks are emitted to consumers for further processing.
 */
export class ManualEventsEmitter<E extends EventLog> extends Emittery.Typed<ManualEventsEmitterEventsNames, EventsEmitterEmptyEvents> implements EventsFetcher<E> {
  protected readonly tracker: BlockTracker
  protected readonly contract: Contract
  protected readonly startingBlock: number
  protected readonly eventNames?: string[]
  protected readonly eth: Eth
  protected readonly semaphore: Sema
  protected readonly topics?: (string[] | string)[]
  protected readonly logger: Logger
  private confirmator?: ModelConfirmator<E>
  public readonly batchSize: number
  public readonly confirmations: number

  constructor (eth: Eth, contract: Contract, blockTracker: BlockTracker, baseLogger: Logger, options?: ManualEventsEmitterOptions) {
    super()
    this.logger = initLogger('', baseLogger)
    this.eth = eth
    this.contract = contract
    this.eventNames = options?.events
    this.startingBlock = options?.startingBlock ?? 0
    this.confirmations = options?.confirmations ?? 0
    this.topics = hashTopics(options?.topics)
    this.batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE
    this.semaphore = new Sema(1) // Allow only one caller
    this.tracker = blockTracker

    if (!Web3Events.isInitialized) {
      throw new Error('You have to run Web3Events.init() before creating instance!')
    }

    if (typeof this.startingBlock !== 'number') {
      throw new TypeError('startingBlock has to be a number!')
    }

    if (!this.topics && !this.eventNames) {
      throw new Error('You have to specify options.topics or options.events!')
    }

    if (this.confirmations > 0 && options?.confirmator !== null) {
      if (options?.confirmator instanceof ModelConfirmator) {
        this.confirmator = options?.confirmator
      } else {
        this.confirmator = new ModelConfirmator(this, eth, contract.address, this.tracker, { logger: baseLogger, ...options?.confirmator })
      }
    }
  }

  /**
   * Method that will fetch Events from the last fetched block.
   * If nothing was fetched yet, then fetching starts from configured startingBlock or genesis block.
   * If there is nothing to fetch (eq. from last call no new block was created on the chain) then nothing is yielded.
   * If there is no events fetched then empty batch is yielded anyway.
   *
   * If confirmations are enabled, then it will ALWAYS emit at least two batches, where the first
   * batches is one with all the confirmed events (even though there might be no events to be confirmed)
   * and then later on is processing the from-to range as configured with batching enabled.
   *
   * @param options
   * @param options.currentBlock: Is the latest block on a blockchain, serves as optimization if you have already the information available.
   * @param options.toBlockNumber: Number of block to which the events will be fetched to INCLUDING
   * @yields Batch object
   */
  public async * fetch (options?: FetchOptions): AsyncIterableIterator<Batch<E>> {
    this.logger.verbose('Acquiring lock for fetch()')

    if (this.semaphore.nrWaiting() > 0) {
      this.logger.warn(`There is multiple fetch() call queued up! Count: ${this.semaphore.nrWaiting()}`)
    }

    await this.semaphore.acquire()
    this.logger.verbose('Lock acquired for fetch()')
    try {
      const currentBlock = options?.currentBlock ?? await this.eth.getBlock('latest')
      const fromNumber = this.tracker.getLastFetchedBlock()[0] ?? this.startingBlock
      const toNumber = options?.toBlockNumber ?? currentBlock.number

      // Nothing new, lets fast-forward
      if (fromNumber === toNumber) {
        this.logger.verbose('Nothing new to process')
        return
      }

      if (fromNumber > toNumber) {
        throw new Error(`"from" block is bigger then "to" block (${fromNumber} > ${toNumber})`)
      }

      // Check if reorg did not happen since the last poll
      if (this.confirmations && await this.isReorg()) {
        const confirmedEvents = await this.handleReorg(currentBlock)
        if (confirmedEvents.length) {
          yield {
            totalSteps: 1,
            stepsComplete: 1,
            stepFromBlock: this.tracker.getLastFetchedBlock()[0]! - this.confirmations,
            stepToBlock: this.tracker.getLastFetchedBlock()[0]!,
            events: confirmedEvents
          }
        }
        return
      }

      // Pass through the batches
      yield * this.batchFetchAndProcessEvents(
        // +1 because fromBlock and toBlock are "or equal", eq. closed interval, so we need to avoid duplications
        // if nothing is fetched yet though then we start really from the fromNumber specified
        this.tracker.getLastFetchedBlock()[0] !== undefined ? fromNumber + 1 : fromNumber,
        toNumber,
        currentBlock
      )
    } finally {
      this.semaphore.release()
    }
  }

  /**
   * Method for processing events. It splits the events based on if they need more confirmations.
   *
   * @param events
   * @param currentBlockNumber?
   * @return Return array of events that have enough confirmation
   */
  protected async processEvents (events: E[] | E, currentBlockNumber: number): Promise<E[]> {
    if (!Array.isArray(events)) {
      events = [events]
    }

    if (this.eventNames) {
      events = events.filter(data => this.eventNames?.includes(data.event))
    }

    if (events.length === 0) {
      this.logger.info('No events to be processed.')
      return []
    }

    if (this.confirmations === 0) {
      return events
    }

    const thresholdBlock = currentBlockNumber - this.confirmations
    this.logger.verbose(`Threshold block ${thresholdBlock}`)
    const [eventsToBeEmitted, eventsToBeConfirmed] = split(events, event => event.blockNumber <= thresholdBlock)

    this.logger.info(`${eventsToBeEmitted.length} events to be emitted.`)
    this.logger.info(`${eventsToBeConfirmed.length} events to be confirmed.`)
    await Event.bulkCreate(eventsToBeConfirmed.map(this.serializeEvent.bind(this))) // Lets store them to DB

    if (eventsToBeEmitted.length > 0) {
      const lastEvent = eventsToBeEmitted[eventsToBeEmitted.length - 1]
      this.tracker.setLastProcessedBlockIfHigher(lastEvent.blockNumber, lastEvent.blockHash)
    }

    return eventsToBeEmitted
  }

  /**
   * Fetch and process events in batches.
   *
   * If confirmations are enabled, then it will ALWAYS emit at least two batches, where the first
   * batches is one with all the confirmed events (this does not currently respects the from-to range specified by parameters)
   * and then later on is processing the from-to range as configured with batching enabled.
   *
   * The interval defined by fromBlock and toBlock is closed, eq. "or equal".
   *
   * @param fromBlockNum
   * @param toBlockNum
   * @param currentBlock
   */
  protected async * batchFetchAndProcessEvents (fromBlockNum: number, toBlockNum: number, currentBlock: BlockHeader): AsyncIterableIterator<Batch<E>> {
    if (typeof fromBlockNum !== 'number' || typeof toBlockNum !== 'number') {
      throw new TypeError(`fromBlock and toBlock has to be numbers! Got from: ${fromBlockNum}; to: ${toBlockNum}`)
    }

    if (toBlockNum < fromBlockNum) {
      throw new Error('fromBlock has to be smaller then toBlock!')
    }

    const options: PastEventOptions = {}

    if (this.topics) {
      options.topics = this.topics
    }

    const startTime = process.hrtime()

    this.logger.info(`Fetching and processing events from block ${fromBlockNum} to ${toBlockNum}`)
    this.logger.debug(`Batch size is ${this.batchSize}`)

    let batchOffset = 0
    let batch = 0
    let startBatching = true
    const countOfBatches = Math.ceil((toBlockNum - fromBlockNum + 1) / this.batchSize)

    // If confirmations are enabled then first batch is with confirmed events
    // only run if this is not the first time running.
    if (this.confirmator && this.tracker.getLastFetchedBlock()[0]) {
      // TODO: This does not respects the from-to block range
      const confirmedEvents = await this.confirmator.runConfirmationsRoutine(currentBlock, toBlockNum)

      batchOffset += 1
      this.logger.verbose('Emitting Batch with Confirmed events')

      yield {
        stepsComplete: batch + 1,
        totalSteps: countOfBatches + batchOffset,
        stepFromBlock: this.tracker.getLastFetchedBlock()[0]! - this.confirmations,
        stepToBlock: this.tracker.getLastFetchedBlock()[0]!,
        events: confirmedEvents
      }

      if (confirmedEvents.length > 0) {
        const lastEvent = confirmedEvents[confirmedEvents.length - 1]
        this.tracker.setLastProcessedBlockIfHigher(lastEvent.blockNumber, lastEvent.blockHash)
      }

      this.emit(PROGRESS_EVENT_NAME, {
        stepsComplete: batch + 1,
        totalSteps: countOfBatches + batchOffset,
        stepFromBlock: this.tracker.getLastFetchedBlock()[0]! - this.confirmations,
        stepToBlock: this.tracker.getLastFetchedBlock()[0]!
      }).catch(e => this.emit('error', e))
    }

    this.logger.verbose(`Will process ${countOfBatches} batches`)

    for (; batch < countOfBatches; batch++) {
      // The first batch starts at fromBlock sharp, but the others has to start +1 to avoid reprocessing of the bordering block
      let batchFromBlock

      if (startBatching) {
        batchFromBlock = fromBlockNum
        startBatching = false
      } else {
        batchFromBlock = fromBlockNum + (batch * this.batchSize)
      }

      const batchToBlock = Math.min(batchFromBlock + this.batchSize - 1, toBlockNum)

      if (countOfBatches > 1) {
        this.logger.verbose(`Processing batch no. ${batch + 1}: from block ${batchFromBlock} to ${batchToBlock}`)
      }

      const batchToBlockHeader = await this.eth.getBlock(batchToBlock)
      const events = (await this.contract.getPastEvents('allEvents', {
        fromBlock: batchFromBlock,
        toBlock: batchToBlock,
        ...options
      })) as unknown as E[]
      this.logger.debug('Received events for the batch: ', events)

      const confirmedEvents = await this.processEvents(events, currentBlock.number)
      this.tracker.setLastFetchedBlock(batchToBlockHeader.number, batchToBlockHeader.hash)
      yield {
        stepsComplete: batch + batchOffset + 1,
        totalSteps: countOfBatches + batchOffset,
        stepFromBlock: batchFromBlock,
        stepToBlock: batchToBlock,
        events: confirmedEvents
      }

      if (confirmedEvents.length > 0) {
        const lastEvent = confirmedEvents[confirmedEvents.length - 1]
        this.tracker.setLastProcessedBlockIfHigher(lastEvent.blockNumber, lastEvent.blockHash)
      }

      this.emit(PROGRESS_EVENT_NAME, {
        stepsComplete: batch + batchOffset + 1,
        totalSteps: countOfBatches + batchOffset,
        stepFromBlock: batchFromBlock,
        stepToBlock: batchToBlock
      }).catch(e => this.emit('error', e))
    }

    const [secondsLapsed] = process.hrtime(startTime)
    this.logger.info(`Finished fetching events in ${secondsLapsed}s`)
  }

  public setConfirmator (confirmator: ModelConfirmator<E>): void {
    this.confirmator = confirmator
  }

  protected async isReorg (): Promise<boolean> {
    const [lastFetchedBlockNumber, lastFetchedBlockHash] = this.tracker.getLastFetchedBlock()

    if (!lastFetchedBlockNumber) {
      return false // Nothing was fetched yet, no point in continue
    }

    const actualLastFetchedBlock = await this.eth.getBlock(lastFetchedBlockNumber)

    if (actualLastFetchedBlock.hash === lastFetchedBlockHash) {
      return false // No reorg detected
    }
    this.logger.warn(`Reorg happening! Old hash: ${lastFetchedBlockHash}; New hash: ${actualLastFetchedBlock.hash}`)

    const [lastProcessedBlockNumber, lastProcessedBlockHash] = this.tracker.getLastProcessedBlock()

    // If is undefined than nothing was yet processed and the reorg is not affecting our service
    // as we are still awaiting for enough confirmations
    if (lastProcessedBlockNumber) {
      const actualLastProcessedBlock = await this.eth.getBlock(lastProcessedBlockNumber)

      // The reorg is happening outside our confirmation range.
      // We can't do anything about it except notify the consumer.
      if (actualLastProcessedBlock.hash !== lastProcessedBlockHash) {
        this.logger.error(`Reorg out of confirmation range! Old hash: ${lastProcessedBlockHash}; New hash: ${actualLastProcessedBlock.hash}`)
        this.emit(REORG_OUT_OF_RANGE_EVENT_NAME, lastProcessedBlockNumber).catch(e => this.emit('error', e))
      }
    }

    this.emit(REORG_EVENT_NAME).catch(e => this.emit('error', e))
    return true
  }

  protected async handleReorg (currentBlock: BlockHeader): Promise<E[]> {
    const [lastProcessedBlockNumber] = this.tracker.getLastProcessedBlock()

    const newEvents = await this.contract.getPastEvents('allEvents', {
      fromBlock: (lastProcessedBlockNumber ? lastProcessedBlockNumber + 1 : false) || this.startingBlock,
      toBlock: currentBlock.number
    }) as unknown as E[]

    await this.confirmator?.checkDroppedTransactions(newEvents)

    // Remove all events that currently awaiting confirmation
    await Event.destroy({ where: { contractAddress: this.contract.address } })
    const confirmedEvents = await this.processEvents(newEvents, currentBlock.number)
    this.tracker.setLastFetchedBlock(currentBlock.number, currentBlock.hash)
    return confirmedEvents
  }

  private serializeEvent (data: EventLog): EventInterface {
    this.logger.debug(`New ${data.event} event to be confirmed. Block ${data.blockNumber}, transaction ${data.transactionHash}`)
    return {
      blockNumber: data.blockNumber,
      transactionHash: data.transactionHash,
      contractAddress: this.contract.address,
      event: data.event,
      targetConfirmation: this.confirmations,
      content: JSON.stringify(data)
    }
  }

  public get name (): string {
    return this.contract.name
  }

  public get blockTracker (): BlockTracker {
    return this.tracker
  }
}
