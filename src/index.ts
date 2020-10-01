import type { Eth } from 'web3-eth'
import Emittery from 'emittery'

import { Logger, NewBlockEmitter } from './definitions'
import { PollingNewBlockEmitter } from './new-block-emitter'

export { Contract } from './contract'
export * from './definitions'
export * from './contract'
export * from './new-block-emitter'
export * from './block-tracker'
export { PollingEventsEmitter } from './events'
export { ModelConfirmator, ConfirmatorOptions } from './confirmator'

export interface Web3EventsOptions {
  logger?: Logger
}

const defaultSymbol = Symbol('defaultValue')

export class Web3Events {
  private logger?: Logger
  private eth: Eth
  private newBlockEmitters: Map<string | symbol, NewBlockEmitter>

  constructor (eth: Eth, { logger }: Web3EventsOptions = {}) {
    this.logger = logger
    this.eth = eth
    this.newBlockEmitters = new Map()

    // Default newBlockEmitter
    this.newBlockEmitters.set(defaultSymbol, new PollingNewBlockEmitter(eth))
  }

  setNewBlockEmitter (name: string | symbol = defaultSymbol) {

  }
}
