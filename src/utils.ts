import Emittery from 'emittery'
import debug from 'debug'
import { keccak256 } from 'web3-utils'
import { inspect } from 'util'
import type { BlockHeader } from 'web3-eth'
import type { EventLog } from 'web3-core'

import type { EventsFetcher, FetchOptions, Logger, ManualEventsEmitterEventsNames, StartStop } from './definitions'
import {
  AutoEventsEmitterEventsName,
  AutoEventsEmitterOptions,
  Batch,
  EventsEmitterEmptyEvents,
  INVALID_CONFIRMATION_EVENT_NAME,
  NEW_BLOCK_EVENT_NAME,
  NEW_CONFIRMATION_EVENT_NAME,
  NEW_EVENT_EVENT_NAME,
  NewBlockEmitter, PROGRESS_EVENT_NAME,
  REORG_EVENT_NAME,
  REORG_OUT_OF_RANGE_EVENT_NAME
} from './definitions'
import { BlockTracker } from './block-tracker'

export function loggingFactory (name: string): Logger {
  const log = debug(name)

  return {
    debug (message: string | object, ...meta) {
      log(`DEBUG: ${message}` + (meta.length ? '\n' + meta.map(e => inspect(e)).join('\n') : ''))
    },
    verbose (message: string | object, ...meta) {
      log(`VERBOSE: ${message}` + (meta.length ? '\n' + meta.map(e => inspect(e)).join('\n') : ''))
    },
    info (message: string | object, ...meta) {
      log(`INFO: ${message}` + (meta.length ? '\n' + meta.map(e => inspect(e)).join('\n') : ''))
    },
    warn (message: string | object, ...meta) {
      log(`WARN: ${message}` + (meta.length ? '\n' + meta.map(e => inspect(e)).join('\n') : ''))
    },
    error (message: string | object, ...meta) {
      log(`ERROR: ${message}` + (meta.length ? '\n' + meta.map(e => inspect(e)).join('\n') : ''))

      if ((message as Error).stack) {
        log((message as Error).stack)
      }
    },
    extend (extendedName: string) {
      return loggingFactory(`${name}:${extendedName}`)
    }
  }
}

export function initLogger (name: string, baseLogger?: Logger): Logger {
  if (baseLogger) {
    if (baseLogger.extend) {
      return baseLogger.extend(name)
    } else {
      return baseLogger
    }
  } else {
    return loggingFactory(name)
  }
}

export function hashTopics (topics?: (string[] | string)[]): (string[] | string)[] {
  if (!topics) return []
  return topics.map((e: string | string[]) => {
    if (Array.isArray(e)) {
      return e.map(keccak256)
    } else {
      return keccak256(e)
    }
  })
}

/**
 * Subscribe to all events on "from" emitter and re-emit them in "to" emitter.
 *
 * @param from
 * @param to
 * @param events
 * @param name If specified than the data coming from "from" emitter are wrapped in object: {name, data}
 */
export function passTroughEvents (from: Emittery, to: Emittery, events: string[], name?: string): void {
  for (const event of events) {
    from.on(event, EventLog => {
      if (name) {
        to.emit(event, { name, data: EventLog })
      } else {
        to.emit(event, EventLog)
      }
    })
  }
}

/**
 * Function that will split array into two groups based on callback that returns Promise.
 *
 * @param arr
 * @param callback
 * @return [success, failure] array where first are positives based on callback and second are negatives
 */
export async function asyncSplit<T> (arr: T[], callback: (elem: T) => Promise<boolean>): Promise<[T[], T[]]> {
  const splitArray = await Promise.all(arr.map(async item => await callback(item)))
  return arr.reduce<[T[], T[]]>(([pass, fail], elem, currentIndex) => {
    return splitArray[currentIndex] ? [[...pass, elem], fail] : [pass, [...fail, elem]]
  }, [[], []])
}

/**
 * Utility function that will split array into two groups based on sync callback.
 * @param array
 * @param isValid
 * @return [success, failure] array where first are positives based on callback and second are negatives
 */
export function split<T> (array: T[], isValid: (elem: T) => boolean): [T[], T[]] {
  return array.reduce<[T[], T[]]>(([pass, fail], elem) => {
    return isValid(elem) ? [[...pass, elem], fail] : [pass, [...fail, elem]]
  }, [[], []])
}

/**
 * Takes Sets A and B and create a difference of those, which results in a subset of A, where
 * elements from set B are removed.
 * @param setA
 * @param setB
 */
export function setDifference<T> (setA: Set<T>, setB: Set<T>): Set<T> {
  const _difference = new Set(setA)
  for (const elem of setB) {
    _difference.delete(elem)
  }
  return _difference
}

/**
 * General handler closure function mainly for Event Emitters, which in case of rejected promise logs the rejection
 * using given logger.
 *
 * @param fn
 * @param logger
 */
export function errorHandler (fn: (...args: any[]) => Promise<any>, logger: Logger): (...args: any[]) => Promise<any> {
  return (...args) => {
    return fn(...args).catch(err => logger.error(err))
  }
}

/**
 * Function that wraps obj in Proxy that prefix all the object's keys access with given scope
 * @param obj
 * @param scope
 */
export function scopeObject (obj: Record<string, any>, scope: string): Record<string, any> {
  return new Proxy(obj, {
    get (target: Record<string, any>, name: PropertyKey): any {
      if (typeof name === 'symbol') {
        throw new Error('Symbols are not supported by scopeObject')
      }

      return Reflect.get(target, `${scope}.${name}`)
    },
    set (target: Record<string, any>, name: PropertyKey, value: any): boolean {
      if (typeof name === 'symbol') {
        throw new Error('Symbols are not supported by scopeObject')
      }

      target[`${scope}.${name}`] = value
      return true
    },
    deleteProperty (target: Record<string, any>, name: PropertyKey): boolean {
      if (typeof name === 'symbol') {
        throw new Error('Symbols are not supported by scopeObject')
      }

      delete target[`${scope}.${name}`]
      return true
    }
  })
}

export async function cumulateIterations<E> (iterators: AsyncIterableIterator<E>[], bufferAllIteration = false): Promise<[boolean, E[]]> {
  let iterating: boolean
  const accumulator: E[] = []

  do {
    iterating = false

    // This fetches one batch for each emitter
    for (const iterator of iterators) {
      const iteratorResult = await iterator.next()
      iterating = iterating || !iteratorResult.done

      if (iteratorResult.value) {
        const batch = iteratorResult.value
        accumulator.push(batch)
      }
    }

    // We go through all batches only when asked
    if (!bufferAllIteration) {
      break
    }
  } while (iterating)

  return [iterating, accumulator]
}

/**
 * Abstract EventEmitter that automatically start (what ever task defined in abstract start() method) when first listener is
 * attached and similarly stops (what ever task defined in abstract stop() method) when last listener is removed.
 */
export abstract class AutoStartStopEventEmitter<T, E extends string | symbol = never> extends Emittery.Typed<T, E> implements StartStop {
  /**
   * Name of event that triggers the start/stop actions. Eq. waits there is listeners for this specific event.
   */
  private readonly triggerEventName: string
  private isStarted = false
  protected logger: Logger

  protected constructor (logger: Logger, triggerEventName: string, autoStart = true) {
    super()
    this.logger = logger
    this.triggerEventName = triggerEventName

    if (autoStart) {
      // TODO: Awaiting resolution of https://github.com/sindresorhus/emittery/issues/63
      // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
      // @ts-ignore
      this.on(Emittery.listenerAdded, ({ eventName }: Emittery.ListenerChangedData) => {
        if (eventName === this.triggerEventName && !this.isStarted) {
          this.logger.verbose('Listener attached, starting processing events.')
          this.start()
          this.isStarted = true
        }
      })

      // TODO: Awaiting resolution of https://github.com/sindresorhus/emittery/issues/63
      // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
      // @ts-ignore
      this.on(Emittery.listenerRemoved, ({ eventName }: Emittery.ListenerChangedData) => {
        if (this.listenerCount(this.triggerEventName) === 0) {
          this.logger.verbose('Listener removing, stopping processing events.')
          this.stop()
          this.isStarted = false
        }
      })
    }
  }

  abstract start (): void

  abstract stop (): void
}

/**
 * Utility class that wraps any EventsFetcher and automatically trigger fetching of events which are then emitted
 * using `newEvent` event.
 *
 * Fetching is triggered using the NewBlockEmitter and is therefore up to the user
 * to chose what new-block strategy will employ.
 */
export class AutoEventsEmitter<E extends EventLog,
  ValueEvents extends AutoEventsEmitterEventsName<E> = ManualEventsEmitterEventsNames & AutoEventsEmitterEventsName<E>,
  NonValueEvents extends string | symbol = EventsEmitterEmptyEvents> extends AutoStartStopEventEmitter<ValueEvents, NonValueEvents>
  implements EventsFetcher<E> {
  // eslint-disable-next-line no-trailing-spaces

  private readonly serialListeners?: boolean
  private readonly serialProcessing?: boolean
  private readonly newBlockEmitter: NewBlockEmitter
  private readonly eventsFetcher: EventsFetcher<E>

  private pollingUnsubscribe?: Function

  constructor (fetcher: EventsFetcher<E>, newBlockEmitter: NewBlockEmitter, baseLogger: Logger, options?: AutoEventsEmitterOptions) {
    super(initLogger('', baseLogger), NEW_EVENT_EVENT_NAME, options?.autoStart)

    this.eventsFetcher = fetcher
    this.newBlockEmitter = newBlockEmitter
    this.serialListeners = options?.serialListeners
    this.serialProcessing = options?.serialProcessing

    passTroughEvents(this.eventsFetcher, this,
      [
        'error',
        REORG_EVENT_NAME,
        REORG_OUT_OF_RANGE_EVENT_NAME,
        INVALID_CONFIRMATION_EVENT_NAME,
        NEW_CONFIRMATION_EVENT_NAME,
        PROGRESS_EVENT_NAME
      ]
    )
    // @ts-ignore
    this.newBlockEmitter.on('error', (e) => this.emit('error', e))
  }

  private async emitEvents (events: E[]): Promise<void> {
    const emittingFnc = this.serialListeners ? this.emitSerial.bind(this) : this.emit.bind(this)

    for (const data of events) {
      this.logger.debug('Emitting event', data)

      // Will await for all the listeners to process the event before moving forward
      if (this.serialProcessing) {
        try {
          // TODO: Waiting for help: https://github.com/sindresorhus/emittery/issues/71
          // @ts-ignore
          await emittingFnc(NEW_EVENT_EVENT_NAME, data)
        } catch (e) {
          // @ts-ignore
          this.emit('error', e)
        }
      } else { // Does not await and just move on
        // @ts-ignore
        emittingFnc(NEW_EVENT_EVENT_NAME, data).catch(e => this.emit('error', e))
      }
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
        this.fetch({ currentBlock })
      )
    } catch (e) {
      this.logger.error('Error in the processing loop:\n' + JSON.stringify(e, undefined, 2))
      // @ts-ignore
      this.emit('error', e)
    }
  }

  async * fetch (options?: FetchOptions): AsyncIterableIterator<Batch<E>> {
    yield * await this.eventsFetcher.fetch(options)
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

  public get name (): string {
    return this.eventsFetcher.name
  }

  public get batchSize (): number {
    return this.eventsFetcher.batchSize
  }

  public get blockTracker (): BlockTracker {
    return this.eventsFetcher.blockTracker
  }
}
