# Dogecoin Testnet Wallet

A browser-based wallet for Dogecoin Testnet. It can generate and import wallets, query balances and UTXOs, build and sign transactions locally, broadcast transactions, and attach optional `OP_RETURN` data.

**Live demo:** [unifralabs.github.io/DogecoinTestnetWallet](https://unifralabs.github.io/DogecoinTestnetWallet/)

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

## Custom UTXOs and signing without the UTXO service

Available in both `index.html` and `wallet-v2.html`:

1. Generate or import the wallet that owns the outputs.
2. Under **UTXO source**, choose **Custom — paste or import UTXOs**.
3. Paste JSON or select a JSON file, then click **Validate & Preview UTXOs**.
4. Enter the recipient and DOGE amount (for example `10000`).
5. Click **Sign Only — Export Hex** to sign locally and copy/download the signed transaction. This does not broadcast, reserve inputs, update transaction history, or mark inputs as spent. **Sign & Broadcast** sends to the configured broadcast endpoint.

Custom mode spends **all supplied UTXOs** and returns remaining value to the current wallet after the recipient amount, network fee, and any configured L2Scan fee. To choose a subset, include only that subset in the JSON. It does not fetch UTXOs or depend on the displayed API balance; background balance/status requests may still run.

Supported input shapes:

- An array of `{ "txid", "vout", "value", "scriptPubKey" }` (Esplora-style `status` is also accepted).
- Crypto APIs prepare response: `data.item.inputs`, or an object with `inputs` containing `{ "transactionId", "outputIndex", "satoshis", "script", "address" }`.
- Crypto APIs unspent-output response: `data.items`, with `transactionId`, `index`, and `value.amount` as a DOGE decimal string.
- A saved result containing `apiResponse.data.item.inputs`, such as `dogecoin-testnet-prepare-10000.json`.

`value` and `satoshis` are **integer koinu**, not DOGE (`100000000` = `1 DOGE`). Use quoted integer strings for large amounts to avoid JSON number rounding. `scriptPubKey` is optional: if absent, the current wallet's P2PKH script is used. If present, it must match the current wallet. Duplicate outpoints, malformed values, foreign scripts/addresses, explicit spent/unavailable/unconfirmed flags, and recently broadcast inputs in the local cache are rejected. Only this wallet's P2PKH inputs are supported.

Only UTXO inputs are imported from a prepare response. Its outputs, fee, and sighashes are **not reused**: the wallet rebuilds the transaction and signatures from the recipient, amount, optional data, and existing fee policy in this form. Check the exported recipient, fee, and change before broadcasting. The bridge page keeps its existing L2Scan fee settings.

Import validation is local. It cannot verify that supplied values match the blockchain or that outputs remain unspent. Use fresh data from a trusted source. Private keys remain in the existing browser wallet and are not included in exported transaction JSON. Exports contain `rawTxHex`, a locally computed `txid`, the selected inputs, and exact amount/fee/change values in koinu.

For external broadcasting, copy `rawTxHex` into the broadcaster's signed-transaction field. The Sign & Broadcast button uses the Dogecoin RPC URL configured in the Dogecoin RPC panel. Importing Crypto APIs UTXOs does not change that setting.

### Tests

With Node.js 22 or newer:

```bash
node --test tests/*.test.mjs
```

Tests cover JSON formats, precision and invalid-input handling, recipient checks, insufficient funds, dust change, and independent OpenSSL verification of signatures for a 10,000 DOGE transaction with a large change output. No live coins are used or broadcast by the tests.


## Configurable Dogecoin RPC

Both wallet pages have a **Dogecoin RPC** panel. Enter the complete URL of your Dogecoin testnet RPC node or gateway. Broadcasting always uses native Dogecoin JSON-RPC, with this POST body (`Content-Type: application/json`):

```json
{"jsonrpc":"1.0","id":"dogecoin-wallet","method":"sendrawtransaction","params":["<signed hex>"]}
```

The transaction ID is read from `result`; RPC rejections display `error.code` and `error.message`. There is no REST broadcast mode or default third-party broadcast URL.

- **Save RPC URL** stores the URL in this site's `localStorage`. It is restored after refresh or reopening the same browser/site, and shared by the normal and bridge pages. Localhost and the hosted GitHub Pages site have separate browser storage.
- **Clear Saved RPC** removes the saved URL. Existing saved JSON-RPC URLs are retained; legacy Electrs broadcast settings require entering a new RPC URL.
- Broadcasting uses the current form URL even before Save; Save controls whether it survives reload. A missing or invalid RPC URL stops the send before signing. **Sign Only** does not require an RPC URL.
- Optional authentication accepts an `Authorization` header value such as `Basic base64(rpcuser:rpcpassword)`. The header is held only in the form and is not persisted. URL paths and query parameters *are* saved, including any provider token embedded in the URL.

The endpoint must serve **Dogecoin testnet** and permit this page's browser origin via CORS, including JSON/Authorization headers where applicable. When serving the wallet over HTTPS, use an HTTPS RPC endpoint; browsers may block HTTP endpoints as mixed content. A private Dogecoin Core node typically needs a suitable CORS-enabled gateway for browser access.

Only broadcast routing changes. Balance, UTXO discovery, block information, and transaction-status polling continue to use the existing Electrs service. Custom UTXO import and Sign Only still work without that UTXO service. Broadcasts use one attempt with a 15-second timeout and no automatic retry or fallback provider; a timeout can happen after acceptance, so check the transaction ID before retrying.
