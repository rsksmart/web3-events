import { BlockHeader, BlockTransactionString, TransactionReceipt, Transaction } from 'web3-eth'
import { Substitute } from '@fluffy-spoon/substitute'
import { EventData } from 'web3-eth-contract'
import path from 'path'
import { Sequelize, SequelizeOptions } from 'sequelize-typescript'
import { loggingFactory } from '../src/utils'
import sqlFormatter from 'sql-formatter'

export function sleep<T> (ms: number, ...args: T[]): Promise<T> {
  return new Promise(resolve => setTimeout(() => resolve(...args), ms))
}

function formatLogs (msg: string): string {
  const result = msg.match(/^Executing \(([\w\d-]+)\): (.*)/m)

  if (!result) {
    return msg
  }

  return `Executing SQL (${result[1]}):\n${sqlFormatter.format(result[2])}`
}

export function sequelizeFactory (): Sequelize {
  const logger = loggingFactory('db')
  const dbSettings: SequelizeOptions = {
    models: [path.join(__dirname, '../src/**/*.model.+(ts|js)')],
    modelMatch: (filename: string, member: string): boolean => {
      return filename.substring(0, filename.indexOf('.model')) === member.toLowerCase()
    },
    logging: (msg) => logger.debug(formatLogs(msg)),
    // @ts-ignore
    transactionType: 'IMMEDIATE'
  }

  return new Sequelize('sqlite:../db.sqlite', dbSettings)
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

export function delayedPromise (): [Promise<any>, (...args: any[]) => void] {
  let success: () => void
  const promise = new Promise((resolve) => {
    success = resolve
  })

  // @ts-ignore
  return [promise, success]
}
