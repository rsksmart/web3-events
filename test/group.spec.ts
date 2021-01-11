import { Substitute } from '@fluffy-spoon/substitute'
import chai from 'chai'
import dirtyChai from 'dirty-chai'
import chaiAsPromised from 'chai-as-promised'
import sinonChai from 'sinon-chai'
import type { Sequelize } from 'sequelize'
import type { EventLog } from 'web3-core'
import type { Eth } from 'web3-eth'
import type Sinon from 'sinon'
import sinon from 'sinon'
import util from 'util'

import { loggingFactory } from '../src/utils'
import {
  batchFactoryConstructor, batchMock,
  blockMock,
  createGenerator,
  eventMock, eventsFetcherMock,
  sequelizeFactory,
  wholeGenerator
} from './utils'
import {
  Batch,
  BlockTracker,
  EventsFetcher,
  GroupEmitterOptions, INVALID_CONFIRMATION_EVENT_NAME,
  NEW_CONFIRMATION_EVENT_NAME,
  NEW_EVENT_EVENT_NAME,
  PROGRESS_EVENT_NAME, REORG_EVENT_NAME,
  REORG_OUT_OF_RANGE_EVENT_NAME,
  Web3Events
} from '../src'
import { fetchBatches, GroupEventsEmitter } from '../src/group'

chai.use(sinonChai)
chai.use(chaiAsPromised)
chai.use(dirtyChai)
const expect = chai.expect
const setImmediatePromise = util.promisify(setImmediate)

describe('group', () => {
  describe('GroupEventsEmitter', () => {
    let sequelize: Sequelize

    before(async (): Promise<void> => {
      sequelize = sequelizeFactory()
      await Web3Events.init(sequelize)
    })

    beforeEach(async () => {
      await sequelize.sync({ force: true })
    })

    it('should check that batch sizes are same', () => {
      const eth = Substitute.for<Eth>()

      expect(() => {
        // eslint-disable-next-line no-new
        new GroupEventsEmitter(eth, [eventsFetcherMock(undefined, undefined, 'one', 5), eventsFetcherMock(undefined, undefined, 'one', 10)])
      }).to.throw('Emitter for contract one has different batch size! 10 != 5')
    })

    it('should check that there are no listeners', () => {
      const eth = Substitute.for<Eth>()
      const fetcher = Substitute.for<EventsFetcher<EventLog>>()
      fetcher.listenerCount(NEW_EVENT_EVENT_NAME).returns!(2)
      fetcher.name.returns!('lol')

      expect(() => {
        // eslint-disable-next-line no-new
        new GroupEventsEmitter(eth, [fetcher])
      }).to.throw('Emitter for contract lol has newEvent listeners!')
    })

    it('should fetch events without serial processing in the original order', async function () {
      const fetcher1 = eventsFetcherMock([
        [
          eventMock({ blockNumber: 2, transactionIndex: 2, logIndex: 1, event: 'order1' }),
          eventMock({ blockNumber: 2, transactionIndex: 2, logIndex: 3, event: 'order3' })
        ],
        [eventMock({ blockNumber: 8, transactionIndex: 2, logIndex: 2, event: 'order5' })]
      ])

      const fetcher2 = eventsFetcherMock([
        [eventMock({ blockNumber: 2, transactionIndex: 2, logIndex: 2, event: 'order2' })],
        [
          eventMock({ blockNumber: 8, transactionIndex: 2, logIndex: 1, event: 'order4' }),
          eventMock({ blockNumber: 8, transactionIndex: 2, logIndex: 3, event: 'order6' })
        ]
      ])

      const eth = Substitute.for<Eth>()
      eth.getBlock('latest').resolves(blockMock(11))

      const options: GroupEmitterOptions = {
        orderedProcessing: false,
        logger: loggingFactory('web3events:events:group')
      }
      const eventsEmitter = new GroupEventsEmitter(eth, [fetcher1, fetcher2], options)

      const result = await wholeGenerator(eventsEmitter.fetch())
      eth.received(1).getBlock('latest')

      expect(result).to.have.length(4)
      expect(result[0].events.map(event => event.event)).to.eql(['order1', 'order3'])
      expect(result[1].events.map(event => event.event)).to.eql(['order5'])
      expect(result[2].events.map(event => event.event)).to.eql(['order2'])
      expect(result[3].events.map(event => event.event)).to.eql(['order4', 'order6'])
    })
    describe('orderedProcessing enabled', () => {
      it('should fetched and order events from the passed emitters', async function () {
        const fetcher1 = eventsFetcherMock([
          [
            eventMock({ blockNumber: 2, transactionIndex: 2, logIndex: 1, event: 'order1' }),
            eventMock({ blockNumber: 2, transactionIndex: 2, logIndex: 3, event: 'order3' })
          ],
          [eventMock({ blockNumber: 8, transactionIndex: 2, logIndex: 2, event: 'order5' })]
        ])

        const fetcher2 = eventsFetcherMock([
          [eventMock({ blockNumber: 2, transactionIndex: 2, logIndex: 2, event: 'order2' })],
          [
            eventMock({ blockNumber: 8, transactionIndex: 2, logIndex: 1, event: 'order4' }),
            eventMock({ blockNumber: 8, transactionIndex: 2, logIndex: 3, event: 'order6' })
          ]
        ])

        const eth = Substitute.for<Eth>()
        eth.getBlock('latest').resolves(blockMock(11))

        const options: GroupEmitterOptions = {
          orderedProcessing: true,
          logger: loggingFactory('web3events:events:group')
        }
        const eventsEmitter = new GroupEventsEmitter(eth, [fetcher1, fetcher2], options)

        const result = await wholeGenerator(eventsEmitter.fetch())
        eth.received(1).getBlock('latest')

        expect(result).to.have.length(2)
        expect(result[0].events.map(event => event.event)).to.eql(['order1', 'order2', 'order3'])
        expect(result[1].events.map(event => event.event)).to.eql(['order4', 'order5', 'order6'])
      })

      it('should detect and synchronize un-synchronized emitters', async function () {
        const eth = Substitute.for<Eth>()
        const currentBlock = blockMock(21)
        eth.getBlock('latest').resolves(currentBlock)

        const blockTracker1 = new BlockTracker({})
        blockTracker1.setLastFetchedBlock(1, '0x123')
        const fetcher1 = eventsFetcherMock(undefined, blockTracker1)

        // Events that will be used in the syncing process
        const batchFactorySync1 = batchFactoryConstructor(undefined, 5)
        fetcher1.fetch({ currentBlock, toBlockNumber: 20 }).returns(createGenerator<Batch<EventLog>>([
          batchFactorySync1([
            eventMock({
              blockNumber: 2,
              transactionIndex: 2,
              logIndex: 2,
              event: 'syncEvent1'
            })
          ]),
          batchFactorySync1([
            eventMock({
              blockNumber: 8,
              transactionIndex: 2,
              logIndex: 2,
              event: 'syncEvent2'
            })
          ]),
          batchFactorySync1([
            eventMock({
              blockNumber: 12,
              transactionIndex: 2,
              logIndex: 2,
              event: 'syncEvent3'
            })
          ])
        ]))

        // Data for the normal fetch()
        fetcher1.fetch({ currentBlock }).returns(createGenerator<Batch<EventLog>>([
          batchMock([
            eventMock({
              blockNumber: 21,
              transactionIndex: 1,
              logIndex: 2,
              event: 'normalEvent2'
            })
          ], 20, 21)
        ]))

        const blockTracker2 = new BlockTracker({})
        blockTracker2.setLastFetchedBlock(20, '0x123') // --> First emitter is still on block no. 1 => 19 blocks to synchronize => syncPoint = 20
        const fetcher2 = eventsFetcherMock(undefined, blockTracker2)

        // Events for syncing process. During sync there is no data coming from fetcher2 because he is the farthest "unsynced" emitter
        fetcher2.fetch({
          currentBlock,
          toBlockNumber: 20
        }).returns(createGenerator<Batch<EventLog>>([batchMock<EventLog>([])]))

        // Data for the normal fetch()
        fetcher2.fetch({ currentBlock }).returns(createGenerator<Batch<EventLog>>([
          batchMock<EventLog>([
            eventMock({
              blockNumber: 21,
              transactionIndex: 1,
              logIndex: 1,
              event: 'normalEvent1'
            }),
            eventMock({
              blockNumber: 21,
              transactionIndex: 1,
              logIndex: 3,
              event: 'normalEvent3'
            })
          ], 20, 21)
        ]))

        const options: GroupEmitterOptions = {
          orderedProcessing: true,
          logger: loggingFactory('web3events:events:group')
        }
        const eventsEmitter = new GroupEventsEmitter(eth, [fetcher1, fetcher2], options)

        const result = await wholeGenerator(eventsEmitter.fetch())
        eth.received(1).getBlock('latest')

        expect(result).to.have.length(2)
        expect(result[0].events.map(event => event.event)).to.eql(['syncEvent1', 'syncEvent2', 'syncEvent3'])
        expect(result[1].events.map(event => event.event)).to.eql(['normalEvent1', 'normalEvent2', 'normalEvent3'])
      })

      // TODO: ...
      // it('should not run syncing when no events were ever fetched yet', async () => {
      // })

      it('should passthrough all expected events', async () => {
        const eth = Substitute.for<Eth>()
        const fetcher1 = eventsFetcherMock(undefined, undefined, 'fetcher1')

        const options: GroupEmitterOptions = {
          logger: loggingFactory('web3events:events:group')
        }
        const eventsEmitter = new GroupEventsEmitter(eth, [fetcher1], options)

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
        supportedEvents.forEach(eventName => fetcher1.emit(eventName, 123))
        await setImmediatePromise()

        // Assert passthrough events
        supportedEvents.forEach(eventName => {
          expect(spies[eventName], eventName).to.be.calledOnceWithExactly({ name: 'fetcher1', data: 123 })
        })

        // Assert that other events are not passthrough
        const randomSpy = sinon.spy()
        // @ts-ignore
        eventsEmitter.on('random', randomSpy)
        fetcher1.emit('random', 321)
        await setImmediatePromise()
        expect(randomSpy).not.to.be.called()
      })
    })
  })

  describe('fetchBatches', function () {
    it('should fetch single batch by default and order', async () => {
      let batchFactory = batchFactoryConstructor()
      const emitter1 = createGenerator([
        batchFactory([
          eventMock({ blockNumber: 2, transactionIndex: 2, logIndex: 1, event: 'order1' }),
          eventMock({ blockNumber: 2, transactionIndex: 2, logIndex: 3, event: 'order3' })
        ]),
        batchFactory([eventMock({ blockNumber: 8, transactionIndex: 2, logIndex: 2, event: 'order5' })])
      ])

      batchFactory = batchFactoryConstructor()
      const emitter2 = createGenerator([
        batchFactory([eventMock({ blockNumber: 2, transactionIndex: 2, logIndex: 2, event: 'order2' })]),
        batchFactory([
          eventMock({ blockNumber: 8, transactionIndex: 2, logIndex: 1, event: 'order4' }),
          eventMock({ blockNumber: 8, transactionIndex: 2, logIndex: 3, event: 'order6' })
        ])
      ])

      const result = await wholeGenerator(fetchBatches([emitter1, emitter2]))
      expect(result).to.have.length(2)
      expect(result[0].events.map(event => event.event)).to.eql(['order1', 'order2', 'order3'])
      expect(result[1].events.map(event => event.event)).to.eql(['order4', 'order5', 'order6'])
    })

    it('should fetch all batches and order them if bufferAllBatches is true', async () => {
      let batchFactory = batchFactoryConstructor()
      const emitter1 = createGenerator([
        batchFactory([
          eventMock({ blockNumber: 2, transactionIndex: 2, logIndex: 1, event: 'order1' }),
          eventMock({ blockNumber: 2, transactionIndex: 2, logIndex: 3, event: 'order3' })
        ]),
        batchFactory([eventMock({ blockNumber: 8, transactionIndex: 2, logIndex: 2, event: 'order5' })])
      ])

      batchFactory = batchFactoryConstructor()
      const emitter2 = createGenerator([
        batchFactory([eventMock({ blockNumber: 2, transactionIndex: 2, logIndex: 2, event: 'order2' })]),
        batchFactory([
          eventMock({ blockNumber: 8, transactionIndex: 2, logIndex: 1, event: 'order4' }),
          eventMock({ blockNumber: 8, transactionIndex: 2, logIndex: 3, event: 'order6' })
        ])
      ])

      const result = await wholeGenerator(fetchBatches([emitter1, emitter2], true))
      expect(result).to.have.length(1)
      expect(result[0].events.map(event => event.event)).to.eql(['order1', 'order2', 'order3', 'order4', 'order5', 'order6'])
    })
  })
})
