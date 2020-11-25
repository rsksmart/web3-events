import type { Eth } from 'web3-eth'
import { Sequelize } from 'sequelize'

import {
  EVENTS_MODEL_TABLE_NAME,
  EventsEmitterCreationOptions,
  BlockTrackerStore,
  Logger,
  NewBlockEmitter,
  NewBlockEmitterOptions
} from './definitions'
import { ListeningNewBlockEmitter, PollingNewBlockEmitter } from './new-block-emitter'
import { AutoEventsEmitter } from './events'
import { Event, EventModelDefinition } from './event.model'
import { Contract } from './contract'
import { initLogger, loggingFactory, scopeObject } from './utils'
import { BlockTracker } from './block-tracker'
import { EventLog } from 'web3-core'

export { Contract } from './contract'
export * from './definitions'
export * from './contract'
export * from './new-block-emitter'
export * from './block-tracker'
export * from './event.model'
export { ManualEventsEmitter, AutoEventsEmitter } from './events'
export { ModelConfirmator } from './confirmator'

export interface Web3EventsOptions {
  logger?: Logger
  defaultNewBlockEmitter?: NewBlockEmitterOptions | NewBlockEmitter
  store?: Record<string, any>
}

/**
 * Main entry point class to the library.
 * It provides "glue" for all the components making it easier to create EventsEmitters.
 */
export class Web3Events {
  private readonly logger: Logger
  private readonly eth: Eth
  private readonly defaultNBEmitter: NewBlockEmitter
  private readonly store: Record<string, any> | undefined
  private readonly contractsUsed: Set<string>
  private static initialized = false

  /**
   * @param eth Web3 Eth instance defining connection to blockchain
   * @param store Optional global store where all the persistent information of EventsEmitters will be placed
   * @param logger Optional logger instance. If not passed then 'debug' package is used instead for logging
   * @param defaultNewBlockEmitter Optional custom configuration or instance of default NewBlockEmitter
   */
  constructor (eth: Eth, { store, logger, defaultNewBlockEmitter }: Web3EventsOptions = {}) {
    if (!Web3Events.initialized) {
      throw new Error('You have to run Web3Events.init() before creating instance!')
    }

    if (!eth.currentProvider) {
      throw new Error('The passed Eth instance does not have a instantiated provider!')
    }

    // @ts-ignore
    Contract.setProvider(eth.currentProvider)

    this.logger = logger ?? loggingFactory('web3events')
    this.eth = eth
    this.store = store
    this.contractsUsed = new Set()

    // Default newBlockEmitter
    this.defaultNBEmitter = this.resolveNewBlockEmitter(defaultNewBlockEmitter) ?? new PollingNewBlockEmitter(eth)
  }

  static async init (sequelize: Sequelize): Promise<void> {
    this.initialized = true

    if (!sequelize.isDefined(EVENTS_MODEL_TABLE_NAME)) {
      Event.init(EventModelDefinition, {
        sequelize,
        freezeTableName: true,
        tableName: EVENTS_MODEL_TABLE_NAME,
        modelName: EVENTS_MODEL_TABLE_NAME
      })

      // TODO: Add migrations
      await Event.sync()
    }
  }

  /**
   * Creates a new AutoEventsEmitter for given Contract.
   *
   * Generally there should be only one emitter per Contract. If you want to use multiple instances for Contract
   * then you have to provide custom instances of BlockTracker as the global store would have otherwise collisions.
   *
   * @param contract Instance of Contract that defines where the events will come from
   * @param options
   * @param options.blockTracker Custom instance of BlockTracker
   * @param options.newBlockEmitter Custom instance of NewBlockEmitter
   */
  public createEventsEmitter<Events extends EventLog> (contract: Contract, options: EventsEmitterCreationOptions): AutoEventsEmitter<Events> {
    if (this.contractsUsed.has(contract.name)) {
      if (!options.blockTracker) {
        throw new Error('This contract is already listened on! New Emitter would use already utilized Store scope. Use your own BlockTracker if you want to continue!')
      } else {
        this.logger.warn(`Contract with name ${contract.name} already has events emitter!`)
      }
    }

    this.contractsUsed.add(contract.name)

    if (!this.store && !options.blockTracker) {
      throw new Error('You have to either set global "store" object in constructor or pass BlockTracker instance!')
    }
    const blockTracker = options.blockTracker ?? new BlockTracker(scopeObject(this.store!, contract.name) as BlockTrackerStore)
    const newBlockEmitter = this.resolveNewBlockEmitter(options.newBlockEmitter) ?? this.defaultNBEmitter

    return new AutoEventsEmitter<Events>(this.eth, contract, blockTracker, newBlockEmitter, options.logger ?? initLogger(contract.name, this.logger), options)
  }

  /**
   * Function that stops the Event Emitter and removes its Contract from the internally tracked set of used contracts.
   * @param eventsEmitter
   */
  public removeEventsEmitter (eventsEmitter: AutoEventsEmitter<any>): void {
    this.contractsUsed.delete(eventsEmitter.contract.name)
    eventsEmitter.stop()
  }

  get defaultNewBlockEmitter (): NewBlockEmitter {
    return this.defaultNBEmitter
  }

  private resolveNewBlockEmitter (value?: NewBlockEmitterOptions | NewBlockEmitter): NewBlockEmitter | undefined {
    if (!value) {
      return
    }

    if (value instanceof PollingNewBlockEmitter || value instanceof ListeningNewBlockEmitter) {
      return value
    }

    value = value as NewBlockEmitterOptions

    if (value?.polling === false) {
      return new ListeningNewBlockEmitter(this.eth)
    } else {
      return new PollingNewBlockEmitter(this.eth, value?.pollingInterval)
    }
  }
}
