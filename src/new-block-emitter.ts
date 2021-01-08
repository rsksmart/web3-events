import type { BlockHeader, Eth } from 'web3-eth'
import type { Subscription } from 'web3-core-subscriptions'

import { AutoStartStopEventEmitter, initLogger } from './utils'
import { NEW_BLOCK_EVENT_NAME, NewBlockEmitter, NewBlockEmitterEvents } from './definitions'

const DEFAULT_POLLING_INTERVAL = 5000

/**
 * EventEmitter that emits event upon new block on the blockchain.
 * Uses polling strategy.
 */
export class PollingNewBlockEmitter extends AutoStartStopEventEmitter<NewBlockEmitterEvents> implements NewBlockEmitter {
  private readonly eth: Eth
  private readonly pollingInterval: number
  private intervalId?: NodeJS.Timeout
  private lastBlockNumber = 0

  constructor (eth: Eth, pollingInterval: number = DEFAULT_POLLING_INTERVAL) {
    super(initLogger('block-emitter:listening'), NEW_BLOCK_EVENT_NAME)
    this.eth = eth
    this.pollingInterval = pollingInterval
  }

  private async fetchLastBlockNumber (): Promise<void> {
    try {
      const lastBlock = await this.eth.getBlock('latest')

      if (this.lastBlockNumber !== lastBlock.number) {
        this.lastBlockNumber = lastBlock.number
        this.logger.verbose(`New block with number ${lastBlock.number} with hash ${lastBlock.hash}`)
        this.emit(NEW_BLOCK_EVENT_NAME, lastBlock).catch(e => this.emit('error', e))
      }
    } catch (e) {
      this.logger.error('While fetching latest block error happend!')
      this.logger.error(e)
      this.emit('error', e)
    }
  }

  start (): void {
    // Fetch last block right away
    this.fetchLastBlockNumber().catch(this.logger.error)
    this.intervalId = setInterval(this.fetchLastBlockNumber.bind(this), this.pollingInterval)
  }

  stop (): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
    }
  }
}

/**
 * EventEmitter that emits event upon new block on the blockchain.
 * Uses listening strategy for 'newBlockHeaders' event.
 */
export class ListeningNewBlockEmitter extends AutoStartStopEventEmitter<NewBlockEmitterEvents> implements NewBlockEmitter {
  private readonly eth: Eth
  private subscription?: Subscription<BlockHeader>

  constructor (eth: Eth) {
    super(initLogger('block-emitter:listening'), NEW_BLOCK_EVENT_NAME)
    this.eth = eth
  }

  async start (): Promise<void> {
    try {
      // Emit block number right away
      const lastBlock = await this.eth.getBlock('latest')
      this.logger.verbose(`Current block with number ${lastBlock.number} with hash ${lastBlock.hash}`)
      this.emit(NEW_BLOCK_EVENT_NAME, lastBlock).catch(e => this.emit('error', e))

      this.subscription = this.eth.subscribe('newBlockHeaders', (error, blockHeader) => {
        if (error) {
          this.logger.error(error)
          this.emit('error', error)
          return
        }

        this.logger.verbose(`New block with number ${lastBlock.number} with hash ${lastBlock.hash}`)
        this.emit(NEW_BLOCK_EVENT_NAME, blockHeader).catch(e => this.emit('error', e))
      })
    } catch (e) {
      this.logger.error(e)
      this.emit('error', e)
    }
  }

  stop (): void {
    this.subscription?.unsubscribe(error => { this.logger.error(error) })
  }
}
