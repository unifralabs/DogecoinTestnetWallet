let useElectrs = true;
let useElectrsProxy = false;

function getElectrsUrl() {
    if (useElectrsProxy) {
        return '/electrs';
    } else {
        return 'https://doge-electrs-testnet-demo.qed.me';
    }
}

function getCorsProxyUrl(url) {
    // if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    //     return `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    // }
    return url;
}

async function fetchBalance(address) {
    try {
        const baseUrl = getElectrsUrl();
        let response, data;
        
        if (useElectrsProxy) {
            response = await fetch(`${baseUrl}/address/${address}`);
            if (response.ok) {
                data = await response.json();
                return {
                    balance: data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum,
                    utxoCount: data.chain_stats.funded_txo_count - data.chain_stats.spent_txo_count
                };
            }
        } else {
            const apiUrl = `${baseUrl}/address/${address}`;
            const finalUrl = getCorsProxyUrl(apiUrl);
            response = await fetch(finalUrl);
            if (response.ok) {
                data = await response.json();
                return {
                    balance: data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum,
                    utxoCount: data.chain_stats.funded_txo_count - data.chain_stats.spent_txo_count
                };
            }
        }
        throw new Error('API查询失败: ' + response.status);
    } catch (error) {
        throw new Error('获取余额失败: ' + error.message);
    }
}

async function getUTXOs(address) {
    try {
        const baseUrl = getElectrsUrl();
        const apiUrl = `${baseUrl}/address/${address}/utxo`;
        const finalUrl = getCorsProxyUrl(apiUrl);
        
        const response = await fetch(finalUrl);
        if (response.ok) {
            const utxos = await response.json();
            return utxos.filter(utxo => {
                const isConfirmed = utxo.status && utxo.status.confirmed;
                const hasValue = utxo.value && utxo.value > 0;
                const hasValidTxid = utxo.txid && utxo.txid.length === 64;
                const hasValidVout = typeof utxo.vout === 'number' && utxo.vout >= 0;
                return isConfirmed && hasValue && hasValidTxid && hasValidVout;
            });
        }
        throw new Error('获取 UTXO 失败: ' + response.status);
    } catch (error) {
        throw error;
    }
}

async function broadcastTransaction(txHex) {
    try {
        const baseUrl = getElectrsUrl();
        const response = await fetch(`${baseUrl}/tx`, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain',
            },
            body: txHex
        });

        if (response.ok) {
            const txid = await response.text();
            return txid.trim();
        }
        throw new Error('广播交易失败: ' + response.status);
    } catch (error) {
        throw new Error('广播交易失败: ' + error.message);
    }
}

async function fetchMempoolTransactions(address) {
    try {
        const baseUrl = getElectrsUrl();
        const apiUrl = `${baseUrl}/address/${address}/txs/mempool`;
        // Mempool data might not always need CORS proxy if server is well-configured,
        // but using getCorsProxyUrl provides consistency.
        const finalUrl = getCorsProxyUrl(apiUrl);

        const response = await fetch(finalUrl);
        if (response.ok) {
            return await response.json(); // Returns an array of transaction objects
        }
        console.warn(`Failed to fetch mempool transactions for ${address}: ${response.status}`);
        return []; // Return empty array on failure to allow graceful handling
    } catch (error) {
        console.error(`Error fetching mempool transactions for ${address}:`, error);
        return []; // Return empty array on error
    }
}

export {
    getElectrsUrl,
    getCorsProxyUrl,
    fetchBalance,
    getUTXOs,
    broadcastTransaction,
    fetchMempoolTransactions, // Export the new function
    useElectrs,
    useElectrsProxy
};
