let useElectrs = true;
let useElectrsProxy = false;

function blockBookApiV2() {
    return 'https://blockbook.qiaoxiaorui.org/api/v2';
}

//@ts-check
async function fetchBalance(address) {
    try {
        const baseUrl = blockBookApiV2();
        let response, data;
        const apiUrl = `${baseUrl}/address/${address}`;
        response = await fetch(apiUrl);
        if (response.ok) {
            data = await response.json();
            return {
                balance: data.balance
            };
        }
        throw new Error('API query failed: ' + response.status);
    } catch (error) {
        throw new Error('Failed to fetch balance: ' + error.message);
    }
}

async function getUTXOs(address) {
    try {
        const baseUrl = blockBookApiV2();
        const apiUrl = `${baseUrl}/utxo/${address}`;

        const response = await fetch(apiUrl);
        if (response.ok) {
            const utxos = await response.json();
            // Filter for confirmed UTXOs with a value, then map to convert value to an integer.
            return utxos
                .filter(utxo => {
                    const isConfirmed = utxo.confirmations > 0;
                    const hasValue = utxo.value && parseInt(utxo.value, 10) > 0;
                    return isConfirmed && hasValue;
                })
                .map(utxo => ({
                    ...utxo,
                    value: parseInt(utxo.value, 10)
                }));
        }
        throw new Error('Failed to get UTXO: ' + response.status);
    } catch (error) {
        throw error;
    }
}

async function broadcastTransaction(txHex) {
    try {
        // 使用 Blockbook API
        const baseUrl = "https://blockbook.qiaoxiaorui.org/api/v2";
        console.log('Broadcasting transaction via Blockbook:', txHex);
        
        // Blockbook 的 sendtx 接口（POST 方式）
        const response = await fetch(`${baseUrl}/sendtx/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain',
            },
            body: txHex
        });

        // 先解析响应体（无论状态码如何）
        const data = await response.json();
        
        // 检查是否有错误（Blockbook 可能返回 200 状态码但包含错误信息）
        if (data.error) {
            const errorMsg = data.error.message || JSON.stringify(data.error);
            console.error('Blockbook broadcast error:', errorMsg);
            throw new Error(`Blockbook error: ${errorMsg}`);
        }
        
        // 检查是否有成功结果
        if (data.result) {
            console.log('✓ Transaction broadcasted successfully, TXID:', data.result);
            return data.result; // 返回 txid
        }
        
        // HTTP 错误状态码
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}: ${JSON.stringify(data)}`);
        }
        
        // 未知响应格式
        console.error('Unexpected Blockbook response:', data);
        throw new Error('Unexpected response format from Blockbook: ' + JSON.stringify(data));
        
    } catch (error) {
        // 如果是网络错误或 JSON 解析错误
        if (error.message.includes('Blockbook error:')) {
            throw error; // 已经是格式化的错误，直接抛出
        }
        throw new Error('Failed to broadcast transaction: ' + error.message);
    }
}

async function fetchMempoolTransactions(address) {
    try {
        const baseUrl = blockBookApiV2();
        const apiUrl = `${baseUrl}/address/${address}?details=txs`;

        const response = await fetch(apiUrl);
        if (response.ok) {
            //return await response.json(); // Returns an array of transaction objects
            const data = await response.json();
            if (data.unconfirmedTxs == 0) {
                return [];
            }
            let pendingTransactions = []
            for (let i = 0; i < data.transactions.length; i++) {
                if (data.transactions[i].confirmations == 0) {
                    pendingTransactions.push(data.transactions[i])
                }
            }
            return pendingTransactions;
        }
        console.warn(`Failed to fetch mempool transactions for ${address}: ${response.status}`);
        return []; // Return empty array on failure to allow graceful handling
    } catch (error) {
        console.error(`Error fetching mempool transactions for ${address}:`, error);
        return []; // Return empty array on error
    }
}

async function getVerifiedUTXOs(address) {
    const utxos = await getUTXOs(address);
    if (!Array.isArray(utxos) || utxos.length === 0) {
        return [];
    }

    try {
        const stored = localStorage.getItem('spent_utxos_cache');
        if (!stored) {
            return utxos; // No cache, return all UTXOs
        }

        const cache = JSON.parse(stored);
        const now = Date.now();
        const fifteenMinutesAgo = now - 24 * 60 * 60 * 1000;

        const spentIds = new Set(
            cache.filter(item => item.timestamp > fifteenMinutesAgo).map(item => item.id)
        );

        return utxos.filter(utxo => !spentIds.has(`${utxo.txid}:${utxo.vout}`));
    } catch (error) {
        console.error("Failed to filter spent UTXOs, returning all UTXOs as a fallback:", error);
        return utxos;
    }
}

export {
    fetchBalance,
    getUTXOs,
    getVerifiedUTXOs,
    broadcastTransaction,
    fetchMempoolTransactions,
    useElectrs,
    useElectrsProxy
};
