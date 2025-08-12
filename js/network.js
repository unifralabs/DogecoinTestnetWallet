let useElectrs = true;
let useElectrsProxy = false;

function getElectrsUrl() {
    if (useElectrsProxy) {
        return '/electrs';
    } else {
        return 'https://doge-electrs-testnet-demo.qed.me';
    }
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
            response = await fetch(apiUrl);
            if (response.ok) {
                data = await response.json();
                return {
                    balance: data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum,
                    utxoCount: data.chain_stats.funded_txo_count - data.chain_stats.spent_txo_count
                };
            }
        }
        throw new Error('API query failed: ' + response.status);
    } catch (error) {
        throw new Error('Failed to fetch balance: ' + error.message);
    }
}

async function getUTXOs(address) {
    try {
        const baseUrl = getElectrsUrl();
        const apiUrl = `${baseUrl}/address/${address}/utxo`;
        
        const response = await fetch(apiUrl);
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
        throw new Error('Failed to get UTXO: ' + response.status);
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
        // Try to read error body for diagnostics (e.g., min relay fee not met)
        let errorText = '';
        try {
            errorText = await response.text();
        } catch (_) {
            // ignore body read errors
        }
        throw new Error('Failed to broadcast transaction: ' + response.status + (errorText ? ` - ${errorText}` : ''));
    } catch (error) {
        throw new Error('Failed to broadcast transaction: ' + error.message);
    }
}

async function fetchMempoolTransactions(address) {
    try {
        const baseUrl = getElectrsUrl();
        const apiUrl = `${baseUrl}/address/${address}/txs/mempool`;
        // Mempool data might not always need CORS proxy if server is well-configured.

        const response = await fetch(apiUrl);
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

// Verify UTXOs are still unspent using Electrs outspend endpoint
async function getVerifiedUTXOs(address) {
    const baseUrl = getElectrsUrl();
    const utxos = await getUTXOs(address);
    if (!Array.isArray(utxos) || utxos.length === 0) return [];
    const checks = await Promise.all(
        utxos.map(async (u) => {
            try {
                const resp = await fetch(`${baseUrl}/tx/${u.txid}/outspend/${u.vout}`);
                if (!resp.ok) return null;
                return await resp.json();
            } catch (_) {
                return null;
            }
        })
    );
    return utxos.filter((u, i) => checks[i] && checks[i].spent === false);
}

export {
    getElectrsUrl,
    fetchBalance,
    getUTXOs,
    getVerifiedUTXOs,
    broadcastTransaction,
    fetchMempoolTransactions,
    useElectrs,
    useElectrsProxy
};
