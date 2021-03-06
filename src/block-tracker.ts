import Emittery from 'emittery'
import {
  BlockTrackerStore,
  LAST_FETCHED_BLOCK_HASH_KEY,
  LAST_FETCHED_BLOCK_NUMBER_KEY, LAST_PROCESSED_BLOCK_HASH_KEY,
  LAST_PROCESSED_BLOCK_NUMBER_KEY
} from './definitions'

/**
 * Simple class for persistence of last processed block in order to not crawl the whole blockchain upon every restart
 * of the server.
 */
export class BlockTracker extends Emittery.Typed<never, 'fetchedBlockSet' | 'processedBlockSet'> {
  private readonly store: BlockTrackerStore

  constructor (store: BlockTrackerStore) {
    super()
    this.store = store
  }

  setLastFetchedBlock (blockNumber: number, blockHash: string): void {
    this.store[LAST_FETCHED_BLOCK_HASH_KEY] = blockHash
    this.store[LAST_FETCHED_BLOCK_NUMBER_KEY] = blockNumber
    this.emit('fetchedBlockSet')
  }

  getLastFetchedBlock (): [number?, string?] {
    return [this.store[LAST_FETCHED_BLOCK_NUMBER_KEY], this.store[LAST_FETCHED_BLOCK_HASH_KEY]]
  }

  setLastProcessedBlockIfHigher (blockNumber: number, blockHash: string): void {
    if ((this.store[LAST_PROCESSED_BLOCK_NUMBER_KEY] || -1) > blockNumber) {
      return
    }

    this.store[LAST_PROCESSED_BLOCK_HASH_KEY] = blockHash
    this.store[LAST_PROCESSED_BLOCK_NUMBER_KEY] = blockNumber
    this.emit('processedBlockSet')
  }

  getLastProcessedBlock (): [number?, string?] {
    return [this.store[LAST_PROCESSED_BLOCK_NUMBER_KEY], this.store[LAST_PROCESSED_BLOCK_HASH_KEY]]
  }
}
