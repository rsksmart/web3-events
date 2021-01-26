import Emittery from 'emittery';
import type { BlockHeader } from 'web3-eth';
import type { EventLog } from 'web3-core';
import type { EventsFetcher, FetchOptions, Logger, ManualEventsEmitterEventsNames, StartStop } from './definitions';
import { AutoEventsEmitterEventsName, AutoEventsEmitterOptions, Batch, EventsEmitterEmptyEvents, NewBlockEmitter } from './definitions';
import { BlockTracker } from './block-tracker';
export declare function loggingFactory(name: string): Logger;
export declare function initLogger(name: string, baseLogger?: Logger): Logger;
export declare function hashTopics(topics?: (string[] | string)[]): (string[] | string)[];
/**
 * Subscribe to all events on "from" emitter and re-emit them in "to" emitter.
 *
 * @param from
 * @param to
 * @param events
 * @param name If specified than the data coming from "from" emitter are wrapped in object: {name, data}
 */
export declare function passTroughEvents(from: Emittery, to: Emittery, events: string[], name?: string): void;
/**
 * Function that will split array into two groups based on callback that returns Promise.
 *
 * @param arr
 * @param callback
 * @return [success, failure] array where first are positives based on callback and second are negatives
 */
export declare function asyncSplit<T>(arr: T[], callback: (elem: T) => Promise<boolean>): Promise<[T[], T[]]>;
/**
 * Utility function that will split array into two groups based on sync callback.
 * @param array
 * @param isValid
 * @return [success, failure] array where first are positives based on callback and second are negatives
 */
export declare function split<T>(array: T[], isValid: (elem: T) => boolean): [T[], T[]];
/**
 * Takes Sets A and B and create a difference of those, which results in a subset of A, where
 * elements from set B are removed.
 * @param setA
 * @param setB
 */
export declare function setDifference<T>(setA: Set<T>, setB: Set<T>): Set<T>;
/**
 * General handler closure function mainly for Event Emitters, which in case of rejected promise logs the rejection
 * using given logger.
 *
 * @param fn
 * @param logger
 */
export declare function errorHandler(fn: (...args: any[]) => Promise<any>, logger: Logger): (...args: any[]) => Promise<any>;
/**
 * Function that wraps obj in Proxy that prefix all the object's keys access with given scope
 * @param obj
 * @param scope
 */
export declare function scopeObject(obj: Record<string, any>, scope: string): Record<string, any>;
export declare function cumulateIterations<E>(iterators: AsyncIterableIterator<E>[], bufferAllIteration?: boolean): Promise<[boolean, E[]]>;
/**
 * Abstract EventEmitter that automatically start (what ever task defined in abstract start() method) when first listener is
 * attached and similarly stops (what ever task defined in abstract stop() method) when last listener is removed.
 */
export declare abstract class AutoStartStopEventEmitter<T, E extends string | symbol = never> extends Emittery.Typed<T, E> implements StartStop {
    /**
     * Name of event that triggers the start/stop actions. Eq. waits there is listeners for this specific event.
     */
    private readonly triggerEventName;
    private isStarted;
    protected logger: Logger;
    protected constructor(logger: Logger, triggerEventName: string, autoStart?: boolean);
    abstract start(): void;
    abstract stop(): void;
}
/**
 * Utility class that wraps any EventsFetcher and automatically trigger fetching of events which are then emitted
 * using `newEvent` event.
 *
 * Fetching is triggered using the NewBlockEmitter and is therefore up to the user
 * to chose what new-block strategy will employ.
 */
export declare class AutoEventsEmitter<E extends EventLog, ValueEvents extends AutoEventsEmitterEventsName<E> = ManualEventsEmitterEventsNames & AutoEventsEmitterEventsName<E>, NonValueEvents extends string | symbol = EventsEmitterEmptyEvents> extends AutoStartStopEventEmitter<ValueEvents & AutoEventsEmitterEventsName<E>, NonValueEvents> implements EventsFetcher<E> {
    private readonly serialListeners?;
    private readonly serialProcessing?;
    private readonly newBlockEmitter;
    private readonly eventsFetcher;
    private pollingUnsubscribe?;
    constructor(fetcher: EventsFetcher<E>, newBlockEmitter: NewBlockEmitter, baseLogger: Logger, options?: AutoEventsEmitterOptions);
    private emitEvents;
    protected convertIteratorToEmitter(iter: AsyncIterableIterator<Batch<E>>): Promise<void>;
    poll(currentBlock: BlockHeader): Promise<void>;
    fetch(options?: FetchOptions): AsyncIterableIterator<Batch<E>>;
    start(): void;
    stop(): void;
    get name(): string;
    get batchSize(): number;
    get confirmations(): number;
    get blockTracker(): BlockTracker;
}
