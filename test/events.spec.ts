import { Eth } from 'web3-eth'
import { Arg, Substitute } from '@fluffy-spoon/substitute'
import sinon from 'sinon'
import chai from 'chai'
import dirtyChai from 'dirty-chai'
import chaiAsPromised from 'chai-as-promised'
import util from 'util'
import sinonChai from 'sinon-chai'
import { Sequelize } from 'sequelize-typescript'
import { EventData } from 'web3-eth-contract'
import { AbiItem } from 'web3-utils'
import Emittery from 'emittery'

import {
  BaseEventsEmitter,
  PollingEventsEmitter
} from '../src/events'
import { loggingFactory } from '../src/utils'
import Event from '../src/event.model'
import { sleep, blockMock, eventMock, sequelizeFactory, delayedPromise } from './utils'
import {
  Contract,
  Logger,
  NewBlockEmitter,
  NEW_BLOCK_EVENT_NAME,
  REORG_EVENT_NAME,
  REORG_OUT_OF_RANGE_EVENT_NAME,
  EventsEmitterOptions,
  BlockTracker,
  ModelConfirmator, NEW_EVENT_EVENT_NAME, INIT_FINISHED_EVENT_NAME
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
      logger = loggingFactory('blockchain:events:dummy')
    } else {
      logger = loggingFactory('blockchain:events:' + name)
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
  })

  beforeEach(async () => {
    await sequelize.sync({ force: true })
  })

  it('should wait for previous processing finished', async function () {
    const events = [
      eventMock({ blockNumber: 4, transactionHash: '1', logIndex: 1 }),
      eventMock({ blockNumber: 8, transactionHash: '2', logIndex: 1 }),
      eventMock({ blockNumber: 9, transactionHash: '3', logIndex: 1 }),
      eventMock({ blockNumber: 10, transactionHash: '4', logIndex: 1 })
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
    const events = [eventMock({ blockHash: '0x123', blockNumber: 4, transactionHash: '1', logIndex: 1 })]

    const eth = Substitute.for<Eth>()
    eth.getBlock('latest').resolves(blockMock(10))

    const contract = Substitute.for<Contract>()
    contract.getPastEvents(Arg.all()).returns(Promise.resolve(events))

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
      eventMock({ blockHash: '0x123', blockNumber: 4, transactionHash: '1', logIndex: 1 }),
      eventMock({ blockHash: '0x124', blockNumber: 8, transactionHash: '2', logIndex: 1 }),
      eventMock({ blockHash: '0x125', blockNumber: 9, transactionHash: '3', logIndex: 1 }),
      eventMock({ blockHash: '0x126', blockNumber: 10, transactionHash: '4', logIndex: 1 })
    ]

    const eth = Substitute.for<Eth>()
    eth.getBlockNumber().resolves(11)
    eth.getBlock('latest').resolves(blockMock(11))

    const contract = Substitute.for<Contract>()
    contract.getPastEvents(Arg.all()).returns(Promise.resolve(events))

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

  describe('with confirmations', () => {
    it('should process past events', async function () {
      const events = [
        eventMock({ blockHash: '0x123', blockNumber: 4, transactionHash: '1', logIndex: 1 }),
        eventMock({ blockHash: '0x125', blockNumber: 8, transactionHash: '2', logIndex: 1 }),
        eventMock({ blockHash: '0x123', blockNumber: 9, transactionHash: '3', logIndex: 1 }),
        eventMock({ blockHash: '0x123', blockNumber: 10, transactionHash: '4', logIndex: 1 })
      ]

      const eth = Substitute.for<Eth>()
      eth.getBlock('latest').resolves(blockMock(10))

      const contract = Substitute.for<Contract>()
      contract.getPastEvents(Arg.all()).returns(Promise.resolve(events))

      const blockTracker = new BlockTracker({})
      const newBlockEmitter = new Emittery()
      const options: EventsEmitterOptions = { confirmations: 2, events: ['testEvent'] }
      const spy = sinon.spy()
      const eventsEmitter = new DummyEventsEmitter(eth, contract, blockTracker, newBlockEmitter as NewBlockEmitter, options)
      eventsEmitter.on(NEW_EVENT_EVENT_NAME, spy)
      await sleep(100)

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
        eventMock({ blockNumber: 4, transactionHash: '1', logIndex: 1 }),
        eventMock({ blockNumber: 8, transactionHash: '2', logIndex: 1 }),
        eventMock({ blockNumber: 9, transactionHash: '3', logIndex: 1 }),
        eventMock({ blockNumber: 10, transactionHash: '4', logIndex: 1 })
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

      const contract = Substitute.for<Contract>()
      contract.getPastEvents(Arg.all()).returns(Promise.resolve(events))

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
  })

  beforeEach(async () => {
    await sequelize.sync({ force: true })
  })

  it('should emit new events', async function () {
    const eth = Substitute.for<Eth>()
    const contract = Substitute.for<Contract>()
    contract.getPastEvents(Arg.all()).returns(
      Promise.resolve([eventMock({ blockNumber: 11, event: 'testEvent', returnValues: { hey: 123 } })]), // Value for polling new events
      Promise.resolve([eventMock({ blockNumber: 12, event: 'testEvent', returnValues: { hey: 321 } })]) // Value for polling new events
    )

    const blockTracker = new BlockTracker({})
    blockTracker.setLastFetchedBlock(10, '0x123')

    const newBlockEmitter = new Emittery()
    const options = { events: ['testEvent'] }
    const newEventSpy = sinon.spy()
    const reorgSpy = sinon.spy()
    const reorgOutOfRangeSpy = sinon.spy()
    const eventsEmitter = new PollingEventsEmitter(eth, contract, blockTracker, newBlockEmitter as NewBlockEmitter, loggingFactory('test'), undefined, options)
    eventsEmitter.on(NEW_EVENT_EVENT_NAME, newEventSpy)
    eventsEmitter.on(REORG_EVENT_NAME, reorgSpy)
    eventsEmitter.on(REORG_OUT_OF_RANGE_EVENT_NAME, reorgOutOfRangeSpy)
    await setImmediatePromise()

    newBlockEmitter.emit(NEW_BLOCK_EVENT_NAME, blockMock(11))
    await sleep(100)

    newBlockEmitter.emit(NEW_BLOCK_EVENT_NAME, blockMock(12))
    await sleep(100)

    contract.received(2).getPastEvents(Arg.all())
    expect(blockTracker.getLastFetchedBlock()).to.eql([12, '0x123'])
    expect(newEventSpy).to.have.callCount(2)
    expect(reorgSpy).to.have.callCount(0)
    expect(reorgOutOfRangeSpy).to.have.callCount(0)
  })

  it('should not emit empty events', async function () {
    const eth = Substitute.for<Eth>()
    eth.getBlock(10).resolves(blockMock(10))
    eth.getBlock(11).resolves(blockMock(11))

    const contract = Substitute.for<Contract>()
    contract.getPastEvents(Arg.all()).returns(
      Promise.resolve([eventMock({ blockNumber: 11, event: 'testEvent', returnValues: { hey: 123 } })]), // Value for polling new events
      Promise.resolve([]) // Value for polling new events
    )

    const blockTracker = new BlockTracker({})
    blockTracker.setLastFetchedBlock(10, '0x123')

    const newBlockEmitter = new Emittery()
    const options = { events: ['testEvent'] }
    const newEventSpy = sinon.spy()
    const reorgSpy = sinon.spy()
    const reorgOutOfRangeSpy = sinon.spy()
    const eventsEmitter = new PollingEventsEmitter(eth, contract, blockTracker, newBlockEmitter as NewBlockEmitter, loggingFactory('test'), undefined, options)
    eventsEmitter.on(NEW_EVENT_EVENT_NAME, newEventSpy)
    eventsEmitter.on(REORG_EVENT_NAME, reorgSpy)
    eventsEmitter.on(REORG_OUT_OF_RANGE_EVENT_NAME, reorgOutOfRangeSpy)
    await setImmediatePromise()

    newBlockEmitter.emit(NEW_BLOCK_EVENT_NAME, blockMock(11))
    await sleep(100)

    newBlockEmitter.emit(NEW_BLOCK_EVENT_NAME, blockMock(12))
    await sleep(100)

    contract.received(2).getPastEvents(Arg.all())
    expect(blockTracker.getLastFetchedBlock()).to.eql([12, '0x123'])
    expect(newEventSpy).to.have.callCount(1)
    expect(reorgSpy).to.have.callCount(0)
    expect(reorgOutOfRangeSpy).to.have.callCount(0)
  })

  it('should ignore same blocks', async function () {
    const eth = Substitute.for<Eth>()
    const contract = Substitute.for<Contract>()
    contract.getPastEvents(Arg.all()).returns(
      Promise.resolve([eventMock({ blockNumber: 11 })]) // Value for polling new events
    )

    const blockTracker = new BlockTracker({})
    blockTracker.setLastFetchedBlock(10, '0x123')

    const newBlockEmitter = new Emittery()
    const options = { events: ['testEvent'] }
    const newEventSpy = sinon.spy()
    const reorgSpy = sinon.spy()
    const reorgOutOfRangeSpy = sinon.spy()
    const eventsEmitter = new PollingEventsEmitter(eth, contract, blockTracker, newBlockEmitter as NewBlockEmitter, loggingFactory('test'), undefined, options)
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
    const events = [
      eventMock({ blockNumber: 4, transactionHash: '1', logIndex: 1 }),
      eventMock({ blockNumber: 8, transactionHash: '2', logIndex: 1 }),
      eventMock({ blockNumber: 9, transactionHash: '3', logIndex: 1 }),
      eventMock({ blockNumber: 10, transactionHash: '4', logIndex: 1 })
    ]

    const eth = Substitute.for<Eth>()
    eth.getBlock('latest').resolves(blockMock(10))

    const contract = Substitute.for<Contract>()
    contract.getPastEvents(Arg.all()).returns(sleep(200, events), Promise.resolve(events))

    const blockTracker = new BlockTracker({})
    const newBlockEmitter = new Emittery()
    const options = { events: ['testEvent'] }
    const spy = sinon.spy()
    const eventsEmitter = new PollingEventsEmitter(eth, contract, blockTracker, newBlockEmitter as NewBlockEmitter, loggingFactory('test'), undefined, options)
    const intiFinishedPromise = eventsEmitter.once(INIT_FINISHED_EVENT_NAME)
    eventsEmitter.on(NEW_EVENT_EVENT_NAME, spy) // Will start processingPastEvents() which will be delayed
    await setImmediatePromise() // Have to give enough time for the subscription to newBlockEmitter was picked up

    // Directly calling processEvents(), which should be blocked by the processingPastEvents()
    newBlockEmitter.emit(NEW_BLOCK_EVENT_NAME, blockMock(11))

    await sleep(50)
    contract.received(1).getPastEvents(Arg.all())
    eth.received(1).getBlock('latest')

    await intiFinishedPromise
    await sleep(200)

    // After the processingEvents() is finished
    contract.received(2).getPastEvents(Arg.all())
    eth.received(1).getBlock('latest')
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
        [eventMock({ blockNumber: 11, transactionHash: '1', logIndex: 1 })]
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
      const eventsEmitter = new PollingEventsEmitter(eth, contract, blockTracker, newBlockEmitter as NewBlockEmitter, loggingFactory('test'), undefined, options)
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
        [eventMock({ blockNumber: 11, transactionHash: '1', logIndex: 1 })]
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
      const eventsEmitter = new PollingEventsEmitter(eth, contract, blockTracker, newBlockEmitter as NewBlockEmitter, loggingFactory('test'), undefined, options)
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
        [eventMock({ blockNumber: 11, transactionHash: '1', logIndex: 1 })]
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
      const eventsEmitter = new PollingEventsEmitter(eth, contract, blockTracker, newBlockEmitter as NewBlockEmitter, loggingFactory('test'), undefined, options)
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
