"use strict";
var __await = (this && this.__await) || function (v) { return this instanceof __await ? (this.v = v, this) : new __await(v); }
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroupEventsEmitter = exports.fetchBatches = void 0;
const async_sema_1 = require("async-sema");
const emittery_1 = __importDefault(require("emittery"));
const definitions_1 = require("./definitions");
const utils_1 = require("./utils");
const index_1 = require("./index");
function compareEvents(event1, event2) {
    // First by block number
    if (event1.blockNumber !== event2.blockNumber)
        return event1.blockNumber - event2.blockNumber;
    // Then by transaction index
    if (event1.transactionIndex !== event2.transactionIndex)
        return event1.transactionIndex - event2.transactionIndex;
    return event1.logIndex - event2.logIndex;
}
/**
 * Function that for given iterators that emits Batch (eq. EventsEmitters.fetch()), will fetch Batches for each
 * iteration, orders them and emit it in single batch.
 *
 * @param emittersIterators
 * @param bufferAllBatches Flag that will fetch all emitter's events and emit them in one Batch. Should not be used for big data!
 */
function fetchBatches(emittersIterators, bufferAllBatches = false) {
    return __asyncGenerator(this, arguments, function* fetchBatches_1() {
        while (true) {
            const [stillIterating, batches] = yield __await(utils_1.cumulateIterations(emittersIterators, bufferAllBatches)
            // With bufferAllBatches we get both stillIterating false, but data in batches
            );
            // With bufferAllBatches we get both stillIterating false, but data in batches
            if ((!stillIterating && !bufferAllBatches) || (bufferAllBatches && !batches.length)) {
                return yield __await(void 0);
            }
            const events = batches
                .map(batch => {
                // Make sure that the batches are in sync, but only if we are not buffering them all
                if (!bufferAllBatches && (batch.stepFromBlock !== batches[0].stepFromBlock || batch.stepToBlock !== batches[0].stepToBlock)) {
                    throw new Error(`Batches are out of sync! From: ${batch.stepFromBlock} != ${batches[0].stepFromBlock} or ${batch.stepToBlock} != ${batches[0].stepToBlock}`);
                }
                return batch.events;
            })
                .reduce((previousValue, currentValue) => {
                previousValue.push(...currentValue);
                return previousValue;
            }, [])
                .sort(compareEvents);
            yield yield __await({
                stepsComplete: batches[0].stepsComplete,
                totalSteps: batches[0].totalSteps,
                stepFromBlock: batches[0].stepFromBlock,
                stepToBlock: batches[0].stepToBlock,
                events
            });
        }
    });
}
exports.fetchBatches = fetchBatches;
/**
 * EventsFetcher implementation that takes other Emitters and group then under one Emitter.
 * The Emitters have to have same `batchSize`, `confirmations` and must not have any `newEvent` listeners (in `AutoEventsEmitter` case).
 *
 * Also supports ordering of events across the emitters based on the blockchain's blockNumber, transactionIndex and logIndex values.
 *
 * It re-emits events from the Emitters, but the data of the events are wrapped in object: { name: string, data: any}
 * Where `name` is the name of the Emitter and that `data` is data passed into the `emit` function.
 */
class GroupEventsEmitter extends emittery_1.default.Typed {
    constructor(eth, emitters, options) {
        var _a;
        super();
        this.eth = eth;
        this.emitters = emitters;
        this.orderedProcessing = options === null || options === void 0 ? void 0 : options.orderedProcessing;
        this.groupName = (_a = options === null || options === void 0 ? void 0 : options.name) !== null && _a !== void 0 ? _a : `Group(${emitters.map(emitter => emitter.name).join(', ')})`;
        this.logger = utils_1.initLogger(this.groupName, options === null || options === void 0 ? void 0 : options.logger);
        this.semaphore = new async_sema_1.Sema(1); // Allow only one caller
        if (!index_1.Web3Events.isInitialized) {
            throw new Error('You have to run Web3Events.init() before creating instance!');
        }
        for (const emitter of emitters) {
            if (emitter.listenerCount(definitions_1.NEW_EVENT_EVENT_NAME) > 0) {
                throw new Error(`Emitter for contract ${emitter.name} has newEvent listeners!`);
            }
            if (emitter.batchSize !== emitters[0].batchSize) {
                throw new Error(`Emitter for contract ${emitter.name} has different batch size! ${emitter.batchSize} != ${emitters[0].batchSize}`);
            }
            if (emitter.confirmations !== emitters[0].confirmations) {
                throw new Error(`Emitter for contract ${emitter.name} has different confirmations! ${emitter.confirmations} != ${emitters[0].confirmations}`);
            }
            // TODO: Awaiting resolution of https://github.com/sindresorhus/emittery/issues/63
            // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
            // @ts-ignore
            emitter.on(emittery_1.default.listenerAdded, ({ eventName }) => {
                if (eventName === definitions_1.NEW_EVENT_EVENT_NAME) {
                    this.logger.error(`newEvent listener was attached to emitter for contract ${emitter.name}! That is not allowed!`);
                    throw new Error('It is not allowed EventsEmitter which was grouped to have newEvent handler!');
                }
            });
            utils_1.passTroughEvents(emitter, this, [
                'error',
                definitions_1.REORG_EVENT_NAME,
                definitions_1.REORG_OUT_OF_RANGE_EVENT_NAME,
                definitions_1.INVALID_CONFIRMATION_EVENT_NAME,
                definitions_1.NEW_CONFIRMATION_EVENT_NAME,
                definitions_1.PROGRESS_EVENT_NAME
            ], emitter.name);
        }
    }
    fetch(options = {}) {
        var _a;
        return __asyncGenerator(this, arguments, function* fetch_1() {
            this.logger.verbose('Acquiring lock for fetch()');
            if (this.semaphore.nrWaiting() > 0) {
                this.logger.warn(`There is multiple fetch() call queued up! Count: ${this.semaphore.nrWaiting()}`);
            }
            yield __await(this.semaphore.acquire());
            this.logger.verbose('Lock acquired for fetch()');
            try {
                options.currentBlock = (_a = options === null || options === void 0 ? void 0 : options.currentBlock) !== null && _a !== void 0 ? _a : yield __await(this.eth.getBlock('latest')
                // Order of events does not matter, lets pass through batches from all the emitters
                // without any limitations / orderings etc.
                );
                // Order of events does not matter, lets pass through batches from all the emitters
                // without any limitations / orderings etc.
                if (!this.orderedProcessing) {
                    this.logger.verbose('Processing without ordering.');
                    for (const emitter of this.emitters) {
                        yield __await(yield* __asyncDelegator(__asyncValues(emitter.fetch(options))));
                    }
                    return yield __await(void 0);
                }
                this.logger.verbose('Processing WITH ordering.');
                const syncPoint = this.findSyncPoint();
                if (syncPoint) {
                    this.logger.verbose(`Emitters out of sync! Syncing to block ${syncPoint}`);
                    const iterators = this.emitters.map(emitter => emitter.fetch(Object.assign(Object.assign({}, options), { toBlockNumber: syncPoint })));
                    // This will yield only one batch with all batches up to the syncPoint grouped into the one batch.
                    // BatchSize is not honored here.
                    yield __await(yield* __asyncDelegator(__asyncValues(fetchBatches(iterators, true))));
                }
                // Normal processing of batches
                this.logger.verbose('Fetching and ordering expected blocks');
                const iterators = this.emitters.map(emitter => emitter.fetch(options));
                yield __await(yield* __asyncDelegator(__asyncValues(fetchBatches(iterators))));
            }
            finally {
                this.semaphore.release();
            }
        });
    }
    /**
     * Search for synchronization point.
     *
     * If the emitters are not in sync (eq. all of them have same lastFetchedBlock), then
     * the sync point is defined as the furthest lastFetchedBlock (eq. highest block number).
     *
     * Undefined is valid value, which means that the emitter has never fetched any events.
     * It can't be returned as sync point, because it is a starting value and if sync is needed then it has to be
     * some "higher" number.
     *
     * If all emitter's lastFetchedBlock are undefined than no emitter yet fetched events and
     * there is no need of syncing.
     *
     * @private
     * @returns false if no need to sync or a number that is the sync point.
     */
    findSyncPoint() {
        let syncNeeded = false;
        let point = this.emitters[0].blockTracker.getLastFetchedBlock()[0];
        for (const emitter of this.emitters) {
            const lastFetchedBlockNumber = emitter.blockTracker.getLastFetchedBlock()[0];
            if (point !== lastFetchedBlockNumber) {
                this.logger.debug(`Emitter ${emitter.name} out of sync (${lastFetchedBlockNumber} !== ${point})`);
                syncNeeded = true;
                if (point === undefined || (lastFetchedBlockNumber !== undefined && point < lastFetchedBlockNumber)) {
                    point = lastFetchedBlockNumber;
                }
            }
        }
        if (syncNeeded) {
            return point;
        }
        return false;
    }
    get name() {
        return this.groupName;
    }
    get blockTracker() {
        throw new Error('GroupEventsEmitter does not support getting its BlockTracker instance!');
    }
    /**
     * All Emitters has to have the same batchSize so we can return just the first one
     */
    get batchSize() {
        return this.emitters[0].batchSize;
    }
    /**
     * All Emitters has to have the same confirmations so we can return just the first one
     */
    get confirmations() {
        return this.emitters[0].confirmations;
    }
}
exports.GroupEventsEmitter = GroupEventsEmitter;
