import type { Eth } from 'web3-eth';
import { AutoStartStopEventEmitter } from './utils';
import { NewBlockEmitter, NewBlockEmitterEvents } from './definitions';
/**
 * EventEmitter that emits event upon new block on the blockchain.
 * Uses polling strategy.
 */
export declare class PollingNewBlockEmitter extends AutoStartStopEventEmitter<NewBlockEmitterEvents> implements NewBlockEmitter {
    private readonly eth;
    private readonly pollingInterval;
    private intervalId?;
    private lastBlockNumber;
    constructor(eth: Eth, pollingInterval?: number);
    private fetchLastBlockNumber;
    start(): void;
    stop(): void;
}
/**
 * EventEmitter that emits event upon new block on the blockchain.
 * Uses listening strategy for 'newBlockHeaders' event.
 */
export declare class ListeningNewBlockEmitter extends AutoStartStopEventEmitter<NewBlockEmitterEvents> implements NewBlockEmitter {
    private readonly eth;
    private subscription?;
    constructor(eth: Eth);
    start(): Promise<void>;
    stop(): void;
}
