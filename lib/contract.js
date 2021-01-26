"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Contract = void 0;
const web3_eth_contract_1 = __importDefault(require("web3-eth-contract"));
class Contract extends web3_eth_contract_1.default {
    constructor(abi, address, name) {
        super(abi, address);
        this.abi = abi;
        this.address = address.toLowerCase();
        this.name = name;
    }
}
exports.Contract = Contract;
