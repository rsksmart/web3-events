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
  NewBlockEmitter,
  NEW_BLOCK_EVENT_NAME,
  NEW_EVENT_EVENT_NAME,
  REORG_EVENT_NAME, REORG_OUT_OF_RANGE_EVENT_NAME, PROGRESS_EVENT_NAME, Batch, AutoEventsEmitterOptions,
  INVALID_CONFIRMATION_EVENT_NAME, NEW_CONFIRMATION_EVENT_NAME, AutoEventsEmitterEventsName
} from './definitions'
import { AutoStartStopEventEmitter, errorHandler, hashTopics, initLogger, passTroughEvents, split } from './utils'
import { ModelConfirmator } from './confirmator'
import type { BlockTracker } from './block-tracker'
import type { EventInterface } from './event.model'

const DEFAULT_BATCH_SIZE = 120 // 120 blocks = RSK one hour of blocks

/**
 * EventsEmitter implementation where you have to manually call fetch() function to get events.
 * It still supports emitting of all events like AutoEventsEmitter excecept the 'newEvent' with events.
 * It supports block's confirmation, where new events are stored to DB and only after configured number of new
 * blocks are emitted to consumers for further processing.
 */
export class ManualEventsEmitter<E extends EventLog> extends Emittery.Typed<ManualEventsEmitterEventsNames, EventsEmitterEmptyEvents> {
  public readonly blockTracker: BlockTracker
  public readonly contract: Contract
  protected readonly startingBlock: number
  protected readonly eventNames?: string[]
  protected readonly eth: Eth
  protected readonly semaphore: Sema
  protected readonly confirmations: number
  protected readonly topics?: (string[] | string)[]
  protected readonly logger: Logger
  private confirmator?: ModelConfirmator<E>
  private readonly batchSize: number

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
    this.blockTracker = blockTracker

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
        this.confirmator = new ModelConfirmator(this, eth, contract.address, this.blockTracker, { baseLogger, ...options?.confirmator })
      }
    }
  }

  /**
   * Method that will fetch Events from the last fetched block.
   * If nothing was fetched yet, then fetching starts from configured startingBlock or genesis block.
   * If there is nothing to fetch (eq. from last call no new block was created on the chain) then empty array is returned.
   *
   * @param currentBlock - Is the latest block on a blockchain, serves as optimization if you have already the information available.
   * @yields Batch object
   */
  public async * fetch (currentBlock?: BlockHeader): AsyncIterableIterator<Batch<E>> {
    await this.semaphore.acquire()
    this.logger.verbose('Lock acquired for fetch()')
    try {
      const fromNumber = this.blockTracker.getLastFetchedBlock()[0] ?? this.startingBlock
      const toBlock = currentBlock ?? await this.eth.getBlock('latest')

      // Nothing new, lets fast-forward
      if (fromNumber === toBlock.number) {
        this.logger.verbose('Nothing new to process')
        return
      }

      // Check if reorg did not happen since the last poll
      if (this.confirmations && await this.isReorg()) {
        return this.handleReorg(toBlock)
      }

      // Pass through the data from batch
      yield * this.batchFetchAndProcessEvents(
        // +1 because fromBlock and toBlock are "or equal", eq. closed interval, so we need to avoid duplications
        this.blockTracker.getLastFetchedBlock()[0] !== undefined ? fromNumber + 1 : fromNumber,
        toBlock.number,
        toBlock
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
      this.blockTracker.setLastProcessedBlockIfHigher(lastEvent.blockNumber, lastEvent.blockHash)
    }

    return eventsToBeEmitted
  }

  /**
   * Fetch and process events in batches.
   * The interval defined by fromBlock and toBlock is closed, eq. "or equal".
   *
   * @param fromBlock
   * @param toBlock
   * @param currentBlock
   */
  protected async * batchFetchAndProcessEvents (fromBlock: number, toBlock: number, currentBlock: BlockHeader): AsyncIterableIterator<Batch<E>> {
    if (typeof fromBlock !== 'number' || typeof toBlock !== 'number') {
      throw new TypeError(`fromBlock and toBlock has to be numbers! Got from: ${fromBlock}; to: ${toBlock}`)
    }

    if (toBlock < fromBlock) {
      throw new Error('fromBlock has to be smaller then toBlock!')
    }

    const options: PastEventOptions = {}

    if (this.topics) {
      options.topics = this.topics
    }

    const startTime = process.hrtime()

    this.logger.info(`Fetching and processing events from block ${fromBlock} to ${toBlock}`)
    this.logger.debug(`Batch size is ${this.batchSize}`)

    let batchOffset = 0
    let batch = 0
    let startBatching = true
    const countOfBatches = Math.ceil((toBlock - fromBlock + 1) / this.batchSize)

    // If confirmations are enabled then first batch is with confirmed events
    // only run if this is not the first time running.
    if (this.confirmator && this.blockTracker.getLastFetchedBlock()[0]) {
      const confirmedEvents = await this.confirmator.runConfirmationsRoutine(currentBlock)

      if (confirmedEvents.length > 0) {
        batchOffset += 1
        const lastEvent = confirmedEvents[confirmedEvents.length - 1]
        this.logger.verbose('Emitting Batch with Confirmed events')

        yield {
          stepsComplete: 1,
          totalSteps: countOfBatches + batchOffset,
          stepFromBlock: this.blockTracker.getLastProcessedBlock()[0]!,
          stepToBlock: lastEvent.blockNumber,
          events: confirmedEvents
        }
        this.blockTracker.setLastProcessedBlockIfHigher(lastEvent.blockNumber, lastEvent.blockHash)

        this.emit(PROGRESS_EVENT_NAME, {
          stepsComplete: batch + 1,
          totalSteps: countOfBatches,
          stepFromBlock: this.blockTracker.getLastProcessedBlock()[0]!,
          stepToBlock: lastEvent.blockNumber
        }).catch(e => this.emit('error', e))
      }
    }

    this.logger.verbose(`Will process ${countOfBatches + batchOffset} batches`)

    for (; batch < countOfBatches; batch++) {
      // The first batch starts at fromBlock sharp, but the others has to start +1 to avoid reprocessing of the bordering block
      let batchFromBlock

      if (startBatching) {
        batchFromBlock = fromBlock
        startBatching = false
      } else {
        batchFromBlock = fromBlock + (batch * this.batchSize)
      }

      const batchToBlock = Math.min(batchFromBlock + this.batchSize - 1, toBlock)

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
      this.blockTracker.setLastFetchedBlock(batchToBlockHeader.number, batchToBlockHeader.hash)
      yield {
        stepsComplete: batch + batchOffset + 1,
        totalSteps: countOfBatches + batchOffset,
        stepFromBlock: batchFromBlock,
        stepToBlock: batchToBlock,
        events: confirmedEvents
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
    const [lastFetchedBlockNumber, lastFetchedBlockHash] = this.blockTracker.getLastFetchedBlock()

    if (!lastFetchedBlockNumber) {
      return false // Nothing was fetched yet, no point in continue
    }

    const actualLastFetchedBlock = await this.eth.getBlock(lastFetchedBlockNumber)

    if (actualLastFetchedBlock.hash === lastFetchedBlockHash) {
      return false // No reorg detected
    }
    this.logger.warn(`Reorg happening! Old hash: ${lastFetchedBlockHash}; New hash: ${actualLastFetchedBlock.hash}`)

    const [lastProcessedBlockNumber, lastProcessedBlockHash] = this.blockTracker.getLastProcessedBlock()

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

  protected async handleReorg (currentBlock: BlockHeader): Promise<void> {
    const [lastProcessedBlockNumber] = this.blockTracker.getLastProcessedBlock()

    const newEvents = await this.contract.getPastEvents('allEvents', {
      fromBlock: (lastProcessedBlockNumber ? lastProcessedBlockNumber + 1 : false) || this.startingBlock,
      toBlock: currentBlock.number
    }) as unknown as E[]

    await this.confirmator?.checkDroppedTransactions(newEvents)

    // Remove all events that currently awaiting confirmation
    await Event.destroy({ where: { contractAddress: this.contract.address } })
    await this.processEvents(newEvents, currentBlock.number)
    this.blockTracker.setLastFetchedBlock(currentBlock.number, currentBlock.hash)
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
}

/**
 * EventsEmitter implementation that listens on new blocks on blockchain and then automatically emits new events.
 *
 * Fetching is triggered using the NewBlockEmitter and is therefore up to the user
 * to chose what new-block strategy will employ.
 */
export class AutoEventsEmitter<E extends EventLog> extends AutoStartStopEventEmitter<AutoEventsEmitterEventsName<E>, EventsEmitterEmptyEvents> {
  private readonly serialListeners?: boolean
  private readonly serialProcessing?: boolean
  private readonly newBlockEmitter: NewBlockEmitter
  private readonly manualEmitter: ManualEventsEmitter<E>

  private pollingUnsubscribe?: Function

  constructor (eth: Eth, contract: Contract, blockTracker: BlockTracker, newBlockEmitter: NewBlockEmitter, baseLogger: Logger, options?: AutoEventsEmitterOptions) {
    const logger = initLogger('events', baseLogger)
    super(initLogger('', baseLogger), NEW_EVENT_EVENT_NAME, options?.autoStart)

    this.manualEmitter = new ManualEventsEmitter(eth, contract, blockTracker, logger, options)
    this.newBlockEmitter = newBlockEmitter
    this.serialListeners = options?.serialListeners
    this.serialProcessing = options?.serialProcessing

    passTroughEvents(this.manualEmitter, this,
      [
        'error',
        REORG_EVENT_NAME,
        REORG_OUT_OF_RANGE_EVENT_NAME,
        INVALID_CONFIRMATION_EVENT_NAME,
        NEW_CONFIRMATION_EVENT_NAME
      ]
    )
    this.newBlockEmitter.on('error', (e) => this.emit('error', e))
  }

  private async emitEvents (events: E[]): Promise<void> {
    const emittingFnc = this.serialListeners ? this.emitSerial.bind(this) : this.emit.bind(this)

    for (const data of events) {
      this.logger.debug('Emitting event', data)

      // Will await for all the listeners to process the event before moving forward
      if (this.serialProcessing) {
        try {
          await emittingFnc(NEW_EVENT_EVENT_NAME, data)
        } catch (e) {
          this.emit('error', e)
        }
      } else { // Does not await and just move on
        emittingFnc(NEW_EVENT_EVENT_NAME, data).catch(e => this.emit('error', e))
      }

      this.blockTracker.setLastProcessedBlockIfHigher(data.blockNumber, data.blockHash)
    }
  }

  protected async convertIteratorToEmitter (iter: AsyncIterableIterator<Batch<E>>): Promise<void> {
    for await (const batch of iter) {
      await this.emitEvents(batch.events)
    }
  }

  async poll (currentBlock: BlockHeader): Promise<void> {
    this.logger.verbose(`Received new block number ${currentBlock.number}`)
    try {
      await this.convertIteratorToEmitter(
        this.manualEmitter.fetch(currentBlock)
      )
    } catch (e) {
      this.logger.error('Error in the processing loop:\n' + JSON.stringify(e, undefined, 2))
      this.emit('error', e)
    }
  }

  async * fetch (toBlock: BlockHeader | undefined): AsyncIterableIterator<Batch<E>> {
    yield * await this.manualEmitter.fetch(toBlock)
  }

  start (): void {
    this.logger.verbose('Starting listening on new blocks for polling new events')
    this.pollingUnsubscribe =
      this.newBlockEmitter.on(NEW_BLOCK_EVENT_NAME, errorHandler(this.poll.bind(this), this.logger))
  }

  stop (): void {
    this.logger.verbose('Finishing listening on new blocks for polling new events')

    if (this.pollingUnsubscribe) {
      this.pollingUnsubscribe()
    }
  }

  get blockTracker (): BlockTracker {
    return this.manualEmitter.blockTracker
  }

  get contract (): Contract {
    return this.manualEmitter.contract
  }
}
