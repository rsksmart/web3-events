const LAST_FETCHED_BLOCK_NUMBER_KEY = 'lastFetchedBlockNumber'
const LAST_FETCHED_BLOCK_HASH_KEY = 'lastFetchedBlockHash'
const LAST_PROCESSED_BLOCK_NUMBER_KEY = 'lastProcessedBlockNumber'
const LAST_PROCESSED_BLOCK_HASH_KEY = 'lastProcessedBlockHash'

export interface BlockTrackerStore {
  [LAST_FETCHED_BLOCK_NUMBER_KEY]?: number
  [LAST_FETCHED_BLOCK_HASH_KEY]?: string
  [LAST_PROCESSED_BLOCK_NUMBER_KEY]?: number
  [LAST_PROCESSED_BLOCK_HASH_KEY]?: string
}

/**
 * Simple class for persistence of last processed block in order to not crawl the whole blockchain upon every restart
 * of the server.
 */
export class BlockTracker {
  private readonly store: BlockTrackerStore

  constructor (store: BlockTrackerStore) {
    this.store = store
  }

  setLastFetchedBlock (blockNumber: number, blockHash: string): void {
    this.store[LAST_FETCHED_BLOCK_HASH_KEY] = blockHash
    this.store[LAST_FETCHED_BLOCK_NUMBER_KEY] = blockNumber
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
  }

  getLastProcessedBlock (): [number?, string?] {
    return [this.store[LAST_PROCESSED_BLOCK_NUMBER_KEY], this.store[LAST_PROCESSED_BLOCK_HASH_KEY]]
  }
}
