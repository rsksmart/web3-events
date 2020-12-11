import { AbiItem } from 'web3-utils'
import Web3Contract from 'web3-eth-contract'

export class Contract extends Web3Contract {
  public readonly abi: AbiItem[]
  public readonly address: string
  public readonly name: string

  constructor (abi: AbiItem[], address: string, name: string) {
    super(abi, address)
    this.abi = abi
    this.address = address.toLowerCase()
    this.name = name
  }
}
