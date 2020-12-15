import chai from 'chai'
import sinonChai from 'sinon-chai'
import chaiAsPromised from 'chai-as-promised'
import dirtyChai from 'dirty-chai'
import sinon from 'sinon'
import util from 'util'
import Emittery from 'emittery'
import { Arg, Substitute } from '@fluffy-spoon/substitute'
import type Sinon from 'sinon'

import {
  AutoEventsEmitter,
  AutoStartStopEventEmitter,
  cumulateIterations,
  loggingFactory,
  passTroughEvents
} from '../src/utils'
import { blockMock, createGenerator, delayedPromise, eventMock, sleep } from './utils'
import {
  AutoEventsEmitterOptions,
  EventsFetcher,
  NewBlockEmitter,
  NEW_BLOCK_EVENT_NAME,
  NEW_EVENT_EVENT_NAME,
  PROGRESS_EVENT_NAME,
  REORG_EVENT_NAME,
  REORG_OUT_OF_RANGE_EVENT_NAME,
  NEW_CONFIRMATION_EVENT_NAME, INVALID_CONFIRMATION_EVENT_NAME
} from '../src'

chai.use(sinonChai)
chai.use(chaiAsPromised)
chai.use(dirtyChai)
const expect = chai.expect
const setImmediatePromise = util.promisify(setImmediate)

describe('utils', () => {
  describe('AutoStartStopEventEmitter', function () {
    const startSpy = sinon.spy()
    const stopSpy = sinon.spy()
    const listenerSpy = sinon.spy()
    const EVENT_NAME = 'hello'

    class DummyImplementation extends AutoStartStopEventEmitter<any> {
      constructor (eventName: string, autoStart = true) {
        super(loggingFactory('web3events:dummy'), eventName, autoStart)
      }

      start (): void {
        startSpy()
      }

      stop (): void {
        stopSpy()
      }
    }

    beforeEach(() => {
      sinon.resetHistory()
    })

    it('should start when listener attached', async () => {
      const emitter = new DummyImplementation(EVENT_NAME)
      emitter.on(EVENT_NAME, listenerSpy)
      await setImmediatePromise()

      expect(startSpy).to.be.calledOnce()
      expect(stopSpy).to.not.be.called()
    })

    it('should not start when autostart is off', async () => {
      const emitter = new DummyImplementation(EVENT_NAME, false)
      emitter.on(EVENT_NAME, listenerSpy)
      await setImmediatePromise()

      expect(startSpy).to.not.be.called()
    })

    it('should start only once', async () => {
      const emitter = new DummyImplementation(EVENT_NAME)
      emitter.on(EVENT_NAME, listenerSpy)
      emitter.on(EVENT_NAME, sinon.spy())
      emitter.on(EVENT_NAME, sinon.spy())
      await setImmediatePromise()

      expect(startSpy).to.be.calledOnce()
      expect(stopSpy).to.not.be.called()
    })

    it('should stop when listener removed', async () => {
      const emitter = new DummyImplementation(EVENT_NAME)
      emitter.on(EVENT_NAME, listenerSpy)
      await setImmediatePromise()
      expect(startSpy).to.be.calledOnce()

      emitter.off(EVENT_NAME, listenerSpy)
      await setImmediatePromise()
      expect(stopSpy).to.be.calledOnce()
    })

    it('should again start when listener removed and added', async () => {
      const emitter = new DummyImplementation(EVENT_NAME)
      emitter.on(EVENT_NAME, listenerSpy)
      await setImmediatePromise()
      expect(startSpy).to.be.calledOnce()

      emitter.off(EVENT_NAME, listenerSpy)
      await setImmediatePromise()
      expect(stopSpy).to.be.calledOnce()

      emitter.on(EVENT_NAME, listenerSpy)
      await setImmediatePromise()
      expect(startSpy).to.be.calledTwice()
    })
  })

  describe('passThroughEvents', function () {
    it('should pass events when emitted', async () => {
      const emitterFrom = new Emittery()
      const emitterTo = new Emittery()
      const spyOne = sinon.spy()
      const spyTwo = sinon.spy()

      passTroughEvents(emitterFrom, emitterTo, ['one'])

      emitterTo.on('one', spyOne)
      emitterTo.on('two', spyOne)

      expect(spyOne).not.to.be.called()
      expect(spyTwo).not.to.be.called()
      emitterFrom.emit('one', 'data')
      await setImmediatePromise()

      expect(spyOne).to.be.calledOnceWith('data')
      expect(spyTwo).not.to.be.called()
      emitterFrom.emit('two')
      await setImmediatePromise()

      expect(spyTwo).not.to.be.called()
    })

    it('should wrap data when namespaced', async () => {
      const emitterFrom = new Emittery()
      const emitterTo = new Emittery()
      const spyOne = sinon.spy()
      const spyTwo = sinon.spy()

      passTroughEvents(emitterFrom, emitterTo, ['one'], 'hello')

      emitterTo.on('one', spyOne)
      emitterTo.on('two', spyOne)

      expect(spyOne).not.to.be.called()
      expect(spyTwo).not.to.be.called()
      emitterFrom.emit('one', 'data')
      await setImmediatePromise()

      expect(spyOne).to.be.calledOnceWith({ name: 'hello', data: 'data' })
      expect(spyTwo).not.to.be.called()
      emitterFrom.emit('two')
      await setImmediatePromise()

      expect(spyTwo).not.to.be.called()
    })
  })

  describe('AutoEventsEmitter', function () {
    it('should emit new events', async function () {
      const fetcher = Substitute.for<EventsFetcher<any>>()
      fetcher.fetch(Arg.all()).returns(
        createGenerator([
          {
            stepsComplete: 1,
            totalSteps: 1,
            stepFromBlock: 0,
            stepToBlock: 10,
            events: [eventMock({ blockNumber: 5, event: 'testEvent', returnValues: { hey: 123 } })]
          }
        ]),
        createGenerator([
          {
            stepsComplete: 1,
            totalSteps: 1,
            stepFromBlock: 11,
            stepToBlock: 11,
            events: [eventMock({ blockNumber: 11, event: 'testEvent', returnValues: { hey: 123 } })]
          }
        ])
      )

      const newBlockEmitter = new Emittery()
      const newEventSpy = sinon.spy()
      const progressSpy = sinon.spy()
      const eventsEmitter = new AutoEventsEmitter(fetcher, newBlockEmitter as NewBlockEmitter, loggingFactory('web3events:test'))
      eventsEmitter.on(PROGRESS_EVENT_NAME, progressSpy)
      eventsEmitter.on(NEW_EVENT_EVENT_NAME, newEventSpy)
      await setImmediatePromise()

      let newEventEmittedPromise = eventsEmitter.once(NEW_EVENT_EVENT_NAME)
      newBlockEmitter.emit(NEW_BLOCK_EVENT_NAME, blockMock(10))
      await newEventEmittedPromise

      newEventEmittedPromise = eventsEmitter.once(NEW_EVENT_EVENT_NAME)
      newBlockEmitter.emit(NEW_BLOCK_EVENT_NAME, blockMock(11))
      await newEventEmittedPromise
      await setImmediatePromise() // the setLastFetchedBlock() happens after the events are processed, so this will delay enough for the process to happen

      fetcher.received(2).fetch(Arg.all())
      expect(newEventSpy).to.have.callCount(2)
    })

    it('should not emit empty batches', async function () {
      const fetcher = Substitute.for<EventsFetcher<any>>()
      fetcher.fetch(Arg.all()).returns(
        createGenerator([
          {
            stepsComplete: 1,
            totalSteps: 1,
            stepFromBlock: 0,
            stepToBlock: 10,
            events: []
          }
        ])
      )

      const newBlockEmitter = new Emittery()
      const newEventSpy = sinon.spy()
      const progressSpy = sinon.spy()
      const eventsEmitter = new AutoEventsEmitter(fetcher, newBlockEmitter as NewBlockEmitter, loggingFactory('web3events:test'))
      eventsEmitter.on(PROGRESS_EVENT_NAME, progressSpy)
      eventsEmitter.on(NEW_EVENT_EVENT_NAME, newEventSpy)
      await setImmediatePromise()

      newBlockEmitter.emit(NEW_BLOCK_EVENT_NAME, blockMock(10))
      await sleep(100)

      fetcher.received(1).fetch(Arg.all())
      expect(newEventSpy).to.have.callCount(0)
    })

    it('should process listeners in serial order when configured', async function () {
      const fetcher = Substitute.for<EventsFetcher<any>>()
      fetcher.fetch(Arg.all()).returns(
        createGenerator([
          {
            stepsComplete: 1,
            totalSteps: 1,
            stepFromBlock: 0,
            stepToBlock: 10,
            events: [eventMock({ blockNumber: 5, event: 'testEvent', returnValues: { hey: 123 } })]
          }
        ])
      )

      const newBlockEmitter = new Emittery()
      const options: AutoEventsEmitterOptions = { serialListeners: true }
      const eventsEmitter = new AutoEventsEmitter(fetcher, newBlockEmitter as NewBlockEmitter, loggingFactory('web3events:test'), options)

      const spy1 = sinon.spy()
      const [listener1Promise, listener1Callback] = delayedPromise()

      const spy2 = sinon.spy()
      const [listener2Promise, listener2Callback] = delayedPromise()

      const spy3 = sinon.spy()
      const [listener3Promise, listener3Callback] = delayedPromise()

      // Upon first emitter the EventsEmitter start fetching events
      // the processing will be blocked on it though with the `listener1Promise`
      eventsEmitter.on(NEW_EVENT_EVENT_NAME, async (e: unknown) => {
        await listener1Promise
        spy1(e)
      })
      eventsEmitter.on(NEW_EVENT_EVENT_NAME, async (e: unknown) => {
        await listener2Promise
        spy2(e)
      })
      eventsEmitter.on(NEW_EVENT_EVENT_NAME, async (e: unknown) => {
        await listener3Promise
        spy3(e)
      })

      // Lets wait for everything to setup
      await setImmediatePromise()
      newBlockEmitter.emit(NEW_BLOCK_EVENT_NAME, blockMock(10)) // Fire up the processing
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
      const fetcher = Substitute.for<EventsFetcher<any>>()
      fetcher.fetch(Arg.all()).returns(
        createGenerator([
          {
            stepsComplete: 1,
            totalSteps: 1,
            stepFromBlock: 0,
            stepToBlock: 5,
            events: [
              eventMock({ blockHash: '0x123', blockNumber: 4, transactionHash: '1' }),
              eventMock({ blockHash: '0x124', blockNumber: 5, transactionHash: '2' })
            ]
          },
          {
            stepsComplete: 1,
            totalSteps: 1,
            stepFromBlock: 6,
            stepToBlock: 10,
            events: [
              eventMock({ blockHash: '0x125', blockNumber: 9, transactionHash: '3' }),
              eventMock({ blockHash: '0x126', blockNumber: 10, transactionHash: '4' })
            ]
          }
        ])
      )

      const newBlockEmitter = new Emittery()
      const options: AutoEventsEmitterOptions = { serialProcessing: true }
      const eventsEmitter = new AutoEventsEmitter(fetcher, newBlockEmitter as NewBlockEmitter, loggingFactory('web3events:test'), options)

      const spy = sinon.spy()
      let releaseCb: Function
      // Listener that blocks processing until we call releaseCb
      eventsEmitter.on(NEW_EVENT_EVENT_NAME, async (e: unknown): Promise<void> => {
        const [delayedProm, delayedCb] = delayedPromise()
        releaseCb = delayedCb
        await delayedProm
        spy(e)
      })
      await setImmediatePromise() // Have to give enough time for the subscription to newBlockEmitter was picked up
      newBlockEmitter.emit(NEW_BLOCK_EVENT_NAME, blockMock(10)) // Fire up the processing
      await sleep(300)

      // Still blocked
      expect(spy).to.not.be.called()

      releaseCb!() // Release processing of one event
      await setImmediatePromise()
      expect(spy).to.be.calledOnce()

      releaseCb!() // Release processing of another event
      await setImmediatePromise()
      expect(spy).to.be.calledTwice()

      releaseCb!() // Release processing of another event
      await setImmediatePromise()
      expect(spy).to.be.calledThrice()

      releaseCb!() // Release processing of another event
      await setImmediatePromise()
      expect(spy).to.be.callCount(4)
    })

    it('should passthrough all expected events', async () => {
      const fetcher = new Emittery() as EventsFetcher<any>
      const newBlockEmitter = new Emittery()
      const options: AutoEventsEmitterOptions = { serialProcessing: true }
      const eventsEmitter = new AutoEventsEmitter(fetcher, newBlockEmitter as NewBlockEmitter, loggingFactory('web3events:test'), options)

      const supportedEvents = [
        PROGRESS_EVENT_NAME,
        REORG_OUT_OF_RANGE_EVENT_NAME,
        NEW_CONFIRMATION_EVENT_NAME,
        INVALID_CONFIRMATION_EVENT_NAME,
        'error',
        REORG_EVENT_NAME
      ]

      const spies: Record<string, Sinon.SinonSpy> = {}

      // Subscribe for events
      supportedEvents.forEach(eventName => {
        const spy = sinon.spy()
        spies[eventName] = spy
        // @ts-ignore
        eventsEmitter.on(eventName, spy)
      })

      // Emit events
      supportedEvents.forEach(eventName => fetcher.emit(eventName, 123))
      await setImmediatePromise()

      // Assert passthrough events
      supportedEvents.forEach(eventName => {
        expect(spies[eventName], eventName).to.be.calledOnceWithExactly(123)
      })

      // Assert that other events are not passthrough
      const randomSpy = sinon.spy()
      // @ts-ignore
      eventsEmitter.on('random', randomSpy)
      fetcher.emit('random', 321)
      await setImmediatePromise()
      expect(randomSpy).not.to.be.called()
    })

    it('should not autostart when configured', async () => {
      const fetcher = Substitute.for<EventsFetcher<any>>()
      fetcher.fetch(Arg.all()).returns(
        createGenerator([
          {
            stepsComplete: 1,
            totalSteps: 1,
            stepFromBlock: 0,
            stepToBlock: 10,
            events: [eventMock({ blockNumber: 5, event: 'testEvent', returnValues: { hey: 123 } })]
          }
        ])
      )

      const newBlockEmitter = new Emittery()
      const newEventSpy = sinon.spy()
      const progressSpy = sinon.spy()
      const eventsEmitter = new AutoEventsEmitter(fetcher, newBlockEmitter as NewBlockEmitter, loggingFactory('web3events:test'), { autoStart: false })
      eventsEmitter.on(PROGRESS_EVENT_NAME, progressSpy)
      eventsEmitter.on(NEW_EVENT_EVENT_NAME, newEventSpy)
      await setImmediatePromise()

      newBlockEmitter.emit(NEW_BLOCK_EVENT_NAME, blockMock(10))
      await sleep(100)
      expect(newEventSpy).to.have.callCount(0)

      // Start listening
      eventsEmitter.start()
      await setImmediatePromise()

      newBlockEmitter.emit(NEW_BLOCK_EVENT_NAME, blockMock(10))
      await sleep(100)
      expect(newEventSpy).to.have.callCount(1)
      fetcher.received(1).fetch(Arg.all())
    })
  })

  describe('cumulateIterations', function () {
    it('should fetch one iteration for each emitter by default', async () => {
      const generator1 = createGenerator([1, 2])
      const generator2 = createGenerator([3, 4])

      let [iterating, values] = await cumulateIterations([generator1, generator2])
      expect(iterating).to.be.true()
      expect(values).to.eql([1, 3]);

      ([iterating, values] = await cumulateIterations([generator1, generator2]))
      expect(iterating).to.be.true()
      expect(values).to.eql([2, 4]);

      ([iterating, values] = await cumulateIterations([generator1, generator2]))
      expect(iterating).to.be.false()
      expect(values).to.eql([])
    })

    it('should work with differently "sized" generators', async () => {
      const generator1 = createGenerator([1, 2])
      const generator2 = createGenerator([3, 4, 5, 6])

      let [iterating, values] = await cumulateIterations([generator1, generator2])
      expect(iterating).to.be.true()
      expect(values).to.eql([1, 3]);

      ([iterating, values] = await cumulateIterations([generator1, generator2]))
      expect(iterating).to.be.true()
      expect(values).to.eql([2, 4]);

      ([iterating, values] = await cumulateIterations([generator1, generator2]))
      expect(iterating).to.be.true()
      expect(values).to.eql([5]);

      ([iterating, values] = await cumulateIterations([generator1, generator2]))
      expect(iterating).to.be.true()
      expect(values).to.eql([6]);

      ([iterating, values] = await cumulateIterations([generator1, generator2]))
      expect(iterating).to.be.false()
      expect(values).to.eql([])
    })

    it('should fetch all iterations if asked', async () => {
      const generator1 = createGenerator([1, 2])
      const generator2 = createGenerator([3, 4])

      const [iterating, values] = await cumulateIterations([generator1, generator2], true)
      expect(iterating).to.be.false()
      expect(values).to.eql([1, 3, 2, 4])
    })
  })
})
