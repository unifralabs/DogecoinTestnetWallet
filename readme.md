# Dogecoin Testnet Wallet

A browser-based wallet for Dogecoin Testnet. It can generate and import wallets, query balances and UTXOs, build and sign transactions locally, broadcast transactions, and attach optional `OP_RETURN` data.

> This project is for development and testing only. Testnet coins have no monetary value. Never use a mainnet private key in this wallet.

## Features

- Generate and import Dogecoin Testnet wallets
- Store wallet data locally with IndexedDB
- Query confirmed balances and UTXOs
- Build, sign, and broadcast testnet transactions
- Track pending and confirmed transactions
- Add optional `OP_RETURN` data
- Inspect addresses and transactions in a testnet block explorer

## Public Dogecoin Testnet API

The wallet uses the public QED Electrs/Esplora service:

```text
https://doge-electrs-testnet-demo.qed.me
```

No API key is required, and the service supports browser CORS requests.

| Operation | Method and path |
| --- | --- |
| Address information and balance data | `GET /address/{address}` |
| Address UTXOs | `GET /address/{address}/utxo` |
| Confirmed transactions | `GET /address/{address}/txs` |
| Mempool transactions | `GET /address/{address}/txs/mempool` |
| Transaction details | `GET /tx/{txid}` |
| Latest block height | `GET /blocks/tip/height` |
| Broadcast a raw transaction | `POST /tx` |

Example UTXO request:

```bash
curl 'https://doge-electrs-testnet-demo.qed.me/address/nrRnCD6giGRTRYUf6D88vLiRzP3RFZsPCh/utxo'
```

The UTXO response follows the Esplora format:

```json
[
  {
    "txid": "...",
    "vout": 1,
    "value": 100000000,
    "status": {
      "confirmed": true,
      "block_height": 123456,
      "block_hash": "...",
      "block_time": 1700000000
    }
  }
]
```

`value` is denominated in koinu, the smallest Dogecoin unit. `100000000` koinu equals `1 DOGE`.

The integration uses a 15-second timeout and retries read requests when the public service has a transient network or server error. Transaction broadcasts are not automatically retried because the first request may already have reached the node.

The associated testnet block explorer is available at [doge-testnet-explorer.qed.me](https://doge-testnet-explorer.qed.me/).

## Run locally

The application uses JavaScript modules, so serve it over HTTP instead of opening `index.html` through `file://`.

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080/
```

The browser must have internet access because the application queries the public testnet API and loads CryptoJS from a CDN.

## Project structure

```text
index.html              Main wallet interface
crypto-libs.js          Local Base58 and elliptic-curve dependencies
css/styles.css          Wallet styles
js/network.js           Electrs/Esplora API integration
js/transaction.js       Transaction construction, signing, and status tracking
js/wallet.js            Wallet generation and import
js/storage.js           IndexedDB persistence
js/blockInfo.js         Latest testnet block information
op_return_parser.html   OP_RETURN and protocol-data parser
```

## Test coins

Testnet coins can be requested from [faucet.doge.toys](https://faucet.doge.toys/).

## Public-service notice

The QED endpoint is a community-operated public service and does not provide a commercial SLA. For production-like testing, consider operating a private Electrs/Esplora or Blockbook instance and changing `ELECTRS_API_BASE` in `js/network.js`.
