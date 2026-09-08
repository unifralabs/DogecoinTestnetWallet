const ELECTRS_API_BASE = 'https://doge-electrs-testnet-demo.qed.me';
const REQUEST_TIMEOUT_MS = 15000;

let useElectrs = true;
let useElectrsProxy = false;

async function fetchFromElectrs(path, options = {}, retries = 2) {
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        try {
            const response = await fetch(`${ELECTRS_API_BASE}${path}`, {
                ...options,
                signal: controller.signal
            });

            if ((response.status === 429 || response.status >= 500) && attempt < retries) {
                await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
                continue;
            }

            return response;
        } catch (error) {
            lastError = error;
            if (attempt === retries) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
        } finally {
            clearTimeout(timeoutId);
        }
    }

    throw lastError;
}

async function getResponseError(response) {
    const body = (await response.text()).trim();
    return body || `${response.status} ${response.statusText}`;
}

//@ts-check
async function fetchBalance(address) {
    try {
        const response = await fetchFromElectrs(`/address/${encodeURIComponent(address)}`);
        if (!response.ok) {
            throw new Error('API query failed: ' + await getResponseError(response));
        }

        const data = await response.json();
        const confirmedBalance = data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
        const unconfirmedBalance = data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum;

        return {
            // Keep the existing Blockbook-compatible shape used by the UI.
            balance: String(confirmedBalance),
            unconfirmedBalance: String(unconfirmedBalance)
        };
    } catch (error) {
        throw new Error('Failed to fetch balance: ' + error.message);
    }
}

async function getUTXOs(address) {
    const response = await fetchFromElectrs(`/address/${encodeURIComponent(address)}/utxo`);
    if (!response.ok) {
        throw new Error('Failed to get UTXOs: ' + await getResponseError(response));
    }

    const utxos = await response.json();
    return utxos
        .filter(utxo => utxo.status?.confirmed && Number(utxo.value) > 0)
        .map(utxo => ({
            ...utxo,
            // Preserve the fields expected by the existing transaction builder.
            value: Number(utxo.value),
            confirmations: 1,
            height: utxo.status.block_height
        }));
}

async function broadcastTransaction(txHex) {
    try {
        console.log('Broadcasting transaction via Dogecoin Testnet Electrs: txHex.length=', txHex.length);

        // Do not automatically retry a broadcast: the first request may have reached the node.
        const response = await fetchFromElectrs('/tx', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: txHex
        }, 0);

        const responseText = (await response.text()).trim();
        if (!response.ok) {
            throw new Error(responseText || `HTTP ${response.status} ${response.statusText}`);
        }

        if (!/^[0-9a-f]{64}$/i.test(responseText)) {
            throw new Error('Unexpected broadcast response: ' + responseText);
        }

        console.log('✓ Transaction broadcasted successfully, TXID:', responseText);
        return responseText;
    } catch (error) {
        throw new Error('Failed to broadcast transaction: ' + error.message);
    }
}

async function fetchMempoolTransactions(address) {
    try {
        const response = await fetchFromElectrs(`/address/${encodeURIComponent(address)}/txs/mempool`);
        if (response.ok) {
            const data = await response.json();
            return Array.isArray(data)
                ? data.filter(tx => !tx.status?.confirmed)
                : [];
        }
        console.warn(`Failed to fetch mempool transactions for ${address}: ${response.status}`);
        return [];
    } catch (error) {
        console.error(`Error fetching mempool transactions for ${address}:`, error);
        return [];
    }
}

async function fetchTransaction(txid) {
    const response = await fetchFromElectrs(`/tx/${encodeURIComponent(txid)}`);
    if (!response.ok) {
        throw new Error('Failed to get transaction: ' + await getResponseError(response));
    }

    return await response.json();
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
        const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

        const spentIds = new Set(
            cache.filter(item => item.timestamp > twentyFourHoursAgo).map(item => item.id)
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
    fetchTransaction,
    useElectrs,
    useElectrsProxy
};
