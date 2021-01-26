import type { Eth } from 'web3-eth';
import { Sequelize } from 'sequelize';
import { EventLog } from 'web3-core';
import { EventsEmitterCreationOptions, Logger, NewBlockEmitter, NewBlockEmitterOptions, CreateGroupEmitterOptions, GroupEventsEmitterEventsName } from './definitions';
import { Contract } from './contract';
import { AutoEventsEmitter } from './utils';
export { Contract } from './contract';
export * from './definitions';
export * from './contract';
export * from './new-block-emitter';
export * from './block-tracker';
export * from './event.model';
export { ManualEventsEmitter } from './events';
export { ModelConfirmator } from './confirmator';
export { AutoEventsEmitter } from './utils';
export interface Web3EventsOptions {
    logger?: Logger;
    defaultNewBlockEmitter?: NewBlockEmitterOptions | NewBlockEmitter;
    store?: Record<string, any>;
}
/**
 * Main entry point class to the library.
 * It provides "glue" for all the components making it easier to create EventsEmitters.
 */
export declare class Web3Events {
    private readonly logger;
    private readonly eth;
    private readonly defaultNBEmitter;
    private readonly store;
    private readonly contractsUsed;
    private static initialized;
    /**
     * @param eth Web3 Eth instance defining connection to blockchain
     * @param store Optional global store where all the persistent information of EventsEmitters will be placed
     * @param logger Optional logger instance. If not passed then 'debug' package is used instead for logging
     * @param defaultNewBlockEmitter Optional custom configuration or instance of default NewBlockEmitter
     */
    constructor(eth: Eth, { store, logger, defaultNewBlockEmitter }?: Web3EventsOptions);
    static init(sequelize: Sequelize): Promise<void>;
    static get isInitialized(): boolean;
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
    createEventsEmitter<Events extends EventLog>(contract: Contract, options?: EventsEmitterCreationOptions): AutoEventsEmitter<Events>;
    /**
     * Method that stops the Event Emitter and removes its Contract from the internally tracked set of used contracts.
     * @param eventsEmitter
     */
    removeEventsEmitter(eventsEmitter: AutoEventsEmitter<any>): void;
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
    groupEventsEmitters<Events extends EventLog>(eventsEmitters: AutoEventsEmitter<any>[], options?: CreateGroupEmitterOptions): AutoEventsEmitter<Events, GroupEventsEmitterEventsName<Events>>;
    get defaultNewBlockEmitter(): NewBlockEmitter;
    private resolveNewBlockEmitter;
}
