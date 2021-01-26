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
exports.ListeningNewBlockEmitter = exports.PollingNewBlockEmitter = void 0;
const utils_1 = require("./utils");
const definitions_1 = require("./definitions");
const DEFAULT_POLLING_INTERVAL = 5000;
/**
 * EventEmitter that emits event upon new block on the blockchain.
 * Uses polling strategy.
 */
class PollingNewBlockEmitter extends utils_1.AutoStartStopEventEmitter {
    constructor(eth, pollingInterval = DEFAULT_POLLING_INTERVAL) {
        super(utils_1.initLogger('block-emitter:listening'), definitions_1.NEW_BLOCK_EVENT_NAME);
        this.lastBlockNumber = 0;
        this.eth = eth;
        this.pollingInterval = pollingInterval;
    }
    fetchLastBlockNumber() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const lastBlock = yield this.eth.getBlock('latest');
                if (this.lastBlockNumber !== lastBlock.number) {
                    this.lastBlockNumber = lastBlock.number;
                    this.logger.verbose(`New block with number ${lastBlock.number} with hash ${lastBlock.hash}`);
                    this.emit(definitions_1.NEW_BLOCK_EVENT_NAME, lastBlock).catch(e => this.emit('error', e));
                }
            }
            catch (e) {
                this.logger.error('While fetching latest block error happend!');
                this.logger.error(e);
                this.emit('error', e);
            }
        });
    }
    start() {
        // Fetch last block right away
        this.fetchLastBlockNumber().catch(this.logger.error);
        this.intervalId = setInterval(this.fetchLastBlockNumber.bind(this), this.pollingInterval);
    }
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
    }
}
exports.PollingNewBlockEmitter = PollingNewBlockEmitter;
/**
 * EventEmitter that emits event upon new block on the blockchain.
 * Uses listening strategy for 'newBlockHeaders' event.
 */
class ListeningNewBlockEmitter extends utils_1.AutoStartStopEventEmitter {
    constructor(eth) {
        super(utils_1.initLogger('block-emitter:listening'), definitions_1.NEW_BLOCK_EVENT_NAME);
        this.eth = eth;
    }
    start() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Emit block number right away
                const lastBlock = yield this.eth.getBlock('latest');
                this.logger.verbose(`Current block with number ${lastBlock.number} with hash ${lastBlock.hash}`);
                this.emit(definitions_1.NEW_BLOCK_EVENT_NAME, lastBlock).catch(e => this.emit('error', e));
                this.subscription = this.eth.subscribe('newBlockHeaders', (error, blockHeader) => {
                    if (error) {
                        this.logger.error(error);
                        this.emit('error', error);
                        return;
                    }
                    this.logger.verbose(`New block with number ${lastBlock.number} with hash ${lastBlock.hash}`);
                    this.emit(definitions_1.NEW_BLOCK_EVENT_NAME, blockHeader).catch(e => this.emit('error', e));
                });
            }
            catch (e) {
                this.logger.error(e);
                this.emit('error', e);
            }
        });
    }
    stop() {
        var _a;
        (_a = this.subscription) === null || _a === void 0 ? void 0 : _a.unsubscribe(error => { this.logger.error(error); });
    }
}
exports.ListeningNewBlockEmitter = ListeningNewBlockEmitter;
