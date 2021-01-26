"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventModelDefinition = exports.Event = void 0;
const sequelize_1 = require("sequelize");
class Event extends sequelize_1.Model {
    getConfirmationsCount(currentBlockNumber) {
        return currentBlockNumber - this.blockNumber;
    }
}
exports.Event = Event;
exports.EventModelDefinition = {
    blockNumber: { type: sequelize_1.DataTypes.INTEGER, allowNull: false },
    transactionHash: { type: sequelize_1.DataTypes.STRING(66), allowNull: false },
    targetConfirmation: { type: sequelize_1.DataTypes.INTEGER, allowNull: false },
    contractAddress: { type: sequelize_1.DataTypes.STRING(66), allowNull: false },
    event: { type: sequelize_1.DataTypes.TEXT, allowNull: false },
    content: { type: sequelize_1.DataTypes.TEXT },
    emitted: { type: sequelize_1.DataTypes.BOOLEAN, defaultValue: false }
};
