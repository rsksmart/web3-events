import { AbiItem } from 'web3-utils';
import Web3Contract from 'web3-eth-contract';
export declare class Contract extends Web3Contract {
    readonly abi: AbiItem[];
    readonly address: string;
    readonly name: string;
    constructor(abi: AbiItem[], address: string, name: string);
}
