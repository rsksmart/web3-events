import type { BlockHeader, Eth } from 'web3-eth';
import { EventLog } from 'web3-core';
import type { Confirmator, ConfirmatorOptions } from './definitions';
import type { BlockTracker } from './block-tracker';
import { ManualEventsEmitter } from './events';
/**
 * Class that handles confirmations of blocks.
 * Also gives support to detect what events were dropped.
 */
export declare class ModelConfirmator<T extends EventLog> implements Confirmator<T> {
    private readonly emitter;
    private readonly eth;
    private readonly contractAddress;
    private readonly blockTracker;
    private readonly logger;
    /**
     * Defines how many blocks will be a block kept in DB after its confirmations.
     * This is in order to allow polling users to have enough time to see that the block was confirmed.
     */
    private readonly waitingBlockCount;
    constructor(emitter: ManualEventsEmitter<T>, eth: Eth, contractAddress: string, blockTracker: BlockTracker, { logger, waitingBlockCount }?: ConfirmatorOptions);
    /**
     * Retrieves confirmed events and emits them.
     *
     * Before emitting it validates that the Event is still valid on blockchain using the transaction's receipt.
     *
     * @param currentBlock
     * @param toBlockNum
     */
    runConfirmationsRoutine(currentBlock: BlockHeader, toBlockNum?: number): Promise<T[]>;
    private eventHasValidReceipt;
    private emitNewConfirmationsClosure;
    private confirmEvent;
    /**
     * This should be called when handling of reorg inside of confirmation range.
     * The re-fetched transactions from blockchain are passed here and they are compared with the current events that awaits confirmation.
     * If some transaction is not present in the new transactions that it is pronounced as a dropped transaction and emitted as such.
     *
     * @param newEvents - Re-fetched events inside of the confirmation range from blockchain.
     * @emits INVALID_CONFIRMATION_EVENT_NAME - with transactionHash of the dropped transaction.
     */
    checkDroppedTransactions(newEvents: EventLog[]): Promise<void>;
}
