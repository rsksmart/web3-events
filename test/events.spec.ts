import { Eth } from 'web3-eth'
import { Arg, Substitute } from '@fluffy-spoon/substitute'
import sinon from 'sinon'
import chai from 'chai'
import dirtyChai from 'dirty-chai'
import chaiAsPromised from 'chai-as-promised'
import util from 'util'
import sinonChai from 'sinon-chai'
import { Sequelize } from 'sequelize'

import { ManualEventsEmitter } from '../src/events'
import { loggingFactory } from '../src/utils'
import { Event } from '../src/event.model'
import { blockMock, delayedPromise, eventMock, receiptMock, sequelizeFactory, sleep, wholeGenerator } from './utils'
import {
  BlockTracker,
  Contract,
  ManualEventsEmitterOptions,
  ModelConfirmator,
  PROGRESS_EVENT_NAME,
  REORG_EVENT_NAME,
  REORG_OUT_OF_RANGE_EVENT_NAME, Web3Events
} from '../src'

chai.use(sinonChai)
chai.use(chaiAsPromised)
chai.use(dirtyChai)
const expect = chai.expect
const setImmediatePromise = util.promisify(setImmediate)

describe('ManualEventsEmitter', () => {
  let sequelize: Sequelize

  before(async (): Promise<void> => {
    sequelize = sequelizeFactory()
    await Web3Events.init(sequelize)
  })

  beforeEach(async () => {
    await sequelize.sync({ force: true })
  })

  it('should wait for previous processing finished', async function () {
    const events = [
      eventMock({ blockNumber: 4, transactionHash: '1' }),
      eventMock({ blockNumber: 8, transactionHash: '2' }),
      eventMock({ blockNumber: 9, transactionHash: '3' }),
      eventMock({ blockNumber: 10, transactionHash: '4' })
    ]

    const eth = Substitute.for<Eth>()
    eth.getBlock('latest').resolves(blockMock(11))

    const [getPastEventsPromise, getPastEventsCallback] = delayedPromise()
    const contract = Substitute.for<Contract>()
    contract.getPastEvents(Arg.all()).returns(getPastEventsPromise) // Blocks the getPastEvents call

    const blockTracker = new BlockTracker({})
    const options = { events: ['testEvent'] }
    const eventsEmitter = new ManualEventsEmitter(eth, contract, blockTracker, loggingFactory('web3events:events:dummy'), options)

    // Directly fetch(), which should be blocked by the processing of previous events()
    const createEventPromise = wholeGenerator(eventsEmitter.fetch())
    eth.received(0).getBlock('latest') // This asserts that the `processEvents` was not yet called

    // Unblock the getPastEvents call
    getPastEventsCallback(events)
    await sleep(50)
    eth.received(1).getBlock('latest')

    // After the processingEvents() is finished
    await createEventPromise
    eth.received(1).getBlock('latest')
  })

  it('should ignore same blocks', async function () {
    const events = [
      eventMock({ blockNumber: 4, transactionHash: '1' }),
      eventMock({ blockNumber: 8, transactionHash: '2' }),
      eventMock({ blockNumber: 9, transactionHash: '3' }),
      eventMock({ blockNumber: 10, transactionHash: '4' })
    ]

    const eth = Substitute.for<Eth>()
    eth.getBlock('latest').resolves(blockMock(11))
    // Required because for every batch the last block header is retrieved for setting the lastFetchedBlock
    eth.getBlock(11).resolves(blockMock(11))

    const contract = Substitute.for<Contract>()
    contract.getPastEvents(Arg.all()).resolves(events)

    const blockTracker = new BlockTracker({})
    const options = { events: ['testEvent'] }
    const eventsEmitter = new ManualEventsEmitter(eth, contract, blockTracker, loggingFactory('web3events:events:dummy'), options)

    const fetchedEvents = await wholeGenerator(eventsEmitter.fetch())

    // Second time calling fetch for same block 11
    const fetchedEventsSecondTime = await wholeGenerator(eventsEmitter.fetch())

    expect(fetchedEvents).to.have.length(1)
    expect(fetchedEvents[0].events).to.have.length(4)
    expect(fetchedEvents[0].stepFromBlock).to.eql(0)
    expect(fetchedEvents[0].stepToBlock).to.eql(11)

    expect(fetchedEventsSecondTime).to.have.length(0)

    eth.received(2).getBlock('latest') // Latest block will be called twice
    contract.received(1).getPastEvents('allEvents', { // But getPastEvents should be only once
      fromBlock: 0,
      toBlock: 11,
      topics: []
    })
  })

  it('should thrown when from block is bigger then to block', async function () {
    const contract = Substitute.for<Contract>()
    const eth = Substitute.for<Eth>()
    eth.getBlock('latest').resolves(blockMock(11))

    const blockTracker = new BlockTracker({})
    blockTracker.setLastFetchedBlock(13, '0x123')
    const options = { events: ['testEvent'] }
    const eventsEmitter = new ManualEventsEmitter(eth, contract, blockTracker, loggingFactory('web3events:events:dummy'), options)

    await expect(wholeGenerator(eventsEmitter.fetch())).to.be.rejectedWith('"from" block is bigger then "to" block (13 > 11)')
  })

  describe('batch processing', function () {
    it('should work in batches and emit progress info', async () => {
      const eth = Substitute.for<Eth>()
      eth.getBlock(14).resolves(blockMock(14))
      eth.getBlock(19).resolves(blockMock(19))
      eth.getBlock(24).resolves(blockMock(14))
      eth.getBlock(25).resolves(blockMock(25))
      eth.getBlock(29).resolves(blockMock(29))
      eth.getBlock(31).resolves(blockMock(31))

      const contract = Substitute.for<Contract>()
      contract.getPastEvents(Arg.all()).resolves(
        [eventMock({ blockHash: '0x123', blockNumber: 10 })],
        [eventMock({ blockHash: '0x123', blockNumber: 16 })],
        [eventMock({ blockHash: '0x123', blockNumber: 21 })],
        [eventMock({ blockHash: '0x123', blockNumber: 25 })],
        [eventMock({ blockHash: '0x123', blockNumber: 26 })],
        [eventMock({ blockHash: '0x123', blockNumber: 31 })]
      )

      const blockTracker = new BlockTracker({})
      blockTracker.setLastFetchedBlock(9, '0x123')
      const lastFetchedBlockSetSpy = sinon.spy()
      blockTracker.on('fetchedBlockSet', lastFetchedBlockSetSpy)

      const options: ManualEventsEmitterOptions = { events: ['testEvent'], batchSize: 5 }
      const progressInfoSpy = sinon.spy()
      const eventsEmitter = new ManualEventsEmitter(eth, contract, blockTracker, loggingFactory('web3events:test'), options)
      eventsEmitter.on(PROGRESS_EVENT_NAME, progressInfoSpy)
      await setImmediatePromise() // Have to give enough time for the subscription to newBlockEmitter was picked up

      // As it is closed interval it should lead to 4 batches: 3*5 + 1
      const firstCall = await wholeGenerator(eventsEmitter.fetch({ currentBlock: blockMock(25) })) // Fire up the first processing
      // Second processing should have 2 batches
      const secondCall = await wholeGenerator(eventsEmitter.fetch({ currentBlock: blockMock(31) })) // Fire up the first processing

      expect(firstCall).to.have.length(4)
      expect(secondCall).to.have.length(2)

      const TOTAL_BATCHES = 6
      eth.received(TOTAL_BATCHES).getBlock(Arg.all())
      contract.received(TOTAL_BATCHES).getPastEvents(Arg.all())
      expect(lastFetchedBlockSetSpy).to.have.callCount(TOTAL_BATCHES)
      expect(progressInfoSpy).to.have.callCount(TOTAL_BATCHES)
      expect(blockTracker.getLastFetchedBlock()).to.eql([31, '0x123'])
      expect(progressInfoSpy.firstCall).to.calledWithExactly({
        stepsComplete: 1,
        totalSteps: 4,
        stepFromBlock: 10,
        stepToBlock: 14
      })
      expect(progressInfoSpy.secondCall).to.calledWithExactly({
        stepsComplete: 2,
        totalSteps: 4,
        stepFromBlock: 15,
        stepToBlock: 19
      })
      expect(progressInfoSpy.thirdCall).to.calledWithExactly({
        stepsComplete: 3,
        totalSteps: 4,
        stepFromBlock: 20,
        stepToBlock: 24
      })
      expect(progressInfoSpy.getCall(3)).to.calledWithExactly({
        stepsComplete: 4,
        totalSteps: 4,
        stepFromBlock: 25,
        stepToBlock: 25
      })
      expect(progressInfoSpy.getCall(4)).to.calledWithExactly({
        stepsComplete: 1,
        totalSteps: 2,
        stepFromBlock: 26,
        stepToBlock: 30
      })
      expect(progressInfoSpy.getCall(5)).to.calledWithExactly({
        stepsComplete: 2,
        totalSteps: 2,
        stepFromBlock: 31,
        stepToBlock: 31
      })
    })

    it('should correctly fetch only one block', async () => {
      const eth = Substitute.for<Eth>()
      eth.getBlock(25).resolves(blockMock(25))

      const contract = Substitute.for<Contract>()
      contract.getPastEvents(Arg.all()).resolves(
        [eventMock({ blockHash: '0x123', blockNumber: 25 })]
      )

      const blockTracker = new BlockTracker({})
      blockTracker.setLastFetchedBlock(24, '0x123')
      const lastFetchedBlockSetSpy = sinon.spy()
      blockTracker.on('fetchedBlockSet', lastFetchedBlockSetSpy)

      const options: ManualEventsEmitterOptions = { events: ['testEvent'], batchSize: 5 }
      const progressInfoSpy = sinon.spy()
      const eventsEmitter = new ManualEventsEmitter(eth, contract, blockTracker, loggingFactory('web3events:test'), options)
      eventsEmitter.on(PROGRESS_EVENT_NAME, progressInfoSpy)

      const firstCall = await wholeGenerator(eventsEmitter.fetch({ currentBlock: blockMock(25) })) // Fire up the first processing

      expect(firstCall).to.have.length(1)

      const TOTAL_BATCHES = 1
      eth.received(TOTAL_BATCHES).getBlock(Arg.all())
      contract.received(TOTAL_BATCHES).getPastEvents(Arg.all())
      expect(lastFetchedBlockSetSpy).to.have.callCount(TOTAL_BATCHES)
      expect(progressInfoSpy).to.have.callCount(TOTAL_BATCHES)
      expect(progressInfoSpy).to.calledOnceWithExactly({
        stepsComplete: 1,
        totalSteps: 1,
        stepFromBlock: 25,
        stepToBlock: 25
      })
      expect(blockTracker.getLastFetchedBlock()).to.eql([25, '0x123'])
    })
  })

  describe('reorg handling', function () {
    it('should handle reorg without nothing processed yet', async () => {
      const eth = Substitute.for<Eth>()
      eth.getBlock(10).resolves(blockMock(10, '0x321')) // Different hash ==> reorg

      const mockedEvents = [
        {
          contractAddress: '0x123',
          event: 'testEvent',
          blockNumber: 7,
          transactionHash: '1',
          targetConfirmation: 3,
          emitted: true,
          content: '{"event": "testEvent", "blockNumber": 7, "blockHash": "0x123"}'
        },
        {
          contractAddress: '0x123',
          event: 'testEvent',
          blockNumber: 8,
          transactionHash: '2',
          targetConfirmation: 4,
          emitted: false,
          content: '{"event": "testEvent", "blockNumber": 8, "blockHash": "0x123"}'
        },
        {
          contractAddress: '0x666',
          event: 'niceEvent',
          blockNumber: 9,
          transactionHash: '3',
          targetConfirmation: 2,
          emitted: false,
          content: '{"event": "niceEvent", "blockNumber": 9, "blockHash": "0x123"}'
        }
      ]
      await Event.bulkCreate(mockedEvents)

      const contract = Substitute.for<Contract>()
      contract.address.returns!('0x123')
      contract.getPastEvents(Arg.all()).resolves(
        [eventMock({ blockNumber: 11, transactionHash: '1' })]
      )

      const blockTracker = new BlockTracker({})
      blockTracker.setLastFetchedBlock(10, '0x123')

      const options = {
        confirmations: 1,
        confirmator: Substitute.for<ModelConfirmator<any>>(),
        events: ['testEvent']
      }
      const reorgSpy = sinon.spy()
      const reorgOutOfRangeSpy = sinon.spy()
      const eventsEmitter = new ManualEventsEmitter(eth, contract, blockTracker, loggingFactory('web3events:test'), options)
      eventsEmitter.on(REORG_EVENT_NAME, reorgSpy)
      eventsEmitter.on(REORG_OUT_OF_RANGE_EVENT_NAME, reorgOutOfRangeSpy)
      await setImmediatePromise()

      const events = await wholeGenerator(eventsEmitter.fetch({ currentBlock: blockMock(11) }))

      contract.received(1).getPastEvents(Arg.all())
      eth.received(1).getBlock(Arg.all())
      expect(blockTracker.getLastFetchedBlock()).to.eql([11, '0x123'])
      expect(events).to.have.length(0)
      expect(reorgSpy).to.have.callCount(1)
      expect(reorgOutOfRangeSpy).to.have.callCount(0)
      expect(await Event.count()).to.eql(2)
    })

    it('should handle reorg with already processed events', async () => {
      const eth = Substitute.for<Eth>()
      eth.getBlock(10).resolves(blockMock(10, '0x321')) // Different hash ==> reorg
      eth.getBlock(8).resolves(blockMock(8, '0x222')) // Same hash ==> reorg in confirmation range

      const contract = Substitute.for<Contract>()
      contract.address.returns!('0x123')
      contract.getPastEvents('allEvents', { fromBlock: 9, toBlock: 11 }).resolves( // 9 because we don't want to reprocess 8th already processed block
        [eventMock({ blockNumber: 11, transactionHash: '1' })]
      )

      const blockTracker = new BlockTracker({})
      blockTracker.setLastFetchedBlock(10, '0x123')
      blockTracker.setLastProcessedBlockIfHigher(8, '0x222')

      const options = {
        confirmations: 1,
        confirmator: Substitute.for<ModelConfirmator<any>>(),
        events: ['testEvent']
      }
      const reorgSpy = sinon.spy()
      const reorgOutOfRangeSpy = sinon.spy()
      const eventsEmitter = new ManualEventsEmitter(eth, contract, blockTracker, loggingFactory('web3events:test'), options)
      eventsEmitter.on(REORG_EVENT_NAME, reorgSpy)
      eventsEmitter.on(REORG_OUT_OF_RANGE_EVENT_NAME, reorgOutOfRangeSpy)
      await setImmediatePromise()

      const events = await wholeGenerator(eventsEmitter.fetch({ currentBlock: blockMock(11) }))

      contract.received(1).getPastEvents('allEvents', { fromBlock: 9, toBlock: 11 })
      eth.received(2).getBlock(Arg.all())
      expect(blockTracker.getLastFetchedBlock()).to.eql([11, '0x123'])
      expect(events).to.have.length(0)
      expect(reorgSpy).to.have.callCount(1)
      expect(reorgOutOfRangeSpy).to.have.callCount(0)
      expect(await Event.count()).to.eql(1)
    })

    it('should handle reorg and detect reorg outside of confirmation range', async () => {
      const eth = Substitute.for<Eth>()
      eth.getBlock(10).resolves(blockMock(10, '0x321')) // Different hash ==> reorg
      eth.getBlock(8).resolves(blockMock(8, '0x33')) // Different hash ==> reorg OUTSIDE of confirmation range

      const contract = Substitute.for<Contract>()
      contract.address.returns!('0x123')
      contract.getPastEvents(Arg.all()).resolves(
        [eventMock({ blockNumber: 11, transactionHash: '1' })]
      )

      const blockTracker = new BlockTracker({})
      blockTracker.setLastFetchedBlock(10, '0x123')
      blockTracker.setLastProcessedBlockIfHigher(8, '0x222')

      const options = {
        confirmations: 1,
        confirmator: Substitute.for<ModelConfirmator<any>>(),
        events: ['testEvent']
      }
      const reorgSpy = sinon.spy()
      const reorgOutOfRangeSpy = sinon.spy()
      const eventsEmitter = new ManualEventsEmitter(eth, contract, blockTracker, loggingFactory('web3events:test'), options)
      eventsEmitter.on(REORG_EVENT_NAME, reorgSpy)
      eventsEmitter.on(REORG_OUT_OF_RANGE_EVENT_NAME, reorgOutOfRangeSpy)
      await setImmediatePromise()

      const events = await wholeGenerator(eventsEmitter.fetch({ currentBlock: blockMock(11) }))

      contract.received(1).getPastEvents(Arg.all())
      eth.received(2).getBlock(Arg.all())
      expect(events).to.have.length(0)
      expect(blockTracker.getLastFetchedBlock()).to.eql([11, '0x123'])
      expect(reorgSpy).to.have.callCount(1)
      expect(reorgOutOfRangeSpy).to.have.callCount(1)
      expect(await Event.count()).to.eql(1)
    })
  })

  describe('with confirmations', () => {
    it('should process past events', async function () {
      const events = [
        eventMock({ blockHash: '0x123', blockNumber: 1, transactionHash: '1' }),
        eventMock({ blockHash: '0x125', blockNumber: 8, transactionHash: '2' }),
        eventMock({ blockHash: '0x123', blockNumber: 9, transactionHash: '3' }),
        eventMock({ blockHash: '0x123', blockNumber: 10, transactionHash: '4' })
      ]

      const eth = Substitute.for<Eth>()
      eth.getBlock(10).resolves(blockMock(10))

      const contract = Substitute.for<Contract>()
      contract.getPastEvents(Arg.all()).resolves(events)

      const blockTracker = new BlockTracker({})
      // We deliberately disable Confirmator in order not to intervene with our assertions
      const options: ManualEventsEmitterOptions = {
        confirmations: 2,
        events: ['testEvent'],
        confirmator: null,
        startingBlock: 0
      }
      const eventsEmitter = new ManualEventsEmitter(eth, contract, blockTracker, loggingFactory('web3events:test'), options)

      const confirmedEvents = await wholeGenerator(eventsEmitter.fetch({ currentBlock: blockMock(10) }))

      expect(confirmedEvents).to.have.length(1)
      expect(confirmedEvents[0].stepFromBlock).to.eql(0)
      expect(confirmedEvents[0].stepToBlock).to.eql(10)
      expect(confirmedEvents[0].events).to.have.length(2) // 2 events emitted
      contract.received(1).getPastEvents(Arg.all())
      expect(await Event.count()).to.eql(2)
      expect(blockTracker.getLastProcessedBlock()).to.eql([8, '0x125'])
      expect(blockTracker.getLastFetchedBlock()).to.eql([10, '0x123'])
    })

    it('should process new events', async function () {
      const events = [
        eventMock({ blockNumber: 4, blockHash: '0x123', transactionHash: '1' }),
        eventMock({ blockNumber: 8, blockHash: '0x123', transactionHash: '2' }),
        eventMock({ blockNumber: 9, blockHash: '0x123', transactionHash: '3' }),
        eventMock({ blockNumber: 10, blockHash: '0x123', transactionHash: '4' })
      ]

      const contract = Substitute.for<Contract>()
      contract.address.returns!('0x123')
      contract.getPastEvents(Arg.all()).resolves(events)

      const eth = Substitute.for<Eth>()
      eth.getBlock(3).resolves(blockMock(3, '0x11111'))
      eth.getBlock(8).resolves(blockMock(8))
      eth.getBlock(10).resolves(blockMock(10))

      const blockTracker = new BlockTracker({})
      blockTracker.setLastFetchedBlock(3, '0x11111')

      // We deliberately disable Confirmator in order not to intervene with our assertions
      const options = { confirmations: 2, events: ['testEvent'], confirmator: null }
      const eventsEmitter = new ManualEventsEmitter(eth, contract, blockTracker, loggingFactory('web3events:test'), options)
      const confirmedEvents = await wholeGenerator(eventsEmitter.fetch({ currentBlock: blockMock(10) }))

      expect(confirmedEvents).to.have.length(1)
      expect(confirmedEvents[0].stepFromBlock).to.eql(4)
      expect(confirmedEvents[0].stepToBlock).to.eql(10)
      expect(blockTracker.getLastFetchedBlock()).to.eql([10, '0x123'])
      expect(blockTracker.getLastProcessedBlock()).to.eql([8, '0x123'])
      expect(confirmedEvents[0].events).to.have.length(2) // 2 events emitted
      expect(await Event.count()).to.eql(2)
      contract.received(1).getPastEvents(Arg.all())
    })

    it('should confirm saved events', async function () {
      const savedEvents = [
        { // Emitted newEvent
          contractAddress: '0x123',
          event: 'testEvent',
          blockNumber: 9,
          transactionHash: '3',
          targetConfirmation: 2,
          emitted: false,
          content: '{"event": "testEvent", "blockNumber": 9, "blockHash": "0x123"}'
        },
        { // Emitted newEvent
          contractAddress: '0x123',
          event: 'testEvent',
          blockNumber: 9,
          transactionHash: '3',
          targetConfirmation: 2,
          emitted: false,
          content: '{"event": "testEvent", "blockNumber": 9, "blockHash": "0x123"}'
        }
      ]
      await Event.bulkCreate(savedEvents)

      const contract = Substitute.for<Contract>()
      contract.address.returns!('0x123')
      contract.getPastEvents(Arg.all()).resolves(
        [eventMock({ blockNumber: 12, blockHash: '0x123', transactionHash: '3' })],
        [eventMock({ blockNumber: 14, blockHash: '0x123', transactionHash: '4' })]
      )

      const eth = Substitute.for<Eth>()
      eth.getBlock(10).resolves(blockMock(10))
      eth.getBlock(12).resolves(blockMock(12))
      eth.getBlock(14).resolves(blockMock(14))
      eth.getTransactionReceipt('3').resolves(receiptMock(9))

      const blockTracker = new BlockTracker({})
      blockTracker.setLastProcessedBlockIfHigher(8, '0x123')
      blockTracker.setLastFetchedBlock(10, '0x123')

      const options = { confirmations: 2, events: ['testEvent'], batchSize: 2 }
      const eventsEmitter = new ManualEventsEmitter(eth, contract, blockTracker, loggingFactory('web3events:test'), options)

      const confirmedEvents = await wholeGenerator(eventsEmitter.fetch({ currentBlock: blockMock(14) }))

      expect(confirmedEvents).to.have.length(3)

      // First batch is confirmed events
      expect(confirmedEvents[0].stepFromBlock).to.eql(8)
      expect(confirmedEvents[0].stepToBlock).to.eql(9)
      expect(confirmedEvents[0].events).to.have.length(2) // 2 confirmed events
      expect(confirmedEvents[0].events[0]).to.eql({ event: 'testEvent', blockNumber: 9, blockHash: '0x123' })
      expect(confirmedEvents[0].events[1]).to.eql({ event: 'testEvent', blockNumber: 9, blockHash: '0x123' })

      // Second batch is fetched events
      expect(confirmedEvents[1].stepFromBlock).to.eql(11)
      expect(confirmedEvents[1].stepToBlock).to.eql(12)
      expect(confirmedEvents[1].events).to.have.length(1)

      // Third batch is fetched events
      expect(confirmedEvents[2].stepFromBlock).to.eql(13)
      expect(confirmedEvents[2].stepToBlock).to.eql(14)
      expect(confirmedEvents[2].events).to.have.length(0) // Nothing is emitted from fetched events as confirmations are needed

      expect(blockTracker.getLastFetchedBlock()).to.eql([14, '0x123'])
      expect(blockTracker.getLastProcessedBlock()).to.eql([12, '0x123'])
      expect(await Event.count()).to.eql(3)
      contract.received(2).getPastEvents(Arg.all())
    })

    it('should confirm saved events only to given block number', async function () {
      const savedEvents = [
        { // Emitted newEvent
          contractAddress: '0x123',
          event: 'testEvent',
          blockNumber: 7,
          transactionHash: '1',
          targetConfirmation: 3,
          emitted: false,
          content: '{"event": "testEvent", "blockNumber": 7, "blockHash": "0x123"}'
        },
        { // Emitted newEvent
          contractAddress: '0x123',
          event: 'testEvent',
          blockNumber: 10,
          transactionHash: '2',
          targetConfirmation: 3,
          emitted: false,
          content: '{"event": "testEvent", "blockNumber": 10, "blockHash": "0x123"}'
        },
        { // Emitted newEvent
          contractAddress: '0x123',
          event: 'testEvent',
          blockNumber: 11,
          transactionHash: '3',
          targetConfirmation: 3,
          emitted: false,
          content: '{"event": "testEvent", "blockNumber": 11, "blockHash": "0x123"}'
        }
      ]
      await Event.bulkCreate(savedEvents)

      const contract = Substitute.for<Contract>()
      contract.address.returns!('0x123')
      contract.getPastEvents(Arg.all()).resolves([])

      const eth = Substitute.for<Eth>()
      eth.getBlock(9).resolves(blockMock(9))
      eth.getBlock(10).resolves(blockMock(10))
      eth.getTransactionReceipt('1').resolves(receiptMock(7))
      eth.getTransactionReceipt('2').resolves(receiptMock(10))
      eth.getTransactionReceipt('3').resolves(receiptMock(11))

      const blockTracker = new BlockTracker({})
      blockTracker.setLastProcessedBlockIfHigher(6, '0x123')
      blockTracker.setLastFetchedBlock(9, '0x123')

      const options = { confirmations: 3, events: ['testEvent'], batchSize: 2 }
      const eventsEmitter = new ManualEventsEmitter(eth, contract, blockTracker, loggingFactory('web3events:test'), options)

      // Fetch only to block number 8
      const confirmedEvents = await wholeGenerator(eventsEmitter.fetch({ toBlockNumber: 10, currentBlock: blockMock(14) }))

      expect(confirmedEvents).to.have.length(2)

      // First batch is confirmed events
      expect(confirmedEvents[0].stepFromBlock).to.eql(6)
      expect(confirmedEvents[0].stepToBlock).to.eql(10)
      expect(confirmedEvents[0].events).to.have.length(2) // only 2 confirmed events
      expect(confirmedEvents[0].events[0]).to.eql({ event: 'testEvent', blockNumber: 7, blockHash: '0x123' })
      expect(confirmedEvents[0].events[1]).to.eql({ event: 'testEvent', blockNumber: 10, blockHash: '0x123' })

      // Second batch is fetched events
      expect(confirmedEvents[1].stepFromBlock).to.eql(10)
      expect(confirmedEvents[1].stepToBlock).to.eql(10)
      expect(confirmedEvents[1].events).to.have.length(0) // Nothing is emitted as no events were fetched

      expect(blockTracker.getLastFetchedBlock()).to.eql([10, '0x123'])
      expect(blockTracker.getLastProcessedBlock()).to.eql([10, '0x123'])
      contract.received(1).getPastEvents(Arg.all())
    })
  })

  describe('no confirmations', () => {
    it('should process past events', async function () {
      const events = [
        eventMock({ blockNumber: 7, event: 'testEvent', returnValues: { hey: 123 } }),
        eventMock({ blockNumber: 8, event: 'testEvent', returnValues: { hey: 123 } }),
        eventMock({ blockNumber: 9, event: 'testEvent', returnValues: { hey: 123 } })
      ]

      const eth = Substitute.for<Eth>()
      eth.getBlock(10).resolves(blockMock(10))

      const contract = Substitute.for<Contract>()
      contract.getPastEvents(Arg.all()).resolves(events)

      const blockTracker = new BlockTracker({})
      const options: ManualEventsEmitterOptions = { events: ['testEvent'], startingBlock: 0 }
      const eventsEmitter = new ManualEventsEmitter(eth, contract, blockTracker, loggingFactory('web3events:test'), options)

      const confirmedEvents = await wholeGenerator(eventsEmitter.fetch({ currentBlock: blockMock(10) }))

      expect(confirmedEvents).to.have.length(1)
      expect(confirmedEvents[0].events).to.have.length(3) // 3 events emitted
      contract.received(1).getPastEvents(Arg.all())
      expect(blockTracker.getLastFetchedBlock()).to.eql([10, '0x123'])
    })

    it('should emits new events', async function () {
      const testEvent = eventMock()
      const events = [
        testEvent,
        testEvent,
        testEvent
      ]

      const eth = Substitute.for<Eth>()
      eth.getBlock(10).resolves(blockMock(10))

      const contract = Substitute.for<Contract>()
      contract.getPastEvents(Arg.all()).resolves(events)

      const blockTracker = new BlockTracker({})
      blockTracker.setLastFetchedBlock(6, '')

      const options = { events: ['testEvent'] }
      const eventsEmitter = new ManualEventsEmitter(eth, contract, blockTracker, loggingFactory('web3events:test'), options)
      const confirmedEvents = await wholeGenerator(eventsEmitter.fetch({ currentBlock: blockMock(10) }))

      expect(confirmedEvents).to.have.length(1)
      expect(confirmedEvents[0].events).to.have.length(3) // 3 events emitted
      expect(blockTracker.getLastFetchedBlock()).to.eql([10, '0x123'])
      contract.received(1).getPastEvents(Arg.all())
      eth.received(1).getBlock(10)
    })
  })
})
