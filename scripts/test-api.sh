#!/bin/bash

API_BASE="https://doge-electrs-testnet-demo.qed.me"

echo "Getting latest block height..."
BLOCK_HEIGHT=$(curl -s "${API_BASE}/blocks/tip/height")
echo "Latest block height: ${BLOCK_HEIGHT}"

echo -e "\nGetting block info..."
curl -s "${API_BASE}/block-height/${BLOCK_HEIGHT}"

echo -e "\nGetting latest block hash..."
curl -s "${API_BASE}/blocks/tip/hash"

echo -e "\nGetting detailed block info (by hash)..."
BLOCK_HASH=$(curl -s "${API_BASE}/blocks/tip/hash")
curl -s "${API_BASE}/block/${BLOCK_HASH}" | json_pp
