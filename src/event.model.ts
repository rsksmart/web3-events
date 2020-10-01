import { Table, Column, Model, DataType } from 'sequelize-typescript'

@Table({
  freezeTableName: true,
  tableName: 'event',
  indexes: [
    {
      unique: true,
      fields: ['transactionHash', 'logIndex']
    }
  ]
})

export default class Event extends Model {
  @Column(DataType.INTEGER)
  blockNumber!: number

  @Column(DataType.STRING(66))
  transactionHash!: string

  @Column(DataType.INTEGER)
  logIndex!: number

  @Column(DataType.INTEGER)
  targetConfirmation!: number

  @Column(DataType.STRING(66))
  contractAddress!: string

  @Column(DataType.TEXT)
  event!: string

  @Column(DataType.TEXT)
  content!: string

  @Column({ type: DataType.BOOLEAN, defaultValue: false })
  emitted!: boolean

  public getConfirmationsCount (currentBlockNumber: number): number {
    return currentBlockNumber - this.blockNumber
  }
}

export type EventInterface =
  Pick<Event, 'blockNumber' | 'transactionHash' | 'logIndex' | 'contractAddress' | 'event' | 'targetConfirmation' | 'content'>
  & { emitted?: boolean }
