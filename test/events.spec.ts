import { BlockHeader, Eth } from 'web3-eth'
import { Arg, Substitute } from '@fluffy-spoon/substitute'
import sinon from 'sinon'
import chai from 'chai'
import dirtyChai from 'dirty-chai'
import chaiAsPromised from 'chai-as-promised'
import util from 'util'
import sinonChai from 'sinon-chai'
import { Sequelize } from 'sequelize'
import { EventData } from 'web3-eth-contract'
import Emittery from 'emittery'

import { BaseEventsEmitter, PollingEventsEmitter } from '../src/events'
import { loggingFactory } from '../src/utils'
import Event from '../src/event.model'
import { blockMock, delayedPromise, eventMock, sequelizeFactory, sleep } from './utils'
import {
  BlockTracker,
  Contract,
  EventsEmitterOptions,
  Logger,
  ModelConfirmator,
  NEW_BLOCK_EVENT_NAME,
  NEW_EVENT_EVENT_NAME,
  NewBlockEmitter, PROGRESS_EVENT_NAME,
  REORG_EVENT_NAME,
  REORG_OUT_OF_RANGE_EVENT_NAME, Web3Events
} from '../src'

chai.use(sinonChai)
chai.use(chaiAsPromised)
chai.use(dirtyChai)
const expect = chai.expect
const setImmediatePromise = util.promisify(setImmediate)

/**
 * Dummy implementation for testing BaseEventsEmitter
 */
export class DummyEventsEmitter extends BaseEventsEmitter<EventData> {
  constructor (eth: Eth, contract: Contract, blockTracker: BlockTracker, newBlockEmitter: NewBlockEmitter, options?: EventsEmitterOptions, name?: string) {
    let logger: Logger

    if (!name) {
      logger = loggingFactory('web3events:events:dummy')
    } else {
      logger = loggingFactory('web3events:events:' + name)
    }

    super(eth, contract, blockTracker, newBlockEmitter, logger, options)
  }

  async createEvent (data: EventData | EventData[]): Promise<void> {
    await this.semaphore.acquire()
    try {
      return this.processEvents(data)
    } finally {
      this.semaphore.release()
    }
  }

  public batch (fromBlock: number, toBlock: number, currentBlock: BlockHeader): Promise<void> {
    return this.batchFetchAndProcessEvents(fromBlock, toBlock, currentBlock)
  }

  startEvents (): void {
    // noop
  }

  stopEvents (): void {
    // noop
  }
}

describe('BaseEventsEmitter', () => {
  let sequelize: Sequelize

  before((): void => {
    sequelize = sequelizeFactory()
    Web3Events.init(sequelize)
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
    eth.getBlockNumber().resolves(11)
    eth.getBlock('latest').resolves(blockMock(11))

    const [getPastEventsPromise, getPastEventsCallback] = delayedPromise()
    const contract = Substitute.for<Contract>()
    contract.getPastEvents(Arg.all()).returns(getPastEventsPromise) // Blocks the getPastEvents call

    const blockTracker = new BlockTracker({})
    const newBlockEmitter = new Emittery()
    const options = { events: ['testEvent'] }
    const spy = sinon.spy()
    const eventsEmitter = new DummyEventsEmitter(eth, contract, blockTracker, newBlockEmitter as NewBlockEmitter, options)
    eventsEmitter.on(NEW_EVENT_EVENT_NAME, spy) // Will start processingPastEvents() which will be delayed

    // Directly calling processEvents(), which should be blocked by the processingPastEvents()
    const createEventPromise = eventsEmitter.createEvent(events)
    eth.received(0).getBlockNumber() // This asserts that the `processEvents` was not yet called, as that is the only place where getBlockNumber is used

    // Unblock the getPastEvents call
    getPastEventsCallback(events)
    await sleep(50)
    eth.received(1).getBlock('latest')

    // After the processingEvents() is finished
    await createEventPromise
    eth.received(1).getBlock('latest')
    eth.received(1).getBlockNumber()
  })

  it('should process listeners in serial order when configured', async function () {
    const events = [eventMock({ blockHash: '0x123', blockNumber: 4, transactionHash: '1' })]

    const eth = Substitute.for<Eth>()
    eth.getBlock('latest').resolves(blockMock(10))

    const contract = Substitute.for<Contract>()
    contract.getPastEvents(Arg.all()).resolves(events)

    const blockTracker = new BlockTracker({})
    const newBlockEmitter = new Emittery()
    const options: EventsEmitterOptions = { events: ['testEvent'], serialListeners: true }
    const eventsEmitter = new DummyEventsEmitter(eth, contract, blockTracker, newBlockEmitter as NewBlockEmitter, options)

    const spy1 = sinon.spy()
    const [listener1Promise, listener1Callback] = delayedPromise()

    const spy2 = sinon.spy()
    const [listener2Promise, listener2Callback] = delayedPromise()

    const spy3 = sinon.spy()
    const [listener3Promise, listener3Callback] = delayedPromise()

    // Upon first emitter the EventsEmitter start fetching past events
    // the processing will be blocked on it though with the `listener1Promise`
    eventsEmitter.on(NEW_EVENT_EVENT_NAME, async (e) => {
      await listener1Promise
      spy1(e)
    })
    eventsEmitter.on(NEW_EVENT_EVENT_NAME, async (e) => {
      await listener2Promise
      spy2(e)
    })
    eventsEmitter.on(NEW_EVENT_EVENT_NAME, async (e) => {
      await listener3Promise
      spy3(e)
    })

    // Lets wait for everything to setup
    await setImmediatePromise()

    // The processing is still blocked with the `listener1Promise` so nothing should be blocked
    expect(spy1).to.not.be.called()
    expect(spy2).to.not.be.called()
    expect(spy3).to.not.be.called()

    // Lets unblock the first listener
    listener1Callback()
    await setImmediatePromise()

    expect(spy1).to.be.calledOnce() // Now only first listener should be process
    expect(spy2).to.not.be.called() // Second listeners blocks the processing
    expect(spy3).to.not.be.called()

    listener2Callback()
    await setImmediatePromise()

    expect(spy1).to.be.calledOnce()
    expect(spy2).to.be.calledOnce()
    expect(spy3).to.not.be.called()

    listener3Callback()
    await setImmediatePromise()

    expect(spy1).to.be.calledOnce()
    expect(spy2).to.be.calledOnce()
    expect(spy3).to.be.calledOnce()
  })

  it('should process events in serial order when configured', async function () {
    const events = [
      eventMock({ blockHash: '0x123', blockNumber: 4, transactionHash: '1' }),
      eventMock({ blockHash: '0x124', blockNumber: 8, transactionHash: '2' }),
      eventMock({ blockHash: '0x125', blockNumber: 9, transactionHash: '3' }),
      eventMock({ blockHash: '0x126', blockNumber: 10, transactionHash: '4' })
    ]

    const eth = Substitute.for<Eth>()
    eth.getBlockNumber().resolves(11)
    eth.getBlock('latest').resolves(blockMock(11))

    const contract = Substitute.for<Contract>()
    contract.getPastEvents(Arg.all()).resolves(events)

    const blockTracker = new BlockTracker({})
    const newBlockEmitter = new Emittery()
    const options = { events: ['testEvent'], serialProcessing: true }
    const eventsEmitter = new DummyEventsEmitter(eth, contract, blockTracker, newBlockEmitter as NewBlockEmitter, options)

    const spy = sinon.spy()
    let releaseCb: Function
    // Listener that blocks processing until we call releaseCb
    eventsEmitter.on(NEW_EVENT_EVENT_NAME, async (e): Promise<void> => {
      const [delayedProm, delayedCb] = delayedPromise()
      releaseCb = delayedCb
      await delayedProm
      spy(e)
    })
    await setImmediatePromise()

    // Still blocked
    expect(spy).to.not.be.called()

    releaseCb!() // Release processing of one event
    await setImmediatePromise()
    expect(spy).to.be.calledOnce()

    // getLastProcessedBlock should be set only once processing of event is finished
    // (IF the serial events is happening) otherwise it does not awaits its completation of processing!
    expect(blockTracker.getLastProcessedBlock()).to.eql([4, '0x123'])

    releaseCb!() // Release processing of another event
    await setImmediatePromise()
    expect(spy).to.be.calledTwice()
    expect(blockTracker.getLastProcessedBlock()).to.eql([8, '0x124'])

    releaseCb!() // Release processing of another event
    await setImmediatePromise()
    expect(spy).to.be.calledThrice()
    expect(blockTracker.getLastProcessedBlock()).to.eql([9, '0x125'])

    releaseCb!() // Release processing of another event
    await setImmediatePromise()
    expect(blockTracker.getLastProcessedBlock()).to.eql([10, '0x126'])
  })

  describe('batch processing', function () {
    it('should work in batches and emit progress info', async () => {
      const eth = Substitute.for<Eth>()
      eth.getBlock(14).resolves(blockMock(14))
      eth.getBlock(19).resolves(blockMock(19))
      eth.getBlock(24).resolves(blockMock(14))
      eth.getBlock(25).resolves(blockMock(25))

      const contract = Substitute.for<Contract>()
      contract.getPastEvents(Arg.all()).resolves(
        [eventMock({ blockHash: '0x123', blockNumber: 10 })],
        [eventMock({ blockHash: '0x123', blockNumber: 16 })],
        [eventMock({ blockHash: '0x123', blockNumber: 21 })],
        [eventMock({ blockHash: '0x123', blockNumber: 25 })]
      )

      const blockTracker = new BlockTracker({})
      blockTracker.setLastFetchedBlock(10, '0x123') // Leads to no past-events processing
      const lastFetchedBlockSetSpy = sinon.spy()
      blockTracker.on('fetchedBlockSet', lastFetchedBlockSetSpy)

      const newBlockEmitter = new Emittery()
      const options: EventsEmitterOptions = { events: ['testEvent'], batchSize: 5 }
      const newEventSpy = sinon.spy()
      const progressInfoSpy = sinon.spy()
      const eventsEmitter = new DummyEventsEmitter(eth, contract, blockTracker, newBlockEmitter as NewBlockEmitter, options)
      eventsEmitter.on(NEW_EVENT_EVENT_NAME, newEventSpy)
      eventsEmitter.on(PROGRESS_EVENT_NAME, progressInfoSpy)

      // As it is closed interval it should lead to 4 batches: 3*5 + 1
      await eventsEmitter.batch(10, 25, blockMock(25))

      const TOTAL_BATCHES = 4
      eth.received(TOTAL_BATCHES).getBlock(Arg.all())
      contract.received(TOTAL_BATCHES).getPastEvents(Arg.all())
      expect(lastFetchedBlockSetSpy).to.have.callCount(TOTAL_BATCHES)
      expect(progressInfoSpy).to.have.callCount(TOTAL_BATCHES)
      expect(blockTracker.getLastFetchedBlock()).to.eql([25, '0x123'])
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
    })

    it('should correctly fetch only one block', async () => {
      const eth = Substitute.for<Eth>()
      eth.getBlock(25).resolves(blockMock(25))

      const contract = Substitute.for<Contract>()
      contract.getPastEvents(Arg.all()).resolves(
        [eventMock({ blockHash: '0x123', blockNumber: 25 })]
      )

      const blockTracker = new BlockTracker({})
      blockTracker.setLastFetchedBlock(10, '0x123') // Leads to no past-events processing
      const lastFetchedBlockSetSpy = sinon.spy()
      blockTracker.on('fetchedBlockSet', lastFetchedBlockSetSpy)

      const newBlockEmitter = new Emittery()
      const options: EventsEmitterOptions = { events: ['testEvent'], batchSize: 5 }
      const newEventSpy = sinon.spy()
      const progressInfoSpy = sinon.spy()
      const eventsEmitter = new DummyEventsEmitter(eth, contract, blockTracker, newBlockEmitter as NewBlockEmitter, options)
      eventsEmitter.on(NEW_EVENT_EVENT_NAME, newEventSpy)
      eventsEmitter.on(PROGRESS_EVENT_NAME, progressInfoSpy)

      await eventsEmitter.batch(25, 25, blockMock(25))

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

    it('should validate inputs', async () => {
      const eth = Substitute.for<Eth>()
      const contract = Substitute.for<Contract>()

      const blockTracker = new BlockTracker({})
      blockTracker.setLastFetchedBlock(10, '0x123') // Leads to no past-events processing
      const newBlockEmitter = new Emittery()
      const options: EventsEmitterOptions = { events: ['testEvent'], batchSize: 5 }
      const newEventSpy = sinon.spy()
      const progressInfoSpy = sinon.spy()
      const eventsEmitter = new DummyEventsEmitter(eth, contract, blockTracker, newBlockEmitter as NewBlockEmitter, options)
      eventsEmitter.on(NEW_EVENT_EVENT_NAME, newEventSpy)
      eventsEmitter.on(PROGRESS_EVENT_NAME, progressInfoSpy)

      // @ts-ignore
      await expect(eventsEmitter.batch('genesis', 25, blockMock(25))).to.be.rejectedWith('fromBlock and toBlock has to be numbers!')
      await expect(eventsEmitter.batch(30, 25, blockMock(25))).to.be.rejectedWith('fromBlock has to be smaller then toBlock!')
    })
  })

  describe('with confirmations', () => {
    it('should process past events', async function () {
      const events = [
        eventMock({ blockHash: '0x123', blockNumber: 4, transactionHash: '1' }),
        eventMock({ blockHash: '0x125', blockNumber: 8, transactionHash: '2' }),
        eventMock({ blockHash: '0x123', blockNumber: 9, transactionHash: '3' }),
        eventMock({ blockHash: '0x123', blockNumber: 10, transactionHash: '4' })
      ]

      const eth = Substitute.for<Eth>()
      eth.getBlock('latest').resolves(blockMock(10))
      eth.getBlock(10).resolves(blockMock(10))

      const contract = Substitute.for<Contract>()
      contract.getPastEvents(Arg.all()).resolves(events)

      const blockTracker = new BlockTracker({})
      const newBlockEmitter = new Emittery()
      const options: EventsEmitterOptions = { confirmations: 2, events: ['testEvent'] }
      const spy = sinon.spy()
      const eventsEmitter = new DummyEventsEmitter(eth, contract, blockTracker, newBlockEmitter as NewBlockEmitter, options)
      eventsEmitter.on(NEW_EVENT_EVENT_NAME, spy)
      await sleep(1000)

      expect(spy).to.be.calledTwice()
      eth.received(1).getBlock('latest')
      contract.received(1).getPastEvents(Arg.all())
      expect(await Event.count()).to.eql(2)
      expect(blockTracker.getLastProcessedBlock()).to.eql([8, '0x125'])
      expect(blockTracker.getLastFetchedBlock()).to.eql([10, '0x123'])
    })

    it('should process new events', async function () {
      const contract = Substitute.for<Contract>()
      const eth = Substitute.for<Eth>()
      eth.getBlockNumber().resolves(10)

      const blockTracker = new BlockTracker({})
      blockTracker.setLastFetchedBlock(3, '') // Leads to no processPastEvents

      const newBlockEmitter = new Emittery()
      const options: EventsEmitterOptions = { confirmations: 2, events: ['testEvent'] }
      const spy = sinon.spy()
      const eventsEmitter = new DummyEventsEmitter(eth, contract, blockTracker, newBlockEmitter as NewBlockEmitter, options)
      eventsEmitter.on(NEW_EVENT_EVENT_NAME, spy)

      const events = [
        eventMock({ blockNumber: 4, transactionHash: '1' }),
        eventMock({ blockNumber: 8, transactionHash: '2' }),
        eventMock({ blockNumber: 9, transactionHash: '3' }),
        eventMock({ blockNumber: 10, transactionHash: '4' })
      ]
      await eventsEmitter.createEvent(events)

      expect(await Event.count()).to.eql(2)
      expect(spy.callCount).to.be.eql(2, 'Expected two events emitted.')
      eth.received(1).getBlockNumber()
      contract.received(0).getPastEvents(Arg.all())
    })
  })

  describe('no confirmations', () => {
    it('should process past events', async function () {
      const testEvent = eventMock()
      const events = [
        testEvent,
        testEvent,
        testEvent
      ]

      const eth = Substitute.for<Eth>()
      eth.getBlock('latest').resolves(blockMock(10))
      eth.getBlock(10).resolves(blockMock(10))

      const contract = Substitute.for<Contract>()
      contract.getPastEvents(Arg.all()).resolves(events)

      const blockTracker = new BlockTracker({})
      const newBlockEmitter = new Emittery()
      const options = { events: ['testEvent'] }
      const spy = sinon.spy()
      const eventsEmitter = new DummyEventsEmitter(eth, contract, blockTracker, newBlockEmitter as NewBlockEmitter, options)
      eventsEmitter.on(NEW_EVENT_EVENT_NAME, spy)
      await sleep(100)

      expect(spy.callCount).to.be.eql(3, 'Expected three events emitted.')
      eth.received(1).getBlock('latest')
      contract.received(1).getPastEvents(Arg.all())
      expect(blockTracker.getLastFetchedBlock()).to.eql([10, '0x123'])
    })

    it('should emits new events', async function () {
      const contract = Substitute.for<Contract>()
      const eth = Substitute.for<Eth>()
      eth.getBlockNumber().resolves(10)

      const blockTracker = new BlockTracker({})
      blockTracker.setLastFetchedBlock(6, '') // Leads to no processPastEvents

      const newBlockEmitter = new Emittery()
      const options = { events: ['testEvent'] }
      const spy = sinon.spy()
      const eventsEmitter = new DummyEventsEmitter(eth, contract, blockTracker, newBlockEmitter as NewBlockEmitter, options)

      const testEvent = eventMock()
      const events = [
        testEvent,
        testEvent,
        testEvent
      ]

      eventsEmitter.on(NEW_EVENT_EVENT_NAME, spy)
      await eventsEmitter.createEvent(events)
      await sleep(100) // In order to processPastEvents() finish

      expect(spy.callCount).to.be.eql(3, 'Expected three events emitted.')
      expect(blockTracker.getLastFetchedBlock()).to.eql([6, ''])
      contract.received(0).getPastEvents(Arg.all())
      eth.received(1).getBlockNumber()
    })
  })
})

describe('PollingEventsEmitter', function () {
  let sequelize: Sequelize

  before((): void => {
    sequelize = sequelizeFactory()
    Web3Events.init(sequelize)
  })

  beforeEach(async () => {
    await sequelize.sync({ force: true })
  })

  it('should emit new events', async function () {
    const eth = Substitute.for<Eth>()
    const contract = Substitute.for<Contract>()
    eth.getBlock(11).resolves(blockMock(11))
    eth.getBlock(12).resolves(blockMock(12))

    contract.getPastEvents(Arg.all()).resolves(
      [eventMock({ blockNumber: 11, event: 'testEvent', returnValues: { hey: 123 } })], // Value for polling new events
      [eventMock({ blockNumber: 12, event: 'testEvent', returnValues: { hey: 321 } })] // Value for polling new events
    )

    const blockTracker = new BlockTracker({})
    blockTracker.setLastFetchedBlock(10, '0x123') // Leads to no past-events processing

    const newBlockEmitter = new Emittery()
    const options = { events: ['testEvent'] }
    const newEventSpy = sinon.spy()
    const reorgSpy = sinon.spy()
    const reorgOutOfRangeSpy = sinon.spy()
    const eventsEmitter = new PollingEventsEmitter(eth, contract, blockTracker, newBlockEmitter as NewBlockEmitter, loggingFactory('web3events:test'), options)
    eventsEmitter.on(NEW_EVENT_EVENT_NAME, newEventSpy)
    eventsEmitter.on(REORG_EVENT_NAME, reorgSpy)
    eventsEmitter.on(REORG_OUT_OF_RANGE_EVENT_NAME, reorgOutOfRangeSpy)
    await setImmediatePromise()

    let newEventEmittedPromise = eventsEmitter.once(NEW_EVENT_EVENT_NAME)
    newBlockEmitter.emit(NEW_BLOCK_EVENT_NAME, blockMock(11))
    await newEventEmittedPromise

    newEventEmittedPromise = eventsEmitter.once(NEW_EVENT_EVENT_NAME)
    newBlockEmitter.emit(NEW_BLOCK_EVENT_NAME, blockMock(12))
    await newEventEmittedPromise
    await setImmediatePromise() // the setLastFetchedBlock() happens after the events are processed, so this will delay enough for the process to happen

    contract.received(2).getPastEvents(Arg.all())
    expect(blockTracker.getLastFetchedBlock()).to.eql([12, '0x123'])
    expect(newEventSpy).to.have.callCount(2)
    expect(reorgSpy).to.have.callCount(0)
    expect(reorgOutOfRangeSpy).to.have.callCount(0)
  })

  it('should not emit empty events', async function () {
    const eth = Substitute.for<Eth>()
    eth.getBlock(11).resolves(blockMock(11))
    eth.getBlock(12).resolves(blockMock(12))

    const contract = Substitute.for<Contract>()
    contract.getPastEvents(Arg.all()).resolves(
      [eventMock({ blockNumber: 11, event: 'testEvent', returnValues: { hey: 123 } })], // Value for polling new events
      [] // Value for polling new events
    )

    const blockTracker = new BlockTracker({})
    blockTracker.setLastFetchedBlock(10, '0x123')

    const newBlockEmitter = new Emittery()
    const options = { events: ['testEvent'] }
    const newEventSpy = sinon.spy()
    const reorgSpy = sinon.spy()
    const reorgOutOfRangeSpy = sinon.spy()
    const eventsEmitter = new PollingEventsEmitter(eth, contract, blockTracker, newBlockEmitter as NewBlockEmitter, loggingFactory('web3events:test'), options)
    eventsEmitter.on(NEW_EVENT_EVENT_NAME, newEventSpy)
    eventsEmitter.on(REORG_EVENT_NAME, reorgSpy)
    eventsEmitter.on(REORG_OUT_OF_RANGE_EVENT_NAME, reorgOutOfRangeSpy)
    await setImmediatePromise()

    let fetchedBlockSetPromise = blockTracker.once('fetchedBlockSet')
    newBlockEmitter.emit(NEW_BLOCK_EVENT_NAME, blockMock(11))
    await fetchedBlockSetPromise // That indicates end of processing for batchFetchAndProcess()

    fetchedBlockSetPromise = blockTracker.once('fetchedBlockSet')
    newBlockEmitter.emit(NEW_BLOCK_EVENT_NAME, blockMock(12))
    await fetchedBlockSetPromise

    contract.received(2).getPastEvents(Arg.all())
    expect(blockTracker.getLastFetchedBlock()).to.eql([12, '0x123'])
    expect(newEventSpy).to.have.callCount(1)
    expect(reorgSpy).to.have.callCount(0)
    expect(reorgOutOfRangeSpy).to.have.callCount(0)
  })

  it('should ignore same blocks', async function () {
    const eth = Substitute.for<Eth>()
    eth.getBlock(11).resolves(blockMock(11))

    const contract = Substitute.for<Contract>()
    contract.getPastEvents(Arg.all()).resolves(
      [eventMock({ blockNumber: 11 })] // Value for polling new events
    )

    const blockTracker = new BlockTracker({})
    blockTracker.setLastFetchedBlock(10, '0x123')

    const newBlockEmitter = new Emittery()
    const options = { events: ['testEvent'] }
    const newEventSpy = sinon.spy()
    const reorgSpy = sinon.spy()
    const reorgOutOfRangeSpy = sinon.spy()
    const eventsEmitter = new PollingEventsEmitter(eth, contract, blockTracker, newBlockEmitter as NewBlockEmitter, loggingFactory('web3events:test'), options)
    eventsEmitter.on(NEW_EVENT_EVENT_NAME, newEventSpy)
    eventsEmitter.on(REORG_EVENT_NAME, reorgSpy)
    eventsEmitter.on(REORG_OUT_OF_RANGE_EVENT_NAME, reorgOutOfRangeSpy)
    await setImmediatePromise()

    newBlockEmitter.emit(NEW_BLOCK_EVENT_NAME, blockMock(11))
    await sleep(100)

    newBlockEmitter.emit(NEW_BLOCK_EVENT_NAME, blockMock(11)) // Testing if same block is ignored
    await sleep(100)

    contract.received(1).getPastEvents(Arg.all())
    expect(blockTracker.getLastFetchedBlock()).to.eql([11, '0x123'])
    expect(newEventSpy).to.have.callCount(1)
    expect(reorgSpy).to.have.callCount(0)
    expect(reorgOutOfRangeSpy).to.have.callCount(0)
  })

  it('should wait for previous processing finished', async function () {
    const eth = Substitute.for<Eth>()
    eth.getBlockNumber().resolves(11)
    eth.getBlock('latest').resolves(blockMock(10))
    eth.getBlock(10).resolves(blockMock(10))
    eth.getBlock(11).resolves(blockMock(11))

    const [getPastEventsPromise1, getPastEventsCallback1] = delayedPromise()
    const [getPastEventsPromise2, getPastEventsCallback2] = delayedPromise()
    const contract = Substitute.for<Contract>()
    contract.getPastEvents(Arg.all()).returns(
      getPastEventsPromise1,
      getPastEventsPromise2
    ) // Blocks the getPastEvents calls

    const blockTracker = new BlockTracker({})
    const fetchedBlockSetSpy = sinon.spy()
    blockTracker.on('fetchedBlockSet', fetchedBlockSetSpy)

    const newBlockEmitter = new Emittery()
    const options = { events: ['testEvent'] }
    const spy = sinon.spy()
    const eventsEmitter = new PollingEventsEmitter(eth, contract, blockTracker, newBlockEmitter as NewBlockEmitter, loggingFactory('web3events:test'), options)
    eventsEmitter.on(NEW_EVENT_EVENT_NAME, spy) // Will start processPastEvents() which will be delayed
    await setImmediatePromise() // Have to give enough time for the subscription to newBlockEmitter was picked up

    // Directly calling processEvents(), which should be blocked by the processingPastEvents()
    newBlockEmitter.emit(NEW_BLOCK_EVENT_NAME, blockMock(11))
    expect(fetchedBlockSetSpy).to.have.callCount(0)

    // Unblock the processPastEvents call
    const fetchedPromise1 = blockTracker.once('fetchedBlockSet')
    getPastEventsCallback1([eventMock({ blockNumber: 10, transactionHash: '4' })])
    await fetchedPromise1
    expect(fetchedBlockSetSpy).to.have.callCount(1)
    contract.received(1).getPastEvents(Arg.all())
    expect(blockTracker.getLastFetchedBlock()).to.eql([10, '0x123'])

    // Unblock the processEvents
    const fetchedPromise2 = blockTracker.once('fetchedBlockSet')
    getPastEventsCallback2([eventMock({ blockNumber: 11, transactionHash: '4' })])
    await fetchedPromise2
    expect(fetchedBlockSetSpy).to.have.callCount(2)
    contract.received(2).getPastEvents(Arg.all())
    expect(blockTracker.getLastFetchedBlock()).to.eql([11, '0x123'])
  })

  describe('reorg handling', function () {
    it('should handle reorg without nothing processed yet', async () => {
      const eth = Substitute.for<Eth>()
      eth.getBlock(10).resolves(blockMock(10, '0x321')) // Different hash ==> reorg

      const events = [
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
      await Event.bulkCreate(events)

      const contract = Substitute.for<Contract>()
      contract.address.returns!('0x123')
      contract.getPastEvents(Arg.all()).resolves(
        [eventMock({ blockNumber: 11, transactionHash: '1' })]
      )

      const blockTracker = new BlockTracker({})
      blockTracker.setLastFetchedBlock(10, '0x123')

      const newBlockEmitter = new Emittery()
      const options = {
        confirmations: 1,
        confirmator: Substitute.for<ModelConfirmator>(),
        events: ['testEvent']
      }
      const newEventSpy = sinon.spy()
      const reorgSpy = sinon.spy()
      const reorgOutOfRangeSpy = sinon.spy()
      const eventsEmitter = new PollingEventsEmitter(eth, contract, blockTracker, newBlockEmitter as NewBlockEmitter, loggingFactory('web3events:test'), options)
      eventsEmitter.on(NEW_EVENT_EVENT_NAME, newEventSpy)
      eventsEmitter.on(REORG_EVENT_NAME, reorgSpy)
      eventsEmitter.on(REORG_OUT_OF_RANGE_EVENT_NAME, reorgOutOfRangeSpy)
      await setImmediatePromise()

      newBlockEmitter.emit(NEW_BLOCK_EVENT_NAME, blockMock(11))
      await sleep(200)

      contract.received(1).getPastEvents(Arg.all())
      eth.received(1).getBlock(Arg.all())
      expect(blockTracker.getLastFetchedBlock()).to.eql([11, '0x123'])
      expect(newEventSpy).to.have.callCount(0)
      expect(reorgSpy).to.have.callCount(1)
      expect(reorgOutOfRangeSpy).to.have.callCount(0)
      expect(await Event.count()).to.eql(2)
    })

    it('should handle reorg with already processed', async () => {
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

      const newBlockEmitter = new Emittery()
      const options = {
        confirmations: 1,
        confirmator: Substitute.for<ModelConfirmator>(),
        events: ['testEvent']
      }
      const newEventSpy = sinon.spy()
      const reorgSpy = sinon.spy()
      const reorgOutOfRangeSpy = sinon.spy()
      const eventsEmitter = new PollingEventsEmitter(eth, contract, blockTracker, newBlockEmitter as NewBlockEmitter, loggingFactory('web3events:test'), options)
      eventsEmitter.on(NEW_EVENT_EVENT_NAME, newEventSpy)
      eventsEmitter.on(REORG_EVENT_NAME, reorgSpy)
      eventsEmitter.on(REORG_OUT_OF_RANGE_EVENT_NAME, reorgOutOfRangeSpy)
      await setImmediatePromise()

      newBlockEmitter.emit(NEW_BLOCK_EVENT_NAME, blockMock(11))
      await sleep(200)

      contract.received(1).getPastEvents('allEvents', { fromBlock: 9, toBlock: 11 })
      eth.received(2).getBlock(Arg.all())
      expect(blockTracker.getLastFetchedBlock()).to.eql([11, '0x123'])
      expect(newEventSpy).to.have.callCount(0)
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

      const newBlockEmitter = new Emittery()
      const options = {
        confirmations: 1,
        confirmator: Substitute.for<ModelConfirmator>(),
        events: ['testEvent']
      }
      const newEventSpy = sinon.spy()
      const reorgSpy = sinon.spy()
      const reorgOutOfRangeSpy = sinon.spy()
      const eventsEmitter = new PollingEventsEmitter(eth, contract, blockTracker, newBlockEmitter as NewBlockEmitter, loggingFactory('web3events:test'), options)
      eventsEmitter.on(NEW_EVENT_EVENT_NAME, newEventSpy)
      eventsEmitter.on(REORG_EVENT_NAME, reorgSpy)
      eventsEmitter.on(REORG_OUT_OF_RANGE_EVENT_NAME, reorgOutOfRangeSpy)
      await setImmediatePromise()

      newBlockEmitter.emit(NEW_BLOCK_EVENT_NAME, blockMock(11))
      await sleep(200)

      contract.received(1).getPastEvents(Arg.all())
      eth.received(2).getBlock(Arg.all())
      expect(blockTracker.getLastFetchedBlock()).to.eql([11, '0x123'])
      expect(newEventSpy).to.have.callCount(0)
      expect(reorgSpy).to.have.callCount(1)
      expect(reorgOutOfRangeSpy).to.have.callCount(1)
      expect(await Event.count()).to.eql(1)
    })
  })
})