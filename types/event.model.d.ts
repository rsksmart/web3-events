import { Model, DataTypes } from 'sequelize';
export declare class Event extends Model {
    id: number;
    blockNumber: number;
    transactionHash: string;
    targetConfirmation: number;
    contractAddress: string;
    event: string;
    content: string;
    emitted: boolean;
    getConfirmationsCount(currentBlockNumber: number): number;
}
export declare const EventModelDefinition: {
    blockNumber: {
        type: DataTypes.IntegerDataTypeConstructor;
        allowNull: boolean;
    };
    transactionHash: {
        type: DataTypes.StringDataType;
        allowNull: boolean;
    };
    targetConfirmation: {
        type: DataTypes.IntegerDataTypeConstructor;
        allowNull: boolean;
    };
    contractAddress: {
        type: DataTypes.StringDataType;
        allowNull: boolean;
    };
    event: {
        type: DataTypes.TextDataTypeConstructor;
        allowNull: boolean;
    };
    content: {
        type: DataTypes.TextDataTypeConstructor;
    };
    emitted: {
        type: DataTypes.AbstractDataTypeConstructor;
        defaultValue: boolean;
    };
};
export declare type EventInterface = Pick<Event, 'blockNumber' | 'transactionHash' | 'contractAddress' | 'event' | 'targetConfirmation' | 'content'> & {
    emitted?: boolean;
};
