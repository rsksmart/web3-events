import type Emittery from 'emittery'
import type { BlockHeader } from 'web3-eth'
import type { EventLog } from 'web3-core'

import type { ModelConfirmator } from './confirmator'
import type { BlockTracker } from './block-tracker'

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

export interface Confirmator<T> {
  checkDroppedTransactions (newEvents: EventLog[]): Promise<void>
  runConfirmationsRoutine (currentBlock: BlockHeader, toBlockNum?: number): Promise<T[]>
}

export interface ConfirmatorOptions {
  logger?: Logger

  /**
   * Number of blocks that is waited AFTER the event is confirmed before it is removed from database.
   * Such parameter is needed for a REST API where a host could miss that an event has
   * full confirmations as it could be removed from the DB before the endpoint is queried.
   */
  waitingBlockCount?: number
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
   * Starts with 1 and go up to totalSteps (including).
   * If confirmations are enabled, then the first batch is with confirmed events.
   */
  stepsComplete: number

  /**
   * Number of total batches that gonna be emitted
   */
  totalSteps: number
  stepFromBlock: number
  stepToBlock: number
}

export type Batch<E> = ProgressInfo & { events: E[] }

export type ManualEventsEmitterEventsNames = {
  [PROGRESS_EVENT_NAME]: ProgressInfo
  [REORG_OUT_OF_RANGE_EVENT_NAME]: number
  [NEW_CONFIRMATION_EVENT_NAME]: NewConfirmationEvent
  [INVALID_CONFIRMATION_EVENT_NAME]: InvalidConfirmationsEvent
  'error': object
}

export type AutoEventsEmitterEventsName<E> = {
  [NEW_EVENT_EVENT_NAME]: E
  'error': object
}

export type GroupEventsEmitterEventsName<E> = WrapWithName<ManualEventsEmitterEventsNames> & AutoEventsEmitterEventsName<E>

export type EventsEmitterEmptyEvents = keyof {
  [REORG_EVENT_NAME]: void
}

export type EventsEmitterCreationOptions = {
  /**
   * Instance of custom BlockTracker used for the Events Emitter
   */
  blockTracker?: BlockTracker

  /**
   * NewBlockEmitter instance or its options that will be used to create it
   */
  newBlockEmitter?: NewBlockEmitter | NewBlockEmitterOptions

  /**
   * Custom Logger instance.
   */
  logger?: Logger
} & ManualEventsEmitterOptions & AutoEventsEmitterOptions

export interface FetchOptions {
  /**
   * Is the latest block on a blockchain, serves as optimization if you have already the information available.
   */
  currentBlock?: BlockHeader

  /**
   * Number of block to which the events will be fetched to INCLUDING.
   *
   * @default latest block number
   */
  toBlockNumber?: number
}

export interface EventsFetcher<E> extends Emittery {
  fetch(options?: FetchOptions): AsyncIterableIterator<Batch<E>>
  blockTracker: BlockTracker
  batchSize: number
  name: string
}

export interface ManualEventsEmitterOptions {
  /**
   * Similar to "events" option, but it uses the event's signature to specify what events to listen to.
   * It is also highly recommended over the "events" option, because the filtering is done directly
   * on the provider node and hence fetched is only what is needed and not all the contract's events as is the case with
   * the "events" option.
   *
   * Each topic can also be a nested array of topics that behaves as “or” operation between the given nested topics.
   *
   * The topics are sha3 hashed so no need to do that yourself!
   *
   * It has priority over the "events" option.
   *
   * @example ['NewEvent(uint256,byte32)']
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
   * Instance of Confirmator that handles confirmations or its options.
   * When null than no Confirmations routine is run.
   */
  confirmator?: ModelConfirmator<any> | ConfirmatorOptions | null
}

export interface AutoEventsEmitterOptions {
  /**
   * Defines if the listeners should be processed serially.
   *
   * This effects if you have multiple listeners on the EventsEmitter, where it will be awaited
   * for a listener to finish (eq. if it returns Promise, then to be resolved) before moving to next listeners.
   *
   * By default this is false.
   */
  serialListeners?: boolean

  /**
   * Defines if the events should be kept in order and processed serially.
   *
   * This will await for the processing of a event to finish before moving to next event.
   *
   * By default this is false.
   */
  serialProcessing?: boolean

  /**
   * Defines if the EventsEmitter should automatically start listening on events when an events listener
   * for events is attached.
   *
   * By default this is true.
   */
  autoStart?: boolean
}

export interface GroupEmitterOptions {
  /**
   * Base logger
   */
  logger?: Logger

  /**
   * Name of the group used in logs and error messages
   */
  name?: string

  /**
   * Defines if the events from emitters ordered using blockNumber, transactionIndex and logIndex to determine
   * order of the events.
   */
  orderedProcessing?: boolean
}

export type CreateGroupEmitterOptions = GroupEmitterOptions & AutoEventsEmitterOptions & {
  /**
   * NewBlockEmitter instance or its options that will be used to create it
   */
  newBlockEmitter?: NewBlockEmitter | NewBlockEmitterOptions
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

export type WrapWithName<E> = {
  [P in keyof E]: {name: string, data: E[P]};
}

export interface NamespacedEvent<E> {
  name: string
  data: E
}
