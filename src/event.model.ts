import { Model, DataTypes } from 'sequelize'

export default class Event extends Model {
  id!: number
  blockNumber!: number
  transactionHash!: string
  targetConfirmation!: number
  contractAddress!: string
  event!: string
  content!: string
  emitted!: boolean

  public getConfirmationsCount (currentBlockNumber: number): number {
    return currentBlockNumber - this.blockNumber
  }
}

export const EventModelDefinition = {
  blockNumber: { type: DataTypes.INTEGER, allowNull: false },
  transactionHash: { type: DataTypes.STRING(66), allowNull: false },
  targetConfirmation: { type: DataTypes.INTEGER, allowNull: false },
  contractAddress: { type: DataTypes.STRING(66), allowNull: false },
  event: { type: DataTypes.TEXT, allowNull: false },
  content: { type: DataTypes.TEXT },
  emitted: { type: DataTypes.BOOLEAN, defaultValue: false }
}

export type EventInterface =
  Pick<Event, 'blockNumber' | 'transactionHash' | 'contractAddress' | 'event' | 'targetConfirmation' | 'content'>
  & { emitted?: boolean }
