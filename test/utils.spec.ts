import chai from 'chai'
import sinonChai from 'sinon-chai'
import chaiAsPromised from 'chai-as-promised'
import dirtyChai from 'dirty-chai'
import sinon from 'sinon'
import util from 'util'

import { AutoStartStopEventEmitter, loggingFactory, passTroughEvents } from '../src/utils'
import Emittery from 'emittery'

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
      emitterFrom.emit('one')
      await setImmediatePromise()

      expect(spyOne).to.be.calledOnce()
      expect(spyTwo).not.to.be.called()
      emitterFrom.emit('two')
      await setImmediatePromise()

      expect(spyTwo).not.to.be.called()
    })
  })
})
