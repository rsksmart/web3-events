import chai from 'chai'
import sinonChai from 'sinon-chai'
import chaiAsPromised from 'chai-as-promised'
import dirtyChai from 'dirty-chai'

import { BlockTracker } from '../src/block-tracker'
import { BlockTrackerStore } from '../src'

chai.use(sinonChai)
chai.use(chaiAsPromised)
chai.use(dirtyChai)
const expect = chai.expect
const STORE_LAST_FETCHED_BLOCK_NUMBER_KEY = 'lastFetchedBlockNumber'
const STORE_LAST_FETCHED_BLOCK_HASH_KEY = 'lastFetchedBlockHash'
const STORE_LAST_PROCESSED_BLOCK_NUMBER_KEY = 'lastProcessedBlockNumber'
const STORE_LAST_PROCESSED_BLOCK_HASH_KEY = 'lastProcessedBlockHash'

describe('BlockTracker', () => {
  it('read initial block from store', function () {
    const store = {
      [STORE_LAST_FETCHED_BLOCK_HASH_KEY]: '0x123',
      [STORE_LAST_FETCHED_BLOCK_NUMBER_KEY]: 10,
      [STORE_LAST_PROCESSED_BLOCK_HASH_KEY]: '0x321',
      [STORE_LAST_PROCESSED_BLOCK_NUMBER_KEY]: 8
    }
    const bt = new BlockTracker(store)
    expect(bt.getLastFetchedBlock()).to.eql([10, '0x123'])
    expect(bt.getLastProcessedBlock()).to.eql([8, '0x321'])
  })

  it('should save last fetched block', function () {
    const store = {} as BlockTrackerStore
    const bt = new BlockTracker(store)

    expect(bt.getLastFetchedBlock()).to.be.eql([undefined, undefined])
    expect(store[STORE_LAST_FETCHED_BLOCK_NUMBER_KEY]).to.be.undefined()
    expect(store[STORE_LAST_FETCHED_BLOCK_HASH_KEY]).to.be.undefined()

    bt.setLastFetchedBlock(9, '0x123')
    expect(bt.getLastFetchedBlock()).to.eql([9, '0x123'])
    expect(store[STORE_LAST_FETCHED_BLOCK_NUMBER_KEY]).to.eql(9)
    expect(store[STORE_LAST_FETCHED_BLOCK_HASH_KEY]).to.eql('0x123')
  })

  it('should save last processed block only if higher', function () {
    const store = {} as BlockTrackerStore
    const bt = new BlockTracker(store)

    expect(bt.getLastProcessedBlock()).to.be.eql([undefined, undefined])
    expect(store[STORE_LAST_PROCESSED_BLOCK_NUMBER_KEY]).to.be.undefined()
    expect(store[STORE_LAST_PROCESSED_BLOCK_HASH_KEY]).to.be.undefined()

    bt.setLastProcessedBlockIfHigher(10, '0x123')
    expect(bt.getLastProcessedBlock()).to.eql([10, '0x123'])
    expect(store[STORE_LAST_PROCESSED_BLOCK_NUMBER_KEY]).to.eql(10)
    expect(store[STORE_LAST_PROCESSED_BLOCK_HASH_KEY]).to.eql('0x123')

    bt.setLastProcessedBlockIfHigher(9, '0x123')
    expect(bt.getLastProcessedBlock()).to.eql([10, '0x123'])
    expect(store[STORE_LAST_PROCESSED_BLOCK_NUMBER_KEY]).to.eql(10)
    expect(store[STORE_LAST_PROCESSED_BLOCK_HASH_KEY]).to.eql('0x123')

    bt.setLastProcessedBlockIfHigher(11, '0x1233')
    expect(bt.getLastProcessedBlock()).to.eql([11, '0x1233'])
    expect(store[STORE_LAST_PROCESSED_BLOCK_NUMBER_KEY]).to.eql(11)
    expect(store[STORE_LAST_PROCESSED_BLOCK_HASH_KEY]).to.eql('0x1233')
  })
})
