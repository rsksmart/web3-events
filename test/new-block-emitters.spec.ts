import sinon from 'sinon'
import util from 'util'
import chai from 'chai'
import sinonChai from 'sinon-chai'
import chaiAsPromised from 'chai-as-promised'
import dirtyChai from 'dirty-chai'
import { Arg, Substitute } from '@fluffy-spoon/substitute'
import { BlockHeader, Eth } from 'web3-eth'

import { blockMock, sleep, subscribeMock } from './utils'
import {
  ListeningNewBlockEmitter,
  PollingNewBlockEmitter,
  NEW_BLOCK_EVENT_NAME
} from '../src'

chai.use(sinonChai)
chai.use(chaiAsPromised)
chai.use(dirtyChai)
const expect = chai.expect
const setImmediatePromise = util.promisify(setImmediate)

describe('PollingNewBlockEmitter', () => {
  it('should immediately emit event', async function () {
    const spy = sinon.spy()
    const block = blockMock(111)
    const eth = Substitute.for<Eth>()
    eth.getBlock(Arg.all()).returns(Promise.resolve(block))

    const emitter = new PollingNewBlockEmitter(eth, 100)
    emitter.on(NEW_BLOCK_EVENT_NAME, spy)

    // We have to wait for all previous schedules events in event-loop to finish
    await setImmediatePromise()
    eth.received(1).getBlock(Arg.all())
    expect(spy.calledOnceWith(block)).to.be.true('Emitter callback should have been called with 10.')

    emitter.off(NEW_BLOCK_EVENT_NAME, spy) // Cleanup
  })

  it('should emit only new events', async function () {
    const spy = sinon.spy()
    const eth = Substitute.for<Eth>()
    const firstBlock = blockMock(10)
    const secondBlock = blockMock(11)
    eth.getBlock(Arg.all()).returns(
      Promise.resolve(firstBlock),
      Promise.resolve(blockMock(10)),
      Promise.resolve(secondBlock)
    )

    const emitter = new PollingNewBlockEmitter(eth, 100)
    emitter.on(NEW_BLOCK_EVENT_NAME, spy)

    // Lets wait for 3 events polls
    await sleep(210)
    eth.received(3).getBlock(Arg.all())
    expect(spy).to.be.calledTwice('Emitter callback should have been called twice.')
    expect(spy.firstCall.calledWithExactly(firstBlock)).to.be.true('Emitter callback should have been called first with 10.')
    expect(spy.secondCall.calledWithExactly(secondBlock)).to.be.true('Emitter callback should have been called second time with 11.')

    emitter.off(NEW_BLOCK_EVENT_NAME, spy) // Cleanup
  })

  it('should stop on removeListener', async function () {
    const spy = sinon.spy()
    const block = blockMock(10)
    const eth = Substitute.for<Eth>()
    eth.getBlock(Arg.all()).returns(
      Promise.resolve(block),
      Promise.resolve(blockMock(10))
    )

    const emitter = new PollingNewBlockEmitter(eth, 100)
    emitter.on(NEW_BLOCK_EVENT_NAME, spy)

    // Lets wait for 2 events polls
    await sleep(110)
    emitter.off(NEW_BLOCK_EVENT_NAME, spy)

    // Lets make sure it is off
    await sleep(110)

    eth.received(2).getBlock(Arg.all())
    expect(spy.calledOnce).to.be.true('Emitter callback should have been called once.')
    expect(spy.firstCall.calledWithExactly(block)).to.be.true('Emitter callback should have been called first with 10.')
  })
})

describe('ListeningNewBlockEmitter', () => {
  const NEW_BLOCK_EVENT_NAME = 'newBlock'

  it('should immediately emit event', async function () {
    const spy = sinon.spy()
    const block = blockMock(10)
    const eth = Substitute.for<Eth>()
    eth.getBlock(Arg.all()).returns(Promise.resolve(block))

    const emitter = new ListeningNewBlockEmitter(eth)
    emitter.on(NEW_BLOCK_EVENT_NAME, spy)

    // We have to wait for all previous schedules events in event-loop to finish
    await setImmediatePromise()
    eth.received(1).getBlock(Arg.all())
    expect(spy.calledOnceWith(block)).to.be.true('Emitter callback should have been called with 10.')
  })

  it('should listen for events from blockchain', async function () {
    const spy = sinon.spy()
    const block = blockMock(9)
    const block1 = Substitute.for<BlockHeader>()
    block1.number.returns!(10)
    const block2 = Substitute.for<BlockHeader>()
    block2.number.returns!(11)
    const subscribe = subscribeMock([block1, block2], 100)
    const eth = Substitute.for<Eth>()
    eth.getBlock(Arg.all()).returns(Promise.resolve(block))
    // @ts-ignore
    eth.subscribe(Arg.all()).mimicks(subscribe)

    const emitter = new ListeningNewBlockEmitter(eth)
    emitter.on(NEW_BLOCK_EVENT_NAME, spy)

    // Lets wait for 3 events fired
    await sleep(410)

    eth.received(1).getBlock(Arg.all())
    expect(spy).to.have.callCount(3)
    expect(spy.firstCall).to.be.calledWithExactly(block)
    expect(spy.secondCall).to.be.calledWithExactly(block1)
    expect(spy.thirdCall).to.be.calledWithExactly(block2)
  })
})
