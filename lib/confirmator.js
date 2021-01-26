"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelConfirmator = void 0;
const sequelize_1 = require("sequelize");
const event_model_1 = require("./event.model");
const utils_1 = require("./utils");
const definitions_1 = require("./definitions");
const DEFAULT_WAITING_BLOCK_COUNT = 10;
function isConfirmedClosure(currentBlockNumber) {
    return (event) => !event.emitted && event.getConfirmationsCount(currentBlockNumber) >= event.targetConfirmation;
}
/**
 * Class that handles confirmations of blocks.
 * Also gives support to detect what events were dropped.
 */
class ModelConfirmator {
    constructor(emitter, eth, contractAddress, blockTracker, { logger, waitingBlockCount } = {}) {
        this.emitter = emitter;
        this.eth = eth;
        this.contractAddress = contractAddress;
        this.blockTracker = blockTracker;
        this.logger = utils_1.initLogger('confirmator', logger);
        this.waitingBlockCount = waitingBlockCount !== null && waitingBlockCount !== void 0 ? waitingBlockCount : DEFAULT_WAITING_BLOCK_COUNT;
    }
    /**
     * Retrieves confirmed events and emits them.
     *
     * Before emitting it validates that the Event is still valid on blockchain using the transaction's receipt.
     *
     * @param currentBlock
     * @param toBlockNum
     */
    runConfirmationsRoutine(currentBlock, toBlockNum) {
        return __awaiter(this, void 0, void 0, function* () {
            if (typeof currentBlock.number !== 'number') {
                throw new TypeError('CurrentBlock.number is not a number!');
            }
            if (typeof this.waitingBlockCount !== 'number') {
                throw new TypeError('waitingBlockCount is not a number!');
            }
            const conditions = {
                contractAddress: this.contractAddress,
                emitted: false
            };
            if (toBlockNum) {
                conditions.blockNumber = { [sequelize_1.Op.lte]: toBlockNum };
            }
            this.logger.verbose('Running Confirmation routine');
            const events = yield event_model_1.Event.findAll({
                where: conditions
            });
            if (!events) {
                return [];
            }
            const [valid, invalid] = yield utils_1.asyncSplit(events, this.eventHasValidReceipt.bind(this));
            valid.forEach(this.emitNewConfirmationsClosure(currentBlock.number));
            if (invalid.length !== 0) {
                invalid.forEach(e => this.emitter.emit(definitions_1.INVALID_CONFIRMATION_EVENT_NAME, { transactionHash: e.transactionHash }));
                yield event_model_1.Event.destroy({ where: { id: invalid.map(e => e.id) } });
            }
            // Remove already too old confirmations
            yield event_model_1.Event.destroy({
                where: {
                    emitted: true,
                    contractAddress: this.contractAddress,
                    blockNumber: { [sequelize_1.Op.lte]: sequelize_1.literal(`${currentBlock.number - this.waitingBlockCount} - \`targetConfirmation\``) }
                }
            });
            const toBeEmitted = valid.filter(isConfirmedClosure(currentBlock.number));
            this.logger.info(`Confirmed ${toBeEmitted.length} events.`);
            yield event_model_1.Event.update({ emitted: true }, { where: { id: toBeEmitted.map(e => e.id) } }); // Update DB that events were emitted
            return toBeEmitted.map(this.confirmEvent.bind(this));
        });
    }
    eventHasValidReceipt(event) {
        return __awaiter(this, void 0, void 0, function* () {
            const receipt = yield this.eth.getTransactionReceipt(event.transactionHash);
            if (receipt.status && receipt.blockNumber === event.blockNumber) {
                return true;
            }
            else {
                this.logger.warn(`Event ${event.event} of transaction ${event.transactionHash} does not have valid receipt!
      Block numbers: ${event.blockNumber} (event) vs ${receipt.blockNumber} (receipt) and receipt status: ${receipt.status} `);
                return false;
            }
        });
    }
    emitNewConfirmationsClosure(currentBlockNumber) {
        return (event) => {
            const data = {
                event: event.event,
                transactionHash: event.transactionHash,
                confirmations: event.getConfirmationsCount(currentBlockNumber),
                targetConfirmation: event.targetConfirmation
            };
            this.emitter.emit(definitions_1.NEW_CONFIRMATION_EVENT_NAME, data);
        };
    }
    confirmEvent(data) {
        const event = JSON.parse(data.content);
        this.logger.debug('Confirming event', event);
        return event;
    }
    /**
     * This should be called when handling of reorg inside of confirmation range.
     * The re-fetched transactions from blockchain are passed here and they are compared with the current events that awaits confirmation.
     * If some transaction is not present in the new transactions that it is pronounced as a dropped transaction and emitted as such.
     *
     * @param newEvents - Re-fetched events inside of the confirmation range from blockchain.
     * @emits INVALID_CONFIRMATION_EVENT_NAME - with transactionHash of the dropped transaction.
     */
    checkDroppedTransactions(newEvents) {
        return __awaiter(this, void 0, void 0, function* () {
            const currentEvents = yield event_model_1.Event.findAll({
                where: {
                    contractAddress: this.contractAddress
                }
            });
            const newEventsTransactions = newEvents.reduce((set, event) => set.add(event.transactionHash), new Set());
            const oldEventsTransactions = currentEvents.reduce((set, event) => set.add(event.transactionHash), new Set());
            const droppedTransactions = utils_1.setDifference(oldEventsTransactions, newEventsTransactions);
            for (const droppedTransaction of droppedTransactions) {
                this.emitter.emit(definitions_1.INVALID_CONFIRMATION_EVENT_NAME, { transactionHash: droppedTransaction }).catch(e => this.emitter.emit('error', e));
            }
        });
    }
}
exports.ModelConfirmator = ModelConfirmator;
