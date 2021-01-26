"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !exports.hasOwnProperty(p)) __createBinding(exports, m, p);
};
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
exports.Web3Events = void 0;
const definitions_1 = require("./definitions");
const new_block_emitter_1 = require("./new-block-emitter");
const events_1 = require("./events");
const event_model_1 = require("./event.model");
const contract_1 = require("./contract");
const utils_1 = require("./utils");
const block_tracker_1 = require("./block-tracker");
const group_1 = require("./group");
var contract_2 = require("./contract");
Object.defineProperty(exports, "Contract", { enumerable: true, get: function () { return contract_2.Contract; } });
__exportStar(require("./definitions"), exports);
__exportStar(require("./contract"), exports);
__exportStar(require("./new-block-emitter"), exports);
__exportStar(require("./block-tracker"), exports);
__exportStar(require("./event.model"), exports);
var events_2 = require("./events");
Object.defineProperty(exports, "ManualEventsEmitter", { enumerable: true, get: function () { return events_2.ManualEventsEmitter; } });
var confirmator_1 = require("./confirmator");
Object.defineProperty(exports, "ModelConfirmator", { enumerable: true, get: function () { return confirmator_1.ModelConfirmator; } });
var utils_2 = require("./utils");
Object.defineProperty(exports, "AutoEventsEmitter", { enumerable: true, get: function () { return utils_2.AutoEventsEmitter; } });
/**
 * Main entry point class to the library.
 * It provides "glue" for all the components making it easier to create EventsEmitters.
 */
class Web3Events {
    /**
     * @param eth Web3 Eth instance defining connection to blockchain
     * @param store Optional global store where all the persistent information of EventsEmitters will be placed
     * @param logger Optional logger instance. If not passed then 'debug' package is used instead for logging
     * @param defaultNewBlockEmitter Optional custom configuration or instance of default NewBlockEmitter
     */
    constructor(eth, { store, logger, defaultNewBlockEmitter } = {}) {
        var _a;
        if (!Web3Events.initialized) {
            throw new Error('You have to run Web3Events.init() before creating instance!');
        }
        if (!eth.currentProvider) {
            throw new Error('The passed Eth instance does not have a instantiated provider!');
        }
        // @ts-ignore
        contract_1.Contract.setProvider(eth.currentProvider);
        this.logger = logger !== null && logger !== void 0 ? logger : utils_1.loggingFactory('web3events');
        this.eth = eth;
        this.store = store;
        this.contractsUsed = new Set();
        // Default newBlockEmitter
        this.defaultNBEmitter = (_a = this.resolveNewBlockEmitter(defaultNewBlockEmitter)) !== null && _a !== void 0 ? _a : new new_block_emitter_1.PollingNewBlockEmitter(eth);
    }
    static init(sequelize) {
        return __awaiter(this, void 0, void 0, function* () {
            this.initialized = true;
            if (!sequelize.isDefined(definitions_1.EVENTS_MODEL_TABLE_NAME)) {
                event_model_1.Event.init(event_model_1.EventModelDefinition, {
                    sequelize,
                    freezeTableName: true,
                    tableName: definitions_1.EVENTS_MODEL_TABLE_NAME,
                    modelName: definitions_1.EVENTS_MODEL_TABLE_NAME
                });
                // TODO: Add migrations
                yield event_model_1.Event.sync();
            }
        });
    }
    static get isInitialized() {
        return Web3Events.initialized;
    }
    /**
     * Creates a new AutoEventsEmitter for given Contract.
     *
     * Generally there should be only one emitter per Contract. If you want to use multiple instances for Contract
     * then you have to provide custom instances of BlockTracker as the global store would have otherwise collisions.
     *
     * @param contract Instance of Contract that defines where the events will come from
     * @param options For all options see EventsEmitterCreationOptions. Bellow is basic listing.
     * @param options.blockTracker Custom instance of BlockTracker
     * @param options.newBlockEmitter Custom instance of NewBlockEmitter
     * @param options.serialListeners Defines if the listeners should be processed serially.
     * @param options.serialProcessing Defines if the events should be kept in order and processed serially.
     * @param options.autoStart Default is true. Defines if the EventsEmitter should automatically start listening on events when an events listener for events is attached.
     */
    createEventsEmitter(contract, options) {
        var _a, _b, _c, _d;
        if (this.contractsUsed.has(contract.name)) {
            if (!(options === null || options === void 0 ? void 0 : options.blockTracker)) {
                throw new Error('This contract is already listened on! New Emitter would use already utilized Store scope. Use your own BlockTracker if you want to continue!');
            }
            else {
                this.logger.warn(`Contract with name ${contract.name} already has events emitter!`);
            }
        }
        this.contractsUsed.add(contract.name);
        if (!this.store && !(options === null || options === void 0 ? void 0 : options.blockTracker)) {
            throw new Error('You have to either set global "store" object in constructor or pass BlockTracker instance!');
        }
        const blockTracker = (_a = options === null || options === void 0 ? void 0 : options.blockTracker) !== null && _a !== void 0 ? _a : new block_tracker_1.BlockTracker(utils_1.scopeObject(this.store, contract.name));
        const newBlockEmitter = (_b = this.resolveNewBlockEmitter(options === null || options === void 0 ? void 0 : options.newBlockEmitter)) !== null && _b !== void 0 ? _b : this.defaultNBEmitter;
        const manualEmitter = new events_1.ManualEventsEmitter(this.eth, contract, blockTracker, (_c = options === null || options === void 0 ? void 0 : options.logger) !== null && _c !== void 0 ? _c : utils_1.initLogger(contract.name, this.logger), options);
        return new utils_1.AutoEventsEmitter(manualEmitter, newBlockEmitter, (_d = options === null || options === void 0 ? void 0 : options.logger) !== null && _d !== void 0 ? _d : utils_1.initLogger(contract.name, this.logger), options);
    }
    /**
     * Method that stops the Event Emitter and removes its Contract from the internally tracked set of used contracts.
     * @param eventsEmitter
     */
    removeEventsEmitter(eventsEmitter) {
        this.contractsUsed.delete(eventsEmitter.name);
        eventsEmitter.stop();
    }
    /**
     * Method that takes several EventsEmitters and group them under one emitter.
     *
     * The EventsEmitters must not have any newEvents listeners! Nor they can be attached later on!
     *
     * Except of some logical grouping of Emitters, this is mainly meant for Contracts that have order depending evaluation.
     * If that is the case use the flag `options.orderedProcessing` with most probably `options.serialProcessing` flag.
     *
     * @param eventsEmitters
     * @param options For all options see CreateGroupEmitterOptions. Bellow is basic listing.
     * @param options.orderedProcessing Defines if the events from emitters ordered using blockNumber, transactionIndex and logIndex to determine order of the events.
     * @param options.newBlockEmitter Custom instance of NewBlockEmitter
     * @param options.serialListeners Defines if the listeners should be processed serially.
     * @param options.serialProcessing Defines if the events should be kept in order and processed serially.
     * @param options.autoStart Default is true. Defines if the EventsEmitter should automatically start listening on events when an events listener for events is attached.
     */
    groupEventsEmitters(eventsEmitters, options) {
        var _a, _b;
        options = options !== null && options !== void 0 ? options : {};
        options.logger = (_a = options === null || options === void 0 ? void 0 : options.logger) !== null && _a !== void 0 ? _a : this.logger;
        const newBlockEmitter = (_b = this.resolveNewBlockEmitter(options === null || options === void 0 ? void 0 : options.newBlockEmitter)) !== null && _b !== void 0 ? _b : this.defaultNBEmitter;
        const groupEmitter = new group_1.GroupEventsEmitter(this.eth, eventsEmitters, options);
        return new utils_1.AutoEventsEmitter(groupEmitter, newBlockEmitter, utils_1.initLogger(groupEmitter.name, options.logger), options);
    }
    get defaultNewBlockEmitter() {
        return this.defaultNBEmitter;
    }
    resolveNewBlockEmitter(value) {
        if (!value) {
            return;
        }
        if (value instanceof new_block_emitter_1.PollingNewBlockEmitter || value instanceof new_block_emitter_1.ListeningNewBlockEmitter) {
            return value;
        }
        value = value;
        if ((value === null || value === void 0 ? void 0 : value.polling) === false) {
            return new new_block_emitter_1.ListeningNewBlockEmitter(this.eth);
        }
        else {
            return new new_block_emitter_1.PollingNewBlockEmitter(this.eth, value === null || value === void 0 ? void 0 : value.pollingInterval);
        }
    }
}
exports.Web3Events = Web3Events;
Web3Events.initialized = false;
