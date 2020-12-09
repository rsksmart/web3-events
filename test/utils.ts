import { BlockHeader, BlockTransactionString, TransactionReceipt } from 'web3-eth'
import { Arg, Substitute, SubstituteOf } from '@fluffy-spoon/substitute'
import { EventData } from 'web3-eth-contract'
import path from 'path'
import { Options, Sequelize } from 'sequelize'
import { loggingFactory } from '../src/utils'
import sqlFormatter from 'sql-formatter'
import Sinon from 'sinon'
import { Batch, BlockTracker, EventsFetcher } from '../src'
import Emittery from 'emittery'

export function sleep<T> (ms: number, ...args: T[]): Promise<T> {
  return new Promise(resolve => setTimeout(() => resolve(...args), ms))
}

export async function wholeGenerator<T = any> (iter: AsyncIterableIterator<T>): Promise<T[]> {
  const allItems = []
  for await (const item of iter) {
    allItems.push(item)
  }

  return allItems
}

// eslint-disable-next-line require-await
export async function * createGenerator<T> (input: T[]): AsyncIterableIterator<T> {
  for (const entry of input) {
    yield entry
  }
}

function formatLogs (msg: string): string {
  const result = msg.match(/^Executing \(([\w\d-]+)\): (.*)/m)

  if (!result) {
    return msg
  }

  return `Executing SQL (${result[1]}):\n${sqlFormatter.format(result[2])}`
}

export function sequelizeFactory (): Sequelize {
  const logger = loggingFactory('web3events:db')
  const dbSettings: Options = {
    dialect: 'sqlite',
    storage: path.join(__dirname, '..', 'db.sqlite'),
    logging: (msg: any) => logger.debug(formatLogs(msg)),
    // @ts-ignore
    transactionType: 'IMMEDIATE'
  }

  return new Sequelize(dbSettings)
}

export function receiptMock (blockNumber?: number, status = true): TransactionReceipt {
  const receipt = Substitute.for<TransactionReceipt>()

  if (blockNumber !== undefined) {
    receipt.blockNumber.returns!(blockNumber)
  }

  if (status !== undefined) {
    receipt.status.returns!(status)
  }

  return receipt
}

export function subscribeMock (sequence: Array<Error | BlockHeader>, interval = 100): (event: string, cb: (err?: Error, blockHeader?: BlockHeader) => void) => void {
  let counter = 0
  let intervalId: NodeJS.Timeout
  return (event: string, cb: (err?: Error, blockHeader?: BlockHeader) => void): void => {
    intervalId = setInterval(() => {
      if (counter >= sequence.length) {
        clearInterval(intervalId)
        return
      }

      if (sequence[counter] instanceof Error) {
        // eslint-disable-next-line standard/no-callback-literal
        cb(sequence[counter] as Error, undefined)
      } else {
        cb(undefined, sequence[counter] as BlockHeader)
      }

      counter += 1
    }, interval)
  }
}

export function eventMock (options?: Partial<EventData>): EventData {
  const testEvent = Substitute.for<EventData>()
  options = options || {}

  for (const [key, value] of Object.entries(options)) {
    // @ts-ignore
    testEvent[key].returns!(value)
  }

  if (!options.event) {
    testEvent.event.returns!('testEvent')
  }

  return testEvent
}

export function batchFactoryConstructor<E extends EventData> (start?: number, batchSize = 5): (e: E[]) => Batch<E> {
  let counter = 0
  let startBlock = start ?? 0
  startBlock -= batchSize

  return (e: E[]) => {
    counter += 1
    startBlock += batchSize

    return {
      stepsComplete: counter,
      totalSteps: counter,
      stepFromBlock: startBlock,
      stepToBlock: startBlock + batchSize,
      events: e
    }
  }
}

export function eventsFetcherMock<E extends EventData> (events?: E[][], blockTracker?: BlockTracker, name?: string, batchSize = 5): SubstituteOf<EventsFetcher<E>> {
  const emitter = new Emittery()

  if (!blockTracker) {
    blockTracker = new BlockTracker({})
    blockTracker.setLastFetchedBlock(1, '0x123')
    blockTracker.setLastProcessedBlockIfHigher(0, '0x123')
  }

  const fetcher = Substitute.for<EventsFetcher<E>>()
  fetcher.batchSize.returns!(batchSize)
  fetcher.listenerCount(Arg.all()).returns(0)
  fetcher.blockTracker.returns!(blockTracker)

  fetcher.emit(Arg.all()).mimicks(emitter.emit.bind(emitter))
  fetcher.on(Arg.all()).mimicks(emitter.on.bind(emitter))

  if (name) {
    fetcher.name.returns!(name)
  }

  if (events) {
    const batchFactory = batchFactoryConstructor<E>(undefined, batchSize)
    fetcher.fetch(Arg.all()).returns(createGenerator<Batch<E>>(events.map(eventsGroup => batchFactory(eventsGroup))))
  }

  return fetcher
}

export function batchMock<E> (events: E[], from = 5, to = 10): Batch<E> {
  const batch = Substitute.for<Batch<E>>()
  batch.stepFromBlock.returns!(from)
  batch.stepToBlock.returns!(to)
  batch.events.returns!(events)

  return batch
}

export function blockMock (blockNumber: number, blockHash = '0x123', options: Partial<BlockTransactionString> = {}): BlockTransactionString {
  const block = Substitute.for<BlockTransactionString>()

  Object.entries(options).forEach(([key, value]) => {
    // @ts-ignore
    block[key].returns!(value)
  })

  block.number.returns!(blockNumber)
  block.hash.returns!(blockHash)
  return block
}

export function delayedPromise (): [Promise<any>, (...args: any[]) => void, Sinon.SinonSpy] {
  let success: () => void
  const promise = new Promise((resolve) => {
    success = resolve
  })

  // @ts-ignore
  return [promise, success]
}
