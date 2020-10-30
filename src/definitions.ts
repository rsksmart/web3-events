import type Emittery from 'emittery'
import type { EventLog } from 'web3-core'
import type { BlockHeader } from 'web3-eth'

import type { ModelConfirmator } from './confirmator'
import { BlockTracker } from './block-tracker'
import { Contract } from './contract'

export const NEW_EVENT_EVENT_NAME = 'newEvent'
export const NEW_BLOCK_EVENT_NAME = 'newBlock'
export const REORG_EVENT_NAME = 'reorg'
export const REORG_OUT_OF_RANGE_EVENT_NAME = 'reorgOutOfRange'
export const PROGRESS_EVENT_NAME = 'progress'
export const NEW_CONFIRMATION_EVENT_NAME = 'newConfirmation'
export const INVALID_CONFIRMATION_EVENT_NAME = 'invalidConfirmation'

export const EVENTS_MODEL_TABLE_NAME = 'web3events_event'

export const LAST_FETCHED_BLOCK_NUMBER_KEY = 'lastFetchedBlockNumber'
export const LAST_FETCHED_BLOCK_HASH_KEY = 'lastFetchedBlockHash'
export const LAST_PROCESSED_BLOCK_NUMBER_KEY = 'lastProcessedBlockNumber'
export const LAST_PROCESSED_BLOCK_HASH_KEY = 'lastProcessedBlockHash'

export interface StartStop {
  start(): void
  stop(): void
}

export interface BlockTrackerStore {
  [LAST_FETCHED_BLOCK_NUMBER_KEY]?: number
  [LAST_FETCHED_BLOCK_HASH_KEY]?: string
  [LAST_PROCESSED_BLOCK_NUMBER_KEY]?: number
  [LAST_PROCESSED_BLOCK_HASH_KEY]?: string
}

export type NewBlockEmitterEvents = { [NEW_BLOCK_EVENT_NAME]: BlockHeader, 'error': object }
export type NewBlockEmitter = Emittery.Typed<NewBlockEmitterEvents> & StartStop

export interface NewBlockEmitterOptions {
  /**
   * If to use polling strategy, if false then listening is used.
   */
  polling?: boolean

  /**
   * Interval in milliseconds, how often is blockchain checked.
   */
  pollingInterval?: number
}

export interface Confirmator {
  checkDroppedTransactions (newEvents: EventLog[]): Promise<void>
  runConfirmationsRoutine (currentBlock: BlockHeader): Promise<void>
}

export interface InvalidConfirmationsEvent {
  transactionHash: string
}

export interface NewConfirmationEvent {
  event: string
  transactionHash: string
  confirmations: number
  targetConfirmation: number
}

/**
 * Object emitted by EventsEmitter when batch fetching and processing events
 */
export interface ProgressInfo {
  /**
   * Starts with 1 and go up to totalSteps (including)
   */
  stepsComplete: number
  totalSteps: number
  stepFromBlock: number
  stepToBlock: number
}

export type Batch<E> = ProgressInfo & { events: E[] }

export type EventsEmitterEventsNames<E> = {
  [NEW_EVENT_EVENT_NAME]: E
  [PROGRESS_EVENT_NAME]: ProgressInfo
  [REORG_OUT_OF_RANGE_EVENT_NAME]: number
  [NEW_CONFIRMATION_EVENT_NAME]: NewConfirmationEvent
  [INVALID_CONFIRMATION_EVENT_NAME]: InvalidConfirmationsEvent
  'error': object
}
export type EventsEmitterEmptyEvents = keyof {
  [REORG_OUT_OF_RANGE_EVENT_NAME]: void
  [REORG_EVENT_NAME]: void
}
export type EventsEmitter<E> = Emittery.Typed<EventsEmitterEventsNames<E>, EventsEmitterEmptyEvents> & StartStop & {
  readonly blockTracker: BlockTracker
  readonly contract: Contract
  fetch(): AsyncIterableIterator<Batch<E>>
}

export type EventsEmitterCreationOptions = {
  blockTracker?: BlockTracker
  newBlockEmitter?: NewBlockEmitter | NewBlockEmitterOptions
  logger?: Logger
} & EventsEmitterOptions

export interface EventsEmitterOptions {
  /**
   * Similar to "events" option, but it uses the event's signature to specify what events to listen to.
   * It is also highly recommended over the "events" option, because the filtering is done directly
   * on the provider node and hence fetched is only what is needed and not all the contract's events as is the case with
   * the "events" option.
   *
   * Each topic can also be a nested array of topics that behaves as “or” operation between the given nested topics.
   *
   * The topics are sha3 hashed so no need to that yourself!
   *
   * It has priority over the "events" option.
   *
   * @example ['NewEvent(uint,byte32)']
   */
  topics?: string[] | string[][]

  /**
   * Defines the events that the emitter should listen on
   */
  events?: string[]

  /**
   * The number of blocks that should be processed as batch when fetching events
   */
  batchSize?: number

  /**
   * Defines how many blocks will be an event awaited before declared as confirmed
   */
  confirmations?: number

  /**
   * Specifies the starting block to process events (especially the past ones) on blockchain
   */
  startingBlock?: number

  /**
   * Instance of Confirmator that handles confirmations.
   * When null than no Confirmations routine is run.
   */
  confirmator?: ModelConfirmator | null

  /**
   * Defines if the listeners should be processed serially.
   *
   * This effects if you have multiple listeners on the EventsEmitter, where it will be awaited
   * for a listener to finish (eq. if it returns Promise, then to be resolved) before moving to next listeners.
   */
  serialListeners?: boolean

  /**
   * Defines if the events should be kept in order and processed serially.
   *
   * This will await for the processing of a event to finish before moving to next event.
   */
  serialProcessing?: boolean

  /**
   * Defines if the EventsEmitter should automatically start listening on events when a events listener
   * for events is attached.
   * By default this is true.
   */
  autoStart?: boolean
}

/**
 * Basic logger interface used around the application.
 */
export interface Logger {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error (message: string | Error | object, ...meta: any[]): void

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  warn (message: string | object, ...meta: any[]): void

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  info (message: string | object, ...meta: any[]): void

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  verbose (message: string | object, ...meta: any[]): void

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  debug (message: string | object, ...meta: any[]): void

  extend?: (name: string) => Logger
}
