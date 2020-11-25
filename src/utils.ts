import Emittery from 'emittery'
import debug from 'debug'

import type { Logger, StartStop } from './definitions'
import { keccak256 } from 'web3-utils'
import { inspect } from 'util'

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
 */
export function passTroughEvents (from: Emittery, to: Emittery, events: string[]): void {
  for (const event of events) {
    from.on(event, eventData => to.emit(event, eventData))
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
