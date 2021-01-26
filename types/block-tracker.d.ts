import Emittery from 'emittery';
import { BlockTrackerStore } from './definitions';
/**
 * Simple class for persistence of last processed block in order to not crawl the whole blockchain upon every restart
 * of the server.
 */
export declare class BlockTracker extends Emittery.Typed<never, 'fetchedBlockSet' | 'processedBlockSet'> {
    private readonly store;
    constructor(store: BlockTrackerStore);
    setLastFetchedBlock(blockNumber: number, blockHash: string): void;
    getLastFetchedBlock(): [number?, string?];
    setLastProcessedBlockIfHigher(blockNumber: number, blockHash: string): void;
    getLastProcessedBlock(): [number?, string?];
}
