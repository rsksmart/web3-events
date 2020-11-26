import { BlockHeader, Eth } from 'web3-eth'
import { Substitute, SubstituteOf } from '@fluffy-spoon/substitute'
import sinon from 'sinon'
import chai from 'chai'
import dirtyChai from 'dirty-chai'
import chaiAsPromised from 'chai-as-promised'
import { Sequelize } from 'sequelize'
import sinonChai from 'sinon-chai'
import Emittery from 'emittery'
import { promisify } from 'util'

import { Event } from '../src/event.model'
import { ModelConfirmator } from '../src/confirmator'
import { eventMock, receiptMock, sequelizeFactory, sleep } from './utils'
import { loggingFactory } from '../src/utils'
import { BlockTracker, ManualEventsEmitter, Web3Events } from '../src'

chai.use(sinonChai)
chai.use(chaiAsPromised)
chai.use(dirtyChai)
const expect = chai.expect
const setImmediatePromise = promisify(setImmediate)

describe('ModelConfirmator', function () {
  let confirmator: ModelConfirmator<any>
  let sequelize: Sequelize
  let eth: SubstituteOf<Eth>
  let confirmedEventSpy: sinon.SinonSpy
  let invalidEventSpy: sinon.SinonSpy
  let blockTracker: BlockTracker
  let emitter: Emittery

  before(async (): Promise<void> => {
    sequelize = sequelizeFactory()
    await Web3Events.init(sequelize)
  })

  beforeEach(async () => {
    await sequelize.sync({ force: true })

    blockTracker = new BlockTracker({})
    emitter = new Emittery()

    confirmedEventSpy = sinon.spy()
    invalidEventSpy = sinon.spy()
    eth = Substitute.for<Eth>()
    confirmator = new ModelConfirmator(emitter as unknown as ManualEventsEmitter<any>, eth, '0x123', blockTracker, { baseLogger: loggingFactory('blockchain:confirmator'), waitingBlockCount: 10 })

    emitter.on('newConfirmation', confirmedEventSpy)
    emitter.on('invalidConfirmation', invalidEventSpy)
  })

  it('should emit newConfirmation event when new block is available', async () => {
    const events = [
      { // Nothing emitted
        contractAddress: '0x123',
        event: 'testEvent',
        blockNumber: 7,
        transactionHash: '1',
        targetConfirmation: 3,
        emitted: true,
        content: '{"event": "testEvent", "blockNumber": 7, "blockHash": "0x123"}'
      },
      { // Emitted newConfirmation
        contractAddress: '0x123',
        event: 'testEvent',
        blockNumber: 8,
        transactionHash: '2',
        targetConfirmation: 4,
        emitted: false,
        content: '{"event": "testEvent", "blockNumber": 8, "blockHash": "0x123"}'
      },
      { // Emitted newEvent
        contractAddress: '0x123',
        event: 'niceEvent',
        blockNumber: 9,
        transactionHash: '3',
        targetConfirmation: 2,
        emitted: false,
        content: '{"event": "niceEvent", "blockNumber": 9, "blockHash": "0x123"}'
      },
      { // Emitted newEvent
        contractAddress: '0x123',
        event: 'otherEvent',
        blockNumber: 9,
        transactionHash: '3',
        targetConfirmation: 2,
        emitted: false,
        content: '{"event": "otherEvent", "blockNumber": 9, "blockHash": "0x123"}'
      },
      { // Nothing emitted
        contractAddress: '0x123',
        event: 'completelyDifferentEvent',
        blockNumber: 9,
        transactionHash: '4',
        targetConfirmation: 2,
        emitted: true, // This event won't be emitted as it was already emitted previously
        content: '{"event": "completelyDifferentEvent", "blockNumber": 9, "blockHash": "0x123"}'
      }
    ]
    await Event.bulkCreate(events)
    eth.getTransactionReceipt('2').resolves(receiptMock(8))
    eth.getTransactionReceipt('3').resolves(receiptMock(9))
    eth.getTransactionReceipt('4').resolves(receiptMock(9))

    const block = Substitute.for<BlockHeader>()
    block.number.returns!(11)
    const confirmedEvents = await confirmator.runConfirmationsRoutine(block)
    await sleep(10)

    expect(confirmedEvents).to.eql([
      {
        event: 'niceEvent',
        blockNumber: 9,
        blockHash: '0x123'
      },
      {
        event: 'otherEvent',
        blockNumber: 9,
        blockHash: '0x123'
      }
    ])

    expect(invalidEventSpy).to.not.have.been.called()
    expect(confirmedEventSpy).to.have.callCount(3)
    expect(confirmedEventSpy).to.have.been.calledWithExactly({
      confirmations: 3,
      event: 'testEvent',
      targetConfirmation: 4,
      transactionHash: '2'
    })
    expect(confirmedEventSpy).to.have.been.calledWithExactly({
      confirmations: 2,
      event: 'otherEvent',
      targetConfirmation: 2,
      transactionHash: '3'
    })
    expect(confirmedEventSpy).to.have.been.calledWithExactly({
      confirmations: 2,
      event: 'niceEvent',
      targetConfirmation: 2,
      transactionHash: '3'
    })

    expect(await Event.count()).to.eql(5)
  })

  it('should emit newEvent event when the targeted confirmation block is skipped', async () => {
    const events = [
      { // Emitted newEvent
        contractAddress: '0x123',
        event: 'niceEvent',
        blockNumber: 9,
        transactionHash: '3',
        targetConfirmation: 2,
        emitted: false,
        content: '{"event": "niceEvent", "blockNumber": 9, "blockHash": "0x123"}'
      },
      { // Emitted newEvent
        contractAddress: '0x123',
        event: 'otherEvent',
        blockNumber: 8,
        transactionHash: '2',
        targetConfirmation: 2,
        emitted: false,
        content: '{"event": "otherEvent", "blockNumber": 8, "blockHash": "0x123"}'
      }
    ]
    await Event.bulkCreate(events)
    eth.getTransactionReceipt('2').resolves(receiptMock(8))
    eth.getTransactionReceipt('3').resolves(receiptMock(9))

    const block = Substitute.for<BlockHeader>()
    block.number.returns!(13)
    const confirmedEvents = await confirmator.runConfirmationsRoutine(block)
    await sleep(10)

    expect(invalidEventSpy).to.not.have.been.called()
    expect(confirmedEventSpy).to.have.callCount(2)
    expect(confirmedEventSpy).to.have.been.calledWithExactly({
      confirmations: 5,
      event: 'otherEvent',
      targetConfirmation: 2,
      transactionHash: '2'
    })
    expect(confirmedEventSpy).to.have.been.calledWithExactly({
      confirmations: 4,
      event: 'niceEvent',
      targetConfirmation: 2,
      transactionHash: '3'
    })

    expect(confirmedEvents).to.eql([
      {
        event: 'niceEvent',
        blockNumber: 9,
        blockHash: '0x123'
      },
      {
        event: 'otherEvent',
        blockNumber: 8,
        blockHash: '0x123'
      }
    ])

    expect(await Event.count()).to.eql(2)
  })

  it('should confirm only events for given address', async () => {
    const events = [
      { // Nothing emitted; different address
        contractAddress: '0x0',
        event: 'testEvent',
        blockNumber: 8,
        transactionHash: '2',
        targetConfirmation: 4,
        emitted: false,
        content: '{"event": "testEvent", "blockNumber": 8, "blockHash": "0x123"}'
      },
      { // Emitted newConfirmation
        contractAddress: '0x123',
        event: 'testEvent',
        blockNumber: 8,
        transactionHash: '2',
        targetConfirmation: 4,
        emitted: false,
        content: '{"event": "testEvent", "blockNumber": 8, "blockHash": "0x123"}'
      },
      { // Emitted newEvent
        contractAddress: '0x123',
        event: 'niceEvent',
        blockNumber: 9,
        transactionHash: '3',
        targetConfirmation: 2,
        emitted: false,
        content: '{"event": "niceEvent", "blockNumber": 9, "blockHash": "0x123"}'
      },
      { // Not emitted newEvent; different address
        contractAddress: '0x0',
        event: 'otherEvent',
        blockNumber: 9,
        transactionHash: '3',
        targetConfirmation: 2,
        emitted: false,
        content: '{"event": "otherEvent", "blockNumber": 9, "blockHash": "0x123"}'
      },
      { // Nothing emitted
        contractAddress: '0x123',
        event: 'completelyDifferentEvent',
        blockNumber: 9,
        transactionHash: '4',
        targetConfirmation: 2,
        emitted: true, // This event won't be emitted as it was already emitted previously
        content: '{"event": "completelyDifferentEvent", "blockNumber": 9, "blockHash": "0x123"}'
      }
    ]
    await Event.bulkCreate(events)
    eth.getTransactionReceipt('2').resolves(receiptMock(8))
    eth.getTransactionReceipt('3').resolves(receiptMock(9))
    eth.getTransactionReceipt('4').resolves(receiptMock(9))

    const block = Substitute.for<BlockHeader>()
    block.number.returns!(11)
    const confirmedEvents = await confirmator.runConfirmationsRoutine(block)
    await sleep(10)

    expect(invalidEventSpy).to.not.have.been.called()
    expect(confirmedEventSpy).to.have.callCount(2)
    expect(confirmedEventSpy).to.have.been.calledWithExactly({
      confirmations: 2,
      event: 'niceEvent',
      targetConfirmation: 2,
      transactionHash: '3'
    })
    expect(confirmedEventSpy).to.have.been.calledWithExactly({
      confirmations: 3,
      event: 'testEvent',
      targetConfirmation: 4,
      transactionHash: '2'
    })

    expect(confirmedEvents).to.eql([
      {
        event: 'niceEvent',
        blockNumber: 9,
        blockHash: '0x123'
      }
    ])

    expect(await Event.count()).to.eql(5)
  })

  it('should remove already confirmed events that exceed configured block count', async () => {
    // waitingBlockCount = 10

    const events = [
      { // Deleted; confirmations = 21
        contractAddress: '0x123',
        event: 'testEvent',
        blockNumber: 7,
        transactionHash: '1',
        targetConfirmation: 3,
        emitted: true,
        content: '{}'
      },
      { // Deleted; confirmations = 13
        contractAddress: '0x123',
        event: 'niceEvent',
        blockNumber: 15,
        transactionHash: '3',
        targetConfirmation: 3,
        emitted: true,
        content: '{}'
      },
      { // Not deleted; confirmations = 12
        contractAddress: '0x123',
        event: 'otherEvent',
        blockNumber: 16,
        transactionHash: '3',
        targetConfirmation: 3,
        emitted: true,
        content: '{}'
      },
      { // Not deleted; confirmations = 13
        contractAddress: '0x123',
        event: 'completelyDifferentEvent',
        blockNumber: 15,
        transactionHash: '4',
        targetConfirmation: 4,
        emitted: true,
        content: '{}'
      }
    ]
    await Event.bulkCreate(events)
    eth.getTransactionReceipt('2').resolves(receiptMock(8))

    const block = Substitute.for<BlockHeader>()
    block.number.returns!(28)
    await confirmator.runConfirmationsRoutine(block)
    await sleep(10)

    expect(invalidEventSpy).to.not.have.been.called()
    expect(confirmedEventSpy).to.not.have.been.called()

    expect(await Event.count()).to.eql(2)
    expect(await Event.findOne({ where: { event: 'testEvent', blockNumber: 7, transactionHash: '1' } })).to.be.null()
    expect(await Event.findOne({
      where: {
        event: 'niceEvent',
        blockNumber: 15,
        transactionHash: '3'
      }
    })).to.be.null()
    expect(await Event.findOne({
      where: {
        event: 'otherEvent',
        blockNumber: 16,
        transactionHash: '3'
      }
    })).to.be.not.null()
    expect(await Event.findOne({
      where: {
        event: 'completelyDifferentEvent',
        blockNumber: 15,
        transactionHash: '4'
      }
    })).to.not.be.null()
  })

  it('should remove events without valid receipt and emit invalid event', async () => {
    const events = [
      { // Already emitted, awaits deletion
        contractAddress: '0x123',
        event: 'testEvent',
        blockNumber: 7,
        transactionHash: '1',
        targetConfirmation: 3,
        emitted: true,
        content: '{}'
      },
      { // Already emitted, awaits deletion
        contractAddress: '0x123',
        event: 'testEvent',
        blockNumber: 7,
        transactionHash: '2',
        targetConfirmation: 3,
        emitted: true,
        content: '{}'
      },
      { // To be emitted, but not valid receipt (invalid status)
        contractAddress: '0x123',
        event: 'niceEvent',
        blockNumber: 9,
        transactionHash: '3',
        targetConfirmation: 2,
        emitted: false,
        content: '{}'
      },
      { // To be emitted, but not valid receipt (invalid block number)
        contractAddress: '0x123',
        event: 'otherEvent',
        blockNumber: 9,
        transactionHash: '4',
        targetConfirmation: 2,
        emitted: false,
        content: '{}'
      },
      { // To be emitted, and valid receipt
        contractAddress: '0x123',
        event: 'completelyDifferentEvent',
        blockNumber: 9,
        transactionHash: '5',
        targetConfirmation: 2,
        emitted: false,
        content: '{"event": "completelyDifferentEvent", "blockNumber": 9, "blockHash": "0x123"}'
      }
    ]
    await Event.bulkCreate(events)

    eth.getTransactionReceipt('3').resolves(receiptMock(10))
    eth.getTransactionReceipt('4').resolves(receiptMock(9, false))
    eth.getTransactionReceipt('5').resolves(receiptMock(9))

    const block = Substitute.for<BlockHeader>()
    block.number.returns!(11)
    const confirmedEvents = await confirmator.runConfirmationsRoutine(block)
    await sleep(10)

    expect(confirmedEventSpy).to.have.callCount(1)
    expect(confirmedEventSpy).to.have.been.calledWithExactly({
      event: 'completelyDifferentEvent',
      transactionHash: '5',
      targetConfirmation: 2,
      confirmations: 2
    })

    expect(await Event.count()).to.eql(3)

    expect(confirmedEvents).to.eql([
      {
        event: 'completelyDifferentEvent',
        blockNumber: 9,
        blockHash: '0x123'
      }
    ])

    expect(invalidEventSpy).to.have.callCount(2)
    expect(invalidEventSpy).to.have.been.calledWithExactly({
      transactionHash: '3'
    })
    expect(invalidEventSpy).to.have.been.calledWithExactly({
      transactionHash: '4'
    })
  })

  it('should detect dropped out hashes', async () => {
    const events = [
      {
        contractAddress: '0x666', // Different contract
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
        contractAddress: '0x123',
        event: 'niceEvent',
        blockNumber: 9,
        transactionHash: '3',
        targetConfirmation: 2,
        emitted: false,
        content: '{"event": "niceEvent", "blockNumber": 9, "blockHash": "0x123"}'
      },
      {
        contractAddress: '0x123',
        event: 'otherEvent',
        blockNumber: 9,
        transactionHash: '4',
        targetConfirmation: 2,
        emitted: false,
        content: '{"event": "otherEvent", "blockNumber": 9, "blockHash": "0x123"}'
      },
      {
        contractAddress: '0x123',
        event: 'completelyDifferentEvent',
        blockNumber: 9,
        transactionHash: '5',
        targetConfirmation: 2,
        emitted: true, // This event won't be emitted as it was already emitted previously
        content: '{"event": "completelyDifferentEvent", "blockNumber": 9, "blockHash": "0x123"}'
      }
    ]
    await Event.bulkCreate(events)

    await confirmator.checkDroppedTransactions([
      eventMock({ transactionHash: '4' }),
      eventMock({ transactionHash: '5' })
    ])

    await setImmediatePromise()

    expect(invalidEventSpy).to.have.callCount(2)
    expect(invalidEventSpy).to.have.been.calledWithExactly({ transactionHash: '2' })
    expect(invalidEventSpy).to.have.been.calledWithExactly({ transactionHash: '3' })
  })
})
