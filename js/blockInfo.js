const API_BASE = 'https://doge-electrs-testnet-demo.qed.me';

const fetchLatestBlockHeight = async () => {
    const response = await fetch(`${API_BASE}/blocks/tip/height`);
    return await response.text();
};

const fetchBlockInfo = async () => {
    const blockHash = await fetch(`${API_BASE}/blocks/tip/hash`);
    const hash = await blockHash.text();
    const response = await fetch(`${API_BASE}/block/${hash}`);
    return await response.json();
};

const updateBlockInfo = async () => {
    try {
        const blockInfo = await fetchBlockInfo();
        document.getElementById('currentBlockHeight').textContent = blockInfo.height;
        document.getElementById('currentBlockHash').textContent = blockInfo.id;
        document.getElementById('currentBlockTime').textContent = new Date(blockInfo.timestamp * 1000).toLocaleString();
        document.getElementById('currentBlockDifficulty').textContent = blockInfo.difficulty.toFixed(8);
    } catch (error) {
        console.error('区块信息更新失败:', error);
    }
};

setInterval(updateBlockInfo, 2000);
updateBlockInfo();

export { updateBlockInfo, fetchBlockInfo, fetchLatestBlockHeight };

