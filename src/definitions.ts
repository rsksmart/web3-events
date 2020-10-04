/**
 * Basic logger interface used around the application.
 */
import type Emittery from 'emittery'
import type { ModelConfirmator } from './confirmator'
import { EventData } from 'web3-eth-contract'
import { BlockHeader } from 'web3-eth'

export const PROCESSED_BLOCK_KEY = 'lastProcessedBlock'
export const NEW_EVENT_EVENT_NAME = 'newEvent'
export const INIT_FINISHED_EVENT_NAME = 'initFinished'
export const NEW_BLOCK_EVENT_NAME = 'newBlock'
export const REORG_EVENT_NAME = 'reorg'
export const REORG_OUT_OF_RANGE_EVENT_NAME = 'reorgOutOfRange'

export const NEW_CONFIRMATION_EVENT_NAME = 'newConfirmation'
export const INVALID_CONFIRMATION_EVENT_NAME = 'invalidConfirmation'

export type NewBlockEmitterEvents = {[NEW_BLOCK_EVENT_NAME]: BlockHeader, 'error': object}
export type NewBlockEmitter = Emittery.Typed<NewBlockEmitterEvents>

export interface Confirmator {
  checkDroppedTransactions (newEvents: EventData[]): Promise<void>
  runConfirmationsRoutine (currentBlock: BlockHeader): Promise<void>
}

export type EventsEmitterEventsNames<E> = {
  [NEW_EVENT_EVENT_NAME]: E
  [REORG_OUT_OF_RANGE_EVENT_NAME]: number
  'error': object
}
export type EventsEmitterEmptyEvents = keyof {
  [INIT_FINISHED_EVENT_NAME]: void
  [REORG_OUT_OF_RANGE_EVENT_NAME]: void
  [REORG_EVENT_NAME]: void
}
export type EventsEmitter<E> = Emittery.Typed<EventsEmitterEventsNames<E>, EventsEmitterEmptyEvents>

export interface Logger {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  critical(message: string | Error | object, ...meta: any[]): never

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error(message: string | Error | object, ...meta: any[]): void

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  warn(message: string | object, ...meta: any[]): void

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  info(message: string | object, ...meta: any[]): void

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  verbose(message: string | object, ...meta: any[]): void

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  debug(message: string | object, ...meta: any[]): void

  extend?: (name: string) => Logger
}

export interface NewBlockEmitterOptions {
  // If to use polling strategy, if false then listening is used.
  polling?: boolean

  // Interval in milliseconds, how often is blockchain checked.
  pollingInterval?: number
}

export interface EventsEmitterOptions {
  // Defines the events that the emitter should listen on
  events?: string[]

  // Defines how many blocks will be an event awaited before declared as confirmed
  confirmations?: number

  // Specifies the starting block to process events (especially the past ones) on blockchain
  startingBlock?: number | string

  /**
   * Instance of Confirmator that handles confirmations
   */
  confirmator?: ModelConfirmator

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
}
