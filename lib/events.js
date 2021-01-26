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
var __await = (this && this.__await) || function (v) { return this instanceof __await ? (this.v = v, this) : new __await(v); }
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __asyncDelegator = (this && this.__asyncDelegator) || function (o) {
    var i, p;
    return i = {}, verb("next"), verb("throw", function (e) { throw e; }), verb("return"), i[Symbol.iterator] = function () { return this; }, i;
    function verb(n, f) { i[n] = o[n] ? function (v) { return (p = !p) ? { value: __await(o[n](v)), done: n === "return" } : f ? f(v) : v; } : f; }
};
var __asyncGenerator = (this && this.__asyncGenerator) || function (thisArg, _arguments, generator) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var g = generator.apply(thisArg, _arguments || []), i, q = [];
    return i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i;
    function verb(n) { if (g[n]) i[n] = function (v) { return new Promise(function (a, b) { q.push([n, v, a, b]) > 1 || resume(n, v); }); }; }
    function resume(n, v) { try { step(g[n](v)); } catch (e) { settle(q[0][3], e); } }
    function step(r) { r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r); }
    function fulfill(value) { resume("next", value); }
    function reject(value) { resume("throw", value); }
    function settle(f, v) { if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ManualEventsEmitter = void 0;
const async_sema_1 = require("async-sema");
const emittery_1 = __importDefault(require("emittery"));
const event_model_1 = require("./event.model");
const definitions_1 = require("./definitions");
const utils_1 = require("./utils");
const confirmator_1 = require("./confirmator");
const index_1 = require("./index");
const DEFAULT_BATCH_SIZE = 120; // 120 blocks = RSK one hour of blocks
/**
 * EventsEmitter implementation where you have to manually call fetch() function to get events.
 * It still supports emitting of all events like AutoEventsEmitter excecept the 'newEvent' with events.
 * It supports block's confirmation, where new events are stored to DB and only after configured number of new
 * blocks are emitted to consumers for further processing.
 */
class ManualEventsEmitter extends emittery_1.default.Typed {
    constructor(eth, contract, blockTracker, baseLogger, options) {
        var _a, _b, _c;
        super();
        this.logger = utils_1.initLogger('', baseLogger);
        this.eth = eth;
        this.contract = contract;
        this.eventNames = options === null || options === void 0 ? void 0 : options.events;
        this.startingBlock = (_a = options === null || options === void 0 ? void 0 : options.startingBlock) !== null && _a !== void 0 ? _a : 0;
        this.confirmations = (_b = options === null || options === void 0 ? void 0 : options.confirmations) !== null && _b !== void 0 ? _b : 0;
        this.topics = utils_1.hashTopics(options === null || options === void 0 ? void 0 : options.topics);
        this.batchSize = (_c = options === null || options === void 0 ? void 0 : options.batchSize) !== null && _c !== void 0 ? _c : DEFAULT_BATCH_SIZE;
        this.semaphore = new async_sema_1.Sema(1); // Allow only one caller
        this.tracker = blockTracker;
        if (!index_1.Web3Events.isInitialized) {
            throw new Error('You have to run Web3Events.init() before creating instance!');
        }
        if (typeof this.startingBlock !== 'number') {
            throw new TypeError('startingBlock has to be a number!');
        }
        if (!this.topics && !this.eventNames) {
            throw new Error('You have to specify options.topics or options.events!');
        }
        if (this.confirmations > 0 && (options === null || options === void 0 ? void 0 : options.confirmator) !== null) {
            if ((options === null || options === void 0 ? void 0 : options.confirmator) instanceof confirmator_1.ModelConfirmator) {
                this.confirmator = options === null || options === void 0 ? void 0 : options.confirmator;
            }
            else {
                this.confirmator = new confirmator_1.ModelConfirmator(this, eth, contract.address, this.tracker, Object.assign({ logger: baseLogger }, options === null || options === void 0 ? void 0 : options.confirmator));
            }
        }
    }
    /**
     * Method that will fetch Events from the last fetched block.
     * If nothing was fetched yet, then fetching starts from configured startingBlock or genesis block.
     * If there is nothing to fetch (eq. from last call no new block was created on the chain) then nothing is yielded.
     * If there is no events fetched then empty batch is yielded anyway.
     *
     * If confirmations are enabled, then it will ALWAYS emit at least two batches, where the first
     * batches is one with all the confirmed events (even though there might be no events to be confirmed)
     * and then later on is processing the from-to range as configured with batching enabled.
     *
     * @param options
     * @param options.currentBlock: Is the latest block on a blockchain, serves as optimization if you have already the information available.
     * @param options.toBlockNumber: Number of block to which the events will be fetched to INCLUDING
     * @yields Batch object
     */
    fetch(options) {
        var _a, _b, _c;
        return __asyncGenerator(this, arguments, function* fetch_1() {
            this.logger.verbose('Acquiring lock for fetch()');
            if (this.semaphore.nrWaiting() > 0) {
                this.logger.warn(`There is multiple fetch() call queued up! Count: ${this.semaphore.nrWaiting()}`);
            }
            yield __await(this.semaphore.acquire());
            this.logger.verbose('Lock acquired for fetch()');
            try {
                const currentBlock = (_a = options === null || options === void 0 ? void 0 : options.currentBlock) !== null && _a !== void 0 ? _a : yield __await(this.eth.getBlock('latest'));
                const fromNumber = (_b = this.tracker.getLastFetchedBlock()[0]) !== null && _b !== void 0 ? _b : this.startingBlock;
                const toNumber = (_c = options === null || options === void 0 ? void 0 : options.toBlockNumber) !== null && _c !== void 0 ? _c : currentBlock.number;
                // Nothing new, lets fast-forward
                if (fromNumber === toNumber) {
                    this.logger.verbose('Nothing new to process');
                    return yield __await(void 0);
                }
                if (fromNumber > toNumber) {
                    throw new Error(`"from" block is bigger then "to" block (${fromNumber} > ${toNumber})`);
                }
                // Check if reorg did not happen since the last poll
                if (this.confirmations && (yield __await(this.isReorg()))) {
                    const confirmedEvents = yield __await(this.handleReorg(currentBlock));
                    yield yield __await({
                        totalSteps: 1,
                        stepsComplete: 1,
                        stepFromBlock: this.tracker.getLastProcessedBlock()[0],
                        stepToBlock: currentBlock.number,
                        events: confirmedEvents
                    });
                    return yield __await(void 0);
                }
                // Pass through the batches
                yield __await(yield* __asyncDelegator(__asyncValues(this.batchFetchAndProcessEvents(
                // +1 because fromBlock and toBlock are "or equal", eq. closed interval, so we need to avoid duplications
                // if nothing is fetched yet though then we start really from the fromNumber specified
                this.tracker.getLastFetchedBlock()[0] !== undefined ? fromNumber + 1 : fromNumber, toNumber, currentBlock))));
            }
            finally {
                this.semaphore.release();
            }
        });
    }
    /**
     * Method for processing events. It splits the events based on if they need more confirmations.
     *
     * @param events
     * @param currentBlockNumber?
     * @return Return array of events that have enough confirmation
     */
    processEvents(events, currentBlockNumber) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!Array.isArray(events)) {
                events = [events];
            }
            if (this.eventNames) {
                events = events.filter(data => { var _a; return (_a = this.eventNames) === null || _a === void 0 ? void 0 : _a.includes(data.event); });
            }
            if (events.length === 0) {
                this.logger.info('No events to be processed.');
                return [];
            }
            if (this.confirmations === 0) {
                return events;
            }
            const thresholdBlock = currentBlockNumber - this.confirmations;
            this.logger.verbose(`Threshold block ${thresholdBlock}`);
            const [eventsToBeEmitted, eventsToBeConfirmed] = utils_1.split(events, event => event.blockNumber <= thresholdBlock);
            this.logger.info(`${eventsToBeEmitted.length} events to be emitted.`);
            this.logger.info(`${eventsToBeConfirmed.length} events to be confirmed.`);
            yield event_model_1.Event.bulkCreate(eventsToBeConfirmed.map(this.serializeEvent.bind(this))); // Lets store them to DB
            if (eventsToBeEmitted.length > 0) {
                const lastEvent = eventsToBeEmitted[eventsToBeEmitted.length - 1];
                this.tracker.setLastProcessedBlockIfHigher(lastEvent.blockNumber, lastEvent.blockHash);
            }
            return eventsToBeEmitted;
        });
    }
    /**
     * Fetch and process events in batches.
     *
     * If confirmations are enabled, then it will ALWAYS emit at least two batches, where the first
     * batches is one with all the confirmed events (this does not currently respects the from-to range specified by parameters)
     * and then later on is processing the from-to range as configured with batching enabled.
     *
     * The interval defined by fromBlock and toBlock is closed, eq. "or equal".
     *
     * @param fromBlockNum
     * @param toBlockNum
     * @param currentBlock
     */
    batchFetchAndProcessEvents(fromBlockNum, toBlockNum, currentBlock) {
        return __asyncGenerator(this, arguments, function* batchFetchAndProcessEvents_1() {
            if (typeof fromBlockNum !== 'number' || typeof toBlockNum !== 'number') {
                throw new TypeError(`fromBlock and toBlock has to be numbers! Got from: ${fromBlockNum}; to: ${toBlockNum}`);
            }
            if (toBlockNum < fromBlockNum) {
                throw new Error('fromBlock has to be smaller then toBlock!');
            }
            const options = {};
            if (this.topics) {
                options.topics = this.topics;
            }
            const startTime = process.hrtime();
            this.logger.info(`Fetching and processing events from block ${fromBlockNum} to ${toBlockNum}`);
            this.logger.debug(`Batch size is ${this.batchSize}`);
            let batchOffset = 0;
            let batch = 0;
            let startBatching = true;
            const countOfBatches = Math.ceil((toBlockNum - fromBlockNum + 1) / this.batchSize);
            // If confirmations are enabled then first batch is with confirmed events
            // only run if this is not the first time running.
            if (this.confirmator && this.tracker.getLastFetchedBlock()[0]) {
                // TODO: This does not respects the from-to block range
                const confirmedEvents = yield __await(this.confirmator.runConfirmationsRoutine(currentBlock, toBlockNum));
                batchOffset += 1;
                this.logger.verbose('Emitting Batch with Confirmed events');
                yield yield __await({
                    stepsComplete: batch + 1,
                    totalSteps: countOfBatches + batchOffset,
                    stepFromBlock: this.tracker.getLastFetchedBlock()[0] - this.confirmations,
                    stepToBlock: this.tracker.getLastFetchedBlock()[0],
                    events: confirmedEvents
                });
                if (confirmedEvents.length > 0) {
                    const lastEvent = confirmedEvents[confirmedEvents.length - 1];
                    this.tracker.setLastProcessedBlockIfHigher(lastEvent.blockNumber, lastEvent.blockHash);
                }
                this.emit(definitions_1.PROGRESS_EVENT_NAME, {
                    stepsComplete: batch + 1,
                    totalSteps: countOfBatches + batchOffset,
                    stepFromBlock: this.tracker.getLastFetchedBlock()[0] - this.confirmations,
                    stepToBlock: this.tracker.getLastFetchedBlock()[0]
                }).catch(e => this.emit('error', e));
            }
            this.logger.verbose(`Will process ${countOfBatches} batches`);
            for (; batch < countOfBatches; batch++) {
                // The first batch starts at fromBlock sharp, but the others has to start +1 to avoid reprocessing of the bordering block
                let batchFromBlock;
                if (startBatching) {
                    batchFromBlock = fromBlockNum;
                    startBatching = false;
                }
                else {
                    batchFromBlock = fromBlockNum + (batch * this.batchSize);
                }
                const batchToBlock = Math.min(batchFromBlock + this.batchSize - 1, toBlockNum);
                if (countOfBatches > 1) {
                    this.logger.verbose(`Processing batch no. ${batch + 1}: from block ${batchFromBlock} to ${batchToBlock}`);
                }
                const batchToBlockHeader = yield __await(this.eth.getBlock(batchToBlock));
                const events = (yield __await(this.contract.getPastEvents('allEvents', Object.assign({ fromBlock: batchFromBlock, toBlock: batchToBlock }, options))));
                this.logger.debug('Received events for the batch: ', events);
                const confirmedEvents = yield __await(this.processEvents(events, currentBlock.number));
                this.tracker.setLastFetchedBlock(batchToBlockHeader.number, batchToBlockHeader.hash);
                yield yield __await({
                    stepsComplete: batch + batchOffset + 1,
                    totalSteps: countOfBatches + batchOffset,
                    stepFromBlock: batchFromBlock,
                    stepToBlock: batchToBlock,
                    events: confirmedEvents
                });
                if (confirmedEvents.length > 0) {
                    const lastEvent = confirmedEvents[confirmedEvents.length - 1];
                    this.tracker.setLastProcessedBlockIfHigher(lastEvent.blockNumber, lastEvent.blockHash);
                }
                this.emit(definitions_1.PROGRESS_EVENT_NAME, {
                    stepsComplete: batch + batchOffset + 1,
                    totalSteps: countOfBatches + batchOffset,
                    stepFromBlock: batchFromBlock,
                    stepToBlock: batchToBlock
                }).catch(e => this.emit('error', e));
            }
            const [secondsLapsed] = process.hrtime(startTime);
            this.logger.info(`Finished fetching events in ${secondsLapsed}s`);
        });
    }
    setConfirmator(confirmator) {
        this.confirmator = confirmator;
    }
    isReorg() {
        return __awaiter(this, void 0, void 0, function* () {
            const [lastFetchedBlockNumber, lastFetchedBlockHash] = this.tracker.getLastFetchedBlock();
            if (!lastFetchedBlockNumber) {
                return false; // Nothing was fetched yet, no point in continue
            }
            const actualLastFetchedBlock = yield this.eth.getBlock(lastFetchedBlockNumber);
            if (actualLastFetchedBlock.hash === lastFetchedBlockHash) {
                return false; // No reorg detected
            }
            this.logger.warn(`Reorg happening! Old hash: ${lastFetchedBlockHash}; New hash: ${actualLastFetchedBlock.hash}`);
            const [lastProcessedBlockNumber, lastProcessedBlockHash] = this.tracker.getLastProcessedBlock();
            // If is undefined than nothing was yet processed and the reorg is not affecting our service
            // as we are still awaiting for enough confirmations
            if (lastProcessedBlockNumber) {
                const actualLastProcessedBlock = yield this.eth.getBlock(lastProcessedBlockNumber);
                // The reorg is happening outside our confirmation range.
                // We can't do anything about it except notify the consumer.
                if (actualLastProcessedBlock.hash !== lastProcessedBlockHash) {
                    this.logger.error(`Reorg out of confirmation range! Old hash: ${lastProcessedBlockHash}; New hash: ${actualLastProcessedBlock.hash}`);
                    this.emit(definitions_1.REORG_OUT_OF_RANGE_EVENT_NAME, lastProcessedBlockNumber).catch(e => this.emit('error', e));
                }
            }
            this.emit(definitions_1.REORG_EVENT_NAME).catch(e => this.emit('error', e));
            return true;
        });
    }
    handleReorg(currentBlock) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            const [lastProcessedBlockNumber] = this.tracker.getLastProcessedBlock();
            const newEvents = yield this.contract.getPastEvents('allEvents', {
                fromBlock: (lastProcessedBlockNumber ? lastProcessedBlockNumber + 1 : false) || this.startingBlock,
                toBlock: currentBlock.number
            });
            yield ((_a = this.confirmator) === null || _a === void 0 ? void 0 : _a.checkDroppedTransactions(newEvents));
            // Remove all events that currently awaiting confirmation
            yield event_model_1.Event.destroy({ where: { contractAddress: this.contract.address } });
            const confirmedEvents = yield this.processEvents(newEvents, currentBlock.number);
            this.tracker.setLastFetchedBlock(currentBlock.number, currentBlock.hash);
            return confirmedEvents;
        });
    }
    serializeEvent(data) {
        this.logger.debug(`New ${data.event} event to be confirmed. Block ${data.blockNumber}, transaction ${data.transactionHash}`);
        return {
            blockNumber: data.blockNumber,
            transactionHash: data.transactionHash,
            contractAddress: this.contract.address,
            event: data.event,
            targetConfirmation: this.confirmations,
            content: JSON.stringify(data)
        };
    }
    get name() {
        return this.contract.name;
    }
    get blockTracker() {
        return this.tracker;
    }
}
exports.ManualEventsEmitter = ManualEventsEmitter;
