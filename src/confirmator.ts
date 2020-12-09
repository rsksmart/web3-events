import { literal, Op, WhereOptions } from 'sequelize'
import type { EventData } from 'web3-eth-contract'
import type { BlockHeader, Eth } from 'web3-eth'

import { Event } from './event.model'
import { asyncSplit, initLogger, setDifference } from './utils'
import type { Confirmator, ConfirmatorOptions, Logger } from './definitions'
import type { BlockTracker } from './block-tracker'
import { INVALID_CONFIRMATION_EVENT_NAME, NEW_CONFIRMATION_EVENT_NAME } from './definitions'
import { ManualEventsEmitter } from './events'

const DEFAULT_WAITING_BLOCK_COUNT = 10

function isConfirmedClosure (currentBlockNumber: number) {
  return (event: Event): boolean => !event.emitted && event.getConfirmationsCount(currentBlockNumber) >= event.targetConfirmation
}

/**
 * Class that handles confirmations of blocks.
 * Also gives support to detect what events were dropped.
 */
export class ModelConfirmator<T extends EventData> implements Confirmator<T> {
  private readonly emitter: ManualEventsEmitter<T>
  private readonly eth: Eth
  private readonly contractAddress: string
  private readonly blockTracker: BlockTracker
  private readonly logger: Logger

  /**
   * Defines how many blocks will be a block kept in DB after its confirmations.
   * This is in order to allow polling users to have enough time to see that the block was confirmed.
   */
  private readonly waitingBlockCount: number

  constructor (emitter: ManualEventsEmitter<T>, eth: Eth, contractAddress: string, blockTracker: BlockTracker, { logger, waitingBlockCount }: ConfirmatorOptions = {}) {
    this.emitter = emitter
    this.eth = eth
    this.contractAddress = contractAddress
    this.blockTracker = blockTracker
    this.logger = initLogger('confirmator', logger)
    this.waitingBlockCount = waitingBlockCount ?? DEFAULT_WAITING_BLOCK_COUNT
  }

  /**
   * Retrieves confirmed events and emits them.
   *
   * Before emitting it validates that the Event is still valid on blockchain using the transaction's receipt.
   *
   * @param currentBlock
   * @param toBlockNum
   */
  public async runConfirmationsRoutine (currentBlock: BlockHeader, toBlockNum?: number): Promise<T[]> {
    if (typeof currentBlock.number !== 'number') {
      throw new TypeError('CurrentBlock.number is not a number!')
    }

    if (typeof this.waitingBlockCount !== 'number') {
      throw new TypeError('waitingBlockCount is not a number!')
    }

    const conditions: WhereOptions = {
      contractAddress: this.contractAddress,
      emitted: false
    }

    if (toBlockNum) {
      conditions.blockNumber = { [Op.lte]: toBlockNum }
    }

    this.logger.verbose('Running Confirmation routine')
    const events = await Event.findAll({
      where: conditions
    })

    if (!events) {
      return []
    }

    const [valid, invalid] = await asyncSplit(events, this.eventHasValidReceipt.bind(this))
    valid.forEach(this.emitNewConfirmationsClosure(currentBlock.number))

    if (invalid.length !== 0) {
      invalid.forEach(e => this.emitter.emit(INVALID_CONFIRMATION_EVENT_NAME, { transactionHash: e.transactionHash }))
      await Event.destroy({ where: { id: invalid.map(e => e.id) } })
    }

    // Remove already too old confirmations
    await Event.destroy({
      where: {
        emitted: true,
        contractAddress: this.contractAddress,
        blockNumber: { [Op.lte]: literal(`${currentBlock.number - this.waitingBlockCount} - \`targetConfirmation\``) }
      }
    })

    const toBeEmitted = valid.filter(isConfirmedClosure(currentBlock.number))
    this.logger.info(`Confirmed ${toBeEmitted.length} events.`)
    await Event.update({ emitted: true }, { where: { id: toBeEmitted.map(e => e.id) } }) // Update DB that events were emitted
    return toBeEmitted.map(this.confirmEvent.bind(this))
  }

  private async eventHasValidReceipt (event: Event): Promise<boolean> {
    const receipt = await this.eth.getTransactionReceipt(event.transactionHash)

    if (receipt.status && receipt.blockNumber === event.blockNumber) {
      return true
    } else {
      this.logger.warn(`Event ${event.event} of transaction ${event.transactionHash} does not have valid receipt!
      Block numbers: ${event.blockNumber} (event) vs ${receipt.blockNumber} (receipt) and receipt status: ${receipt.status} `)
      return false
    }
  }

  private emitNewConfirmationsClosure (currentBlockNumber: number) {
    return (event: Event): void => {
      const data = {
        event: event.event,
        transactionHash: event.transactionHash,
        confirmations: event.getConfirmationsCount(currentBlockNumber),
        targetConfirmation: event.targetConfirmation
      }
      this.emitter.emit(NEW_CONFIRMATION_EVENT_NAME, data)
    }
  }

  private confirmEvent (data: Event): T {
    const event = JSON.parse(data.content) as T
    this.logger.debug('Confirming event', event)
    return event
  }

  /**
   * This should be called when handling of reorg inside of confirmation range.
   * The re-fetched transactions from blockchain are passed here and they are compared with the current events that awaits confirmation.
   * If some transaction is not present in the new transactions that it is pronounced as a dropped transaction and emitted as such.
   *
   * @param newEvents - Re-fetched events inside of the confirmation range from blockchain.
   * @emits INVALID_CONFIRMATION_EVENT_NAME - with transactionHash of the dropped transaction.
   */
  public async checkDroppedTransactions (newEvents: EventData[]): Promise<void> {
    const currentEvents = await Event.findAll({
      where: {
        contractAddress: this.contractAddress
      }
    })

    const newEventsTransactions = newEvents.reduce<Set<string>>((set, event) => set.add(event.transactionHash), new Set())
    const oldEventsTransactions = currentEvents.reduce<Set<string>>((set, event) => set.add(event.transactionHash), new Set())
    const droppedTransactions = setDifference(oldEventsTransactions, newEventsTransactions)

    for (const droppedTransaction of droppedTransactions) {
      this.emitter.emit(INVALID_CONFIRMATION_EVENT_NAME, { transactionHash: droppedTransaction }).catch(e => this.emitter.emit('error', e))
    }
  }
}
