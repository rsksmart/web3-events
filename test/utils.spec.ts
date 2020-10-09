import chai from 'chai'
import sinonChai from 'sinon-chai'
import chaiAsPromised from 'chai-as-promised'
import dirtyChai from 'dirty-chai'
import sinon from 'sinon'
import util from 'util'

import { AutoStartStopEventEmitter, loggingFactory } from '../src/utils'

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
        super(loggingFactory('dummy'), eventName, autoStart)
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
})
