"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BlockTracker = void 0;
const emittery_1 = __importDefault(require("emittery"));
const definitions_1 = require("./definitions");
/**
 * Simple class for persistence of last processed block in order to not crawl the whole blockchain upon every restart
 * of the server.
 */
class BlockTracker extends emittery_1.default.Typed {
    constructor(store) {
        super();
        this.store = store;
    }
    setLastFetchedBlock(blockNumber, blockHash) {
        this.store[definitions_1.LAST_FETCHED_BLOCK_HASH_KEY] = blockHash;
        this.store[definitions_1.LAST_FETCHED_BLOCK_NUMBER_KEY] = blockNumber;
        this.emit('fetchedBlockSet');
    }
    getLastFetchedBlock() {
        return [this.store[definitions_1.LAST_FETCHED_BLOCK_NUMBER_KEY], this.store[definitions_1.LAST_FETCHED_BLOCK_HASH_KEY]];
    }
    setLastProcessedBlockIfHigher(blockNumber, blockHash) {
        if ((this.store[definitions_1.LAST_PROCESSED_BLOCK_NUMBER_KEY] || -1) > blockNumber) {
            return;
        }
        this.store[definitions_1.LAST_PROCESSED_BLOCK_HASH_KEY] = blockHash;
        this.store[definitions_1.LAST_PROCESSED_BLOCK_NUMBER_KEY] = blockNumber;
        this.emit('processedBlockSet');
    }
    getLastProcessedBlock() {
        return [this.store[definitions_1.LAST_PROCESSED_BLOCK_NUMBER_KEY], this.store[definitions_1.LAST_PROCESSED_BLOCK_HASH_KEY]];
    }
}
exports.BlockTracker = BlockTracker;
