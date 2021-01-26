import { Eth } from 'web3-eth';
import Emittery from 'emittery';
import { EventLog } from 'web3-core';
import { Batch, EventsEmitterEmptyEvents, GroupEmitterOptions, EventsFetcher, ManualEventsEmitterEventsNames, FetchOptions, WrapWithName } from './definitions';
import { BlockTracker } from './block-tracker';
/**
 * Function that for given iterators that emits Batch (eq. EventsEmitters.fetch()), will fetch Batches for each
 * iteration, orders them and emit it in single batch.
 *
 * @param emittersIterators
 * @param bufferAllBatches Flag that will fetch all emitter's events and emit them in one Batch. Should not be used for big data!
 */
export declare function fetchBatches<E extends EventLog>(emittersIterators: AsyncIterableIterator<Batch<E>>[], bufferAllBatches?: boolean): AsyncIterableIterator<Batch<E>>;
/**
 * EventsFetcher implementation that takes other Emitters and group then under one Emitter.
 * The Emitters have to have same `batchSize`, `confirmations` and must not have any `newEvent` listeners (in `AutoEventsEmitter` case).
 *
 * Also supports ordering of events across the emitters based on the blockchain's blockNumber, transactionIndex and logIndex values.
 *
 * It re-emits events from the Emitters, but the data of the events are wrapped in object: { name: string, data: any}
 * Where `name` is the name of the Emitter and that `data` is data passed into the `emit` function.
 */
export declare class GroupEventsEmitter<E extends EventLog> extends Emittery.Typed<WrapWithName<ManualEventsEmitterEventsNames>, EventsEmitterEmptyEvents> implements EventsFetcher<E> {
    private readonly emitters;
    private readonly orderedProcessing?;
    private readonly eth;
    private readonly semaphore;
    private readonly logger;
    private readonly groupName;
    constructor(eth: Eth, emitters: EventsFetcher<any>[], options?: GroupEmitterOptions);
    fetch(options?: FetchOptions): AsyncIterableIterator<Batch<E>>;
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
    private findSyncPoint;
    get name(): string;
    get blockTracker(): BlockTracker;
    /**
     * All Emitters has to have the same batchSize so we can return just the first one
     */
    get batchSize(): number;
    /**
     * All Emitters has to have the same confirmations so we can return just the first one
     */
    get confirmations(): number;
}
