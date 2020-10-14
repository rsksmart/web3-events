# Web3 Events

[![CircleCI](https://flat.badgen.net/circleci/github/rsksmart/web3-events/master)](https://circleci.com/gh/rsksmart/web3-events/)
[![Dependency Status](https://david-dm.org/rsksmart/web3-events.svg?style=flat-square)](https://david-dm.org/rsksmart/web3-events)
[![](https://img.shields.io/badge/made%20by-IOVLabs-blue.svg?style=flat-square)](http://iovlabs.org)
[![standard-readme compliant](https://img.shields.io/badge/standard--readme-OK-brightgreen.svg?style=flat-square)](https://github.com/RichardLitt/standard-readme)
[![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat-square)](https://github.com/feross/standard)
[![Managed by tAsEgir](https://img.shields.io/badge/%20managed%20by-tasegir-brightgreen?style=flat-square)](https://github.com/auhau/tasegir)
![](https://img.shields.io/badge/npm-%3E%3D6.0.0-orange.svg?style=flat-square)
![](https://img.shields.io/badge/Node.js-%3E%3D10.0.0-orange.svg?style=flat-square)

> Library for robust handling of web3 events listening and basic blockchain reorganisations.

## Table of Contents

- [Usage](#usage)
- [Contribute](#contribute)
- [License](#license)

## Usage

```ts
import { Web3Events, Contract } from 'web3-events'
import { Eth } from 'web3-eth'

const sequelize = {} // Defined in your application
const eth = new Eth('provider')

await Web3Events.init(sequelize)
const events = new Web3Events(eth, {store: {}})

const coolContract = new Contract(abi, '0x123', 'coolContract')
type SomeEvent = { returnValues: {data: string} }
const eventsEmitter = events.createEventsEmitter<SomeEvent>(coolContract, { events: ['SomeEvent'] })
eventsEmitter.on('event', (event: SomeEvent) => {
  console.log('We got Some Event with data: ', event.returnValues.data)
})
```

### Components overview

There are several building blocks that cooperate to make the listening on events happen. Bellow is a basic overview:

 - `Web3Events`: higher level class that serves as glue for the rest of the components, making easier for users to create `EventsEmitters`.
 - `BlockTracker`: component that serves for persistant storage of data regarding what blocks were fetched or processed.
 - `NewBlockEmitters`: component that tracks wheter there is a new block on the blockchain. It serves as a trigger for most of the actions in the others components.
 - `Confirmator`: component that handles confirmations of blocks based on the configuration.
 - `EventsEmitter`: the main component that is linked to given Contract and listens on configured events/topics and emits them to the user.

### Confirmations

Blockchain reorganization is a well-known problem that makes development of blockchain's client applications rather hard, because the data can change under your hand.
This library tries to tackle this problem with basic approach of supporting confirmations a.k.a waiting configured number of blocks before
pronouncing a block valid. The main downside of this approach is that **once event is confirmed, then there is nothing to do about it**.
Choosing the numbers of confirmations is important and it is the eternal struggle between security and user experience. If you will
use a lot of confirmations you can be pretty sure that the block won't disapear in blockchain, but in the same time you are keeping your users waiting.

Do your own research about statistics of depth of reorgs (eq. how many blocks becomes orphaned in reorganization) on your blockchain and decide based on your usecase!

### Logger support

This library has extensive logging support. By default these log are agregated by [`debug`](https://www.npmjs.com/package/debug) package which
has basic logging capability mainly for development stage. If you want to view the logs set environmental variable `DEBUG='web3events*'.

You can pass your own logger for better logging support it just have to adhere to the `Logger` interface having functions:
`debug()`, `verbose()`, `info()`, `warn()` and `error()`. The signature of these functions is: `(message: string | object, ...meta: any[]) => void`.

Optionally it can have function `extend(name: string) => Logger` that creates a new Logger with extended name. E.g. if you have for example
logger `web3events` calling on it `extend('blockTracker')` would returned logger with name `web3events:blockTracker`.

## API

#### `Web3Events` class

Higher level class that serves as glue for the rest of the components. It encapsulate several dependencies that `EventsEmitters` have like `BlockStore`, `Eth` instance and `NewBlockEmitter`, making easier for users to create `EventsEmitters`.

##### `constructor(eth, options)`

Parameters:

- `eth` (`Eth`) - instance of web3.js's Eth, that defines the connection to the blockchain.
- `options` (`Web3EventsOptions` | `undefined`) - several non-mandatory options.
- `options.store` (`object` | `undefined`) - an object that serves as store where `BlockTracker` stores all metadata about processed and fetched block. It is good idea to use some solution that will
make this data persistent across restarts of the application, for example [`sequelize-store`](https://github.com/AuHau/sequelize-store). If not passed than you have to pass your own instance of `BlockTracker`
when calling `createEventsEmitter()`.
- `options.logger` (`Logger` | `undefined`) - instance of custom logger as described in [Logger support](#Logger_support).
- `options.defaultNewBlockEmitter` (`NewBlockEmitterOptions` | `NewBlockEmitter` | `undefined`) - either `NewBlockEmitter` instance or
options that should be used to construct default `NewBlockEmitter` that will be used when no instance is passed to the `createEventsEmitter()`.

##### `static init<Events>(sequelize) => Promise<voide>`

Initialization function which adds our database models to Sequelize instance. Needs to be run prior creating `Web3Events` instance.

Parameters:

 - `sequelize` (`Sequelize`) - instance of Sequelize

##### `createEventsEmitter<Events>(contract, options) => EventEmitter<Events>`

The main method that creates [`EventsEmitter`](#EventsEmitter_class) class. For more details see `EventsEmitter` documentation.

Parameters:

 - `contract` (`Contract`) - instance of `Contract` that the events will be listened upon

#### `Contract` class

A class that extends web3.js's `Contract` class with some metadata.

##### `contstructor(abi, address, name)`

Parameters:
- `abi` (`AbiItem[]`) - ABI that defines the Contract
- `address` (`string`) - an address of the deployed contract
- `name` (`string`) - a name of the Contract

#### `EventsEmitter` class

The main component that performs fetching and processing of Contract's events.

##### Events

It emits a bunch of events that you might be interested in:

 - `newEvent` (with `EventData` object as payload) - the main event which pass to you a ready to be processed event from Contract.
 - `progress` (with `Progress` object as payload) - as the events are processed in batches, you will get reporting on what batch is being processed and general progress.
 - `reorg` (only when `confirmations` are enabled) - informational event that notifies you that there was a blockchain reorganisation that was tackled by your confirmation range.
 - `reorgOutOfRange` (only when `confirmations` are enabled) - information event that notifies you that there was a blockchain reorganisation **outside of confirmation range** and hence your state can be invalid.
 - `newConfirmation` (only when `confirmations` are enabled; returns `NewConfirmationEvent` object) - information that there is new confirmation for given event.
 - `invalidConfirmation` (only when `confirmations` are enabled; returns `InvalidConfirmationsEvent` object) - information that during reorganisation that happened in the confirmation range a transaction was dropped.
 - `error` - general event that is emitted whenever something goes wrong

## Contribute

There are some ways you can make this module better:

- Consult our [open issues](https://github.com/rsksmart/web3-events/issues) and take on one of them
- Help our tests reach 100% coverage!

## License

[MIT](./LICENSE)
