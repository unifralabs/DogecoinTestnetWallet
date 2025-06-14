#!/bin/bash

API_BASE="https://doge-electrs-testnet-demo.qed.me"

echo "获取最新区块高度..."
BLOCK_HEIGHT=$(curl -s "${API_BASE}/blocks/tip/height")
echo "最新区块高度: ${BLOCK_HEIGHT}"

echo -e "\n获取区块信息..."
curl -s "${API_BASE}/block-height/${BLOCK_HEIGHT}"

echo -e "\n获取最新区块的哈希值..."
curl -s "${API_BASE}/blocks/tip/hash"

echo -e "\n获取区块详细信息(通过哈希值)..."
BLOCK_HASH=$(curl -s "${API_BASE}/blocks/tip/hash")
curl -s "${API_BASE}/block/${BLOCK_HASH}" | json_pp
