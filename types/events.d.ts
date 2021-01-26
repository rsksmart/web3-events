import { Sema } from 'async-sema';
import type { BlockHeader, Eth } from 'web3-eth';
import { EventLog } from 'web3-core';
import Emittery from 'emittery';
import { Contract } from './contract';
import { ManualEventsEmitterEventsNames, EventsEmitterEmptyEvents, ManualEventsEmitterOptions, Logger, Batch, EventsFetcher, FetchOptions } from './definitions';
import { ModelConfirmator } from './confirmator';
import type { BlockTracker } from './block-tracker';
/**
 * EventsEmitter implementation where you have to manually call fetch() function to get events.
 * It still supports emitting of all events like AutoEventsEmitter excecept the 'newEvent' with events.
 * It supports block's confirmation, where new events are stored to DB and only after configured number of new
 * blocks are emitted to consumers for further processing.
 */
export declare class ManualEventsEmitter<E extends EventLog> extends Emittery.Typed<ManualEventsEmitterEventsNames, EventsEmitterEmptyEvents> implements EventsFetcher<E> {
    protected readonly tracker: BlockTracker;
    protected readonly contract: Contract;
    protected readonly startingBlock: number;
    protected readonly eventNames?: string[];
    protected readonly eth: Eth;
    protected readonly semaphore: Sema;
    protected readonly topics?: (string[] | string)[];
    protected readonly logger: Logger;
    private confirmator?;
    readonly batchSize: number;
    readonly confirmations: number;
    constructor(eth: Eth, contract: Contract, blockTracker: BlockTracker, baseLogger: Logger, options?: ManualEventsEmitterOptions);
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
    fetch(options?: FetchOptions): AsyncIterableIterator<Batch<E>>;
    /**
     * Method for processing events. It splits the events based on if they need more confirmations.
     *
     * @param events
     * @param currentBlockNumber?
     * @return Return array of events that have enough confirmation
     */
    protected processEvents(events: E[] | E, currentBlockNumber: number): Promise<E[]>;
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
    protected batchFetchAndProcessEvents(fromBlockNum: number, toBlockNum: number, currentBlock: BlockHeader): AsyncIterableIterator<Batch<E>>;
    setConfirmator(confirmator: ModelConfirmator<E>): void;
    protected isReorg(): Promise<boolean>;
    protected handleReorg(currentBlock: BlockHeader): Promise<E[]>;
    private serializeEvent;
    get name(): string;
    get blockTracker(): BlockTracker;
}
