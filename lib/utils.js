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
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __await = (this && this.__await) || function (v) { return this instanceof __await ? (this.v = v, this) : new __await(v); }
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
exports.AutoEventsEmitter = exports.AutoStartStopEventEmitter = exports.cumulateIterations = exports.scopeObject = exports.errorHandler = exports.setDifference = exports.split = exports.asyncSplit = exports.passTroughEvents = exports.hashTopics = exports.initLogger = exports.loggingFactory = void 0;
const emittery_1 = __importDefault(require("emittery"));
const debug_1 = __importDefault(require("debug"));
const web3_utils_1 = require("web3-utils");
const util_1 = require("util");
const definitions_1 = require("./definitions");
function loggingFactory(name) {
    const log = debug_1.default(name);
    return {
        debug(message, ...meta) {
            log(`DEBUG: ${message}` + (meta.length ? '\n' + meta.map(e => util_1.inspect(e)).join('\n') : ''));
        },
        verbose(message, ...meta) {
            log(`VERBOSE: ${message}` + (meta.length ? '\n' + meta.map(e => util_1.inspect(e)).join('\n') : ''));
        },
        info(message, ...meta) {
            log(`INFO: ${message}` + (meta.length ? '\n' + meta.map(e => util_1.inspect(e)).join('\n') : ''));
        },
        warn(message, ...meta) {
            log(`WARN: ${message}` + (meta.length ? '\n' + meta.map(e => util_1.inspect(e)).join('\n') : ''));
        },
        error(message, ...meta) {
            log(`ERROR: ${message}` + (meta.length ? '\n' + meta.map(e => util_1.inspect(e)).join('\n') : ''));
            if (message.stack) {
                log(message.stack);
            }
        },
        extend(extendedName) {
            return loggingFactory(`${name}:${extendedName}`);
        }
    };
}
exports.loggingFactory = loggingFactory;
function initLogger(name, baseLogger) {
    if (baseLogger) {
        if (baseLogger.extend) {
            return baseLogger.extend(name);
        }
        else {
            return baseLogger;
        }
    }
    else {
        return loggingFactory(name);
    }
}
exports.initLogger = initLogger;
function hashTopics(topics) {
    if (!topics)
        return [];
    return topics.map((e) => {
        if (Array.isArray(e)) {
            return e.map(web3_utils_1.keccak256);
        }
        else {
            return web3_utils_1.keccak256(e);
        }
    });
}
exports.hashTopics = hashTopics;
/**
 * Subscribe to all events on "from" emitter and re-emit them in "to" emitter.
 *
 * @param from
 * @param to
 * @param events
 * @param name If specified than the data coming from "from" emitter are wrapped in object: {name, data}
 */
function passTroughEvents(from, to, events, name) {
    for (const event of events) {
        from.on(event, EventLog => {
            if (name) {
                to.emit(event, { name, data: EventLog });
            }
            else {
                to.emit(event, EventLog);
            }
        });
    }
}
exports.passTroughEvents = passTroughEvents;
/**
 * Function that will split array into two groups based on callback that returns Promise.
 *
 * @param arr
 * @param callback
 * @return [success, failure] array where first are positives based on callback and second are negatives
 */
function asyncSplit(arr, callback) {
    return __awaiter(this, void 0, void 0, function* () {
        const splitArray = yield Promise.all(arr.map((item) => __awaiter(this, void 0, void 0, function* () { return yield callback(item); })));
        return arr.reduce(([pass, fail], elem, currentIndex) => {
            return splitArray[currentIndex] ? [[...pass, elem], fail] : [pass, [...fail, elem]];
        }, [[], []]);
    });
}
exports.asyncSplit = asyncSplit;
/**
 * Utility function that will split array into two groups based on sync callback.
 * @param array
 * @param isValid
 * @return [success, failure] array where first are positives based on callback and second are negatives
 */
function split(array, isValid) {
    return array.reduce(([pass, fail], elem) => {
        return isValid(elem) ? [[...pass, elem], fail] : [pass, [...fail, elem]];
    }, [[], []]);
}
exports.split = split;
/**
 * Takes Sets A and B and create a difference of those, which results in a subset of A, where
 * elements from set B are removed.
 * @param setA
 * @param setB
 */
function setDifference(setA, setB) {
    const _difference = new Set(setA);
    for (const elem of setB) {
        _difference.delete(elem);
    }
    return _difference;
}
exports.setDifference = setDifference;
/**
 * General handler closure function mainly for Event Emitters, which in case of rejected promise logs the rejection
 * using given logger.
 *
 * @param fn
 * @param logger
 */
function errorHandler(fn, logger) {
    return (...args) => {
        return fn(...args).catch(err => logger.error(err));
    };
}
exports.errorHandler = errorHandler;
/**
 * Function that wraps obj in Proxy that prefix all the object's keys access with given scope
 * @param obj
 * @param scope
 */
function scopeObject(obj, scope) {
    return new Proxy(obj, {
        get(target, name) {
            if (typeof name === 'symbol') {
                throw new Error('Symbols are not supported by scopeObject');
            }
            return Reflect.get(target, `${scope}.${name}`);
        },
        set(target, name, value) {
            if (typeof name === 'symbol') {
                throw new Error('Symbols are not supported by scopeObject');
            }
            target[`${scope}.${name}`] = value;
            return true;
        },
        deleteProperty(target, name) {
            if (typeof name === 'symbol') {
                throw new Error('Symbols are not supported by scopeObject');
            }
            delete target[`${scope}.${name}`];
            return true;
        }
    });
}
exports.scopeObject = scopeObject;
function cumulateIterations(iterators, bufferAllIteration = false) {
    return __awaiter(this, void 0, void 0, function* () {
        let iterating;
        const accumulator = [];
        do {
            iterating = false;
            // This fetches one batch for each emitter
            for (const iterator of iterators) {
                const iteratorResult = yield iterator.next();
                iterating = iterating || !iteratorResult.done;
                if (iteratorResult.value) {
                    const batch = iteratorResult.value;
                    accumulator.push(batch);
                }
            }
            // We go through all batches only when asked
            if (!bufferAllIteration) {
                break;
            }
        } while (iterating);
        return [iterating, accumulator];
    });
}
exports.cumulateIterations = cumulateIterations;
/**
 * Abstract EventEmitter that automatically start (what ever task defined in abstract start() method) when first listener is
 * attached and similarly stops (what ever task defined in abstract stop() method) when last listener is removed.
 */
class AutoStartStopEventEmitter extends emittery_1.default.Typed {
    constructor(logger, triggerEventName, autoStart = true) {
        super();
        this.isStarted = false;
        this.logger = logger;
        this.triggerEventName = triggerEventName;
        if (autoStart) {
            // TODO: Awaiting resolution of https://github.com/sindresorhus/emittery/issues/63
            // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
            // @ts-ignore
            this.on(emittery_1.default.listenerAdded, ({ eventName }) => {
                if (eventName === this.triggerEventName && !this.isStarted) {
                    this.logger.verbose('Listener attached, starting processing events.');
                    this.start();
                    this.isStarted = true;
                }
            });
            // TODO: Awaiting resolution of https://github.com/sindresorhus/emittery/issues/63
            // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
            // @ts-ignore
            this.on(emittery_1.default.listenerRemoved, ({ eventName }) => {
                if (this.listenerCount(this.triggerEventName) === 0) {
                    this.logger.verbose('Listener removing, stopping processing events.');
                    this.stop();
                    this.isStarted = false;
                }
            });
        }
    }
}
exports.AutoStartStopEventEmitter = AutoStartStopEventEmitter;
/**
 * Utility class that wraps any EventsFetcher and automatically trigger fetching of events which are then emitted
 * using `newEvent` event.
 *
 * Fetching is triggered using the NewBlockEmitter and is therefore up to the user
 * to chose what new-block strategy will employ.
 */
class AutoEventsEmitter extends AutoStartStopEventEmitter {
    constructor(fetcher, newBlockEmitter, baseLogger, options) {
        super(initLogger('', baseLogger), definitions_1.NEW_EVENT_EVENT_NAME, options === null || options === void 0 ? void 0 : options.autoStart);
        this.eventsFetcher = fetcher;
        this.newBlockEmitter = newBlockEmitter;
        this.serialListeners = options === null || options === void 0 ? void 0 : options.serialListeners;
        this.serialProcessing = options === null || options === void 0 ? void 0 : options.serialProcessing;
        passTroughEvents(this.eventsFetcher, this, [
            'error',
            definitions_1.REORG_EVENT_NAME,
            definitions_1.REORG_OUT_OF_RANGE_EVENT_NAME,
            definitions_1.INVALID_CONFIRMATION_EVENT_NAME,
            definitions_1.NEW_CONFIRMATION_EVENT_NAME,
            definitions_1.PROGRESS_EVENT_NAME
        ]);
        // @ts-ignore
        this.newBlockEmitter.on('error', (e) => this.emit('error', e));
    }
    emitEvents(events) {
        return __awaiter(this, void 0, void 0, function* () {
            const emittingFnc = this.serialListeners ? this.emitSerial.bind(this) : this.emit.bind(this);
            for (const data of events) {
                this.logger.debug('Emitting event', data);
                // Will await for all the listeners to process the event before moving forward
                if (this.serialProcessing) {
                    try {
                        yield emittingFnc(definitions_1.NEW_EVENT_EVENT_NAME, data);
                    }
                    catch (e) {
                        // @ts-ignore
                        this.emit('error', e);
                    }
                }
                else { // Does not await and just move on
                    emittingFnc(definitions_1.NEW_EVENT_EVENT_NAME, data).catch(e => this.emit('error', e));
                }
            }
        });
    }
    convertIteratorToEmitter(iter) {
        var iter_1, iter_1_1;
        var e_1, _a;
        return __awaiter(this, void 0, void 0, function* () {
            try {
                for (iter_1 = __asyncValues(iter); iter_1_1 = yield iter_1.next(), !iter_1_1.done;) {
                    const batch = iter_1_1.value;
                    yield this.emitEvents(batch.events);
                }
            }
            catch (e_1_1) { e_1 = { error: e_1_1 }; }
            finally {
                try {
                    if (iter_1_1 && !iter_1_1.done && (_a = iter_1.return)) yield _a.call(iter_1);
                }
                finally { if (e_1) throw e_1.error; }
            }
        });
    }
    poll(currentBlock) {
        return __awaiter(this, void 0, void 0, function* () {
            this.logger.verbose(`Received new block number ${currentBlock.number}`);
            try {
                yield this.convertIteratorToEmitter(this.fetch({ currentBlock }));
            }
            catch (e) {
                this.logger.error('Error in the processing loop!');
                this.logger.error(e);
                this.emit('error', e);
            }
        });
    }
    fetch(options) {
        return __asyncGenerator(this, arguments, function* fetch_1() {
            yield __await(yield* __asyncDelegator(__asyncValues(yield __await(this.eventsFetcher.fetch(options)))));
        });
    }
    start() {
        this.logger.verbose('Starting listening on new blocks for polling new events');
        this.pollingUnsubscribe =
            this.newBlockEmitter.on(definitions_1.NEW_BLOCK_EVENT_NAME, errorHandler(this.poll.bind(this), this.logger));
    }
    stop() {
        this.logger.verbose('Finishing listening on new blocks for polling new events');
        if (this.pollingUnsubscribe) {
            this.pollingUnsubscribe();
        }
    }
    get name() {
        return this.eventsFetcher.name;
    }
    get batchSize() {
        return this.eventsFetcher.batchSize;
    }
    get confirmations() {
        return this.eventsFetcher.confirmations;
    }
    get blockTracker() {
        return this.eventsFetcher.blockTracker;
    }
}
exports.AutoEventsEmitter = AutoEventsEmitter;
