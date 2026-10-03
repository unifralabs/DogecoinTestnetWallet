// Amounts remain integer strings so importing JSON cannot round koinu values.
const MAX_UINT64 = (1n << 64n) - 1n;

export function dogeToKoinu(value) {
    const text = String(value).trim();
    if (!/^\d+(?:\.\d{1,8})?$/.test(text)) {
        throw new Error('DOGE amounts must be positive decimals with at most 8 decimal places.');
    }
    const [whole, fraction = ''] = text.split('.');
    const amount = BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, '0'));
    if (amount <= 0n || amount > MAX_UINT64) throw new Error('Amount is out of range.');
    return amount;
}

export function formatDoge(koinu) {
    const value = BigInt(koinu);
    return `${value / 100000000n}.${(value % 100000000n).toString().padStart(8, '0')}`;
}

function integer(value, name, max) {
    if ((typeof value !== 'string' && typeof value !== 'number') ||
        (typeof value === 'number' && !Number.isSafeInteger(value)) ||
        !/^\d+$/.test(String(value))) {
        throw new Error(`${name} must be an exact integer; use a quoted string for large values.`);
    }
    const result = BigInt(value);
    if (result > max) throw new Error(`${name} is out of range.`);
    return result;
}

export function parseCustomUtxos(text, { address, scriptPubKey }) {
    if (!address || !/^76a914[0-9a-f]{40}88ac$/i.test(scriptPubKey || '')) {
        throw new Error('Select or import a Dogecoin testnet P2PKH wallet first.');
    }
    if (text.length > 1024 * 1024) throw new Error('UTXO JSON must be smaller than 1 MB.');
    let payload;
    try { payload = JSON.parse(text); }
    catch { throw new Error('Invalid UTXO JSON. Paste an array or a Crypto APIs response.'); }
    if (payload?.network && !['testnet', 'dogecoin/testnet'].includes(payload.network)) {
        throw new Error('Only Dogecoin testnet UTXOs are supported.');
    }
    payload = payload?.apiResponse ?? payload;
    const rows = Array.isArray(payload) ? payload :
        payload?.data?.item?.inputs ?? payload?.data?.items ?? payload?.inputs ?? payload?.utxos;
    if (!Array.isArray(rows) || !rows.length) throw new Error('No UTXOs found in the JSON.');
    if (rows.length > 500) throw new Error('Import at most 500 UTXOs at a time.');
    const seen = new Set();
    let total = 0n;
    return rows.map((row, index) => {
        try {
            if (!row || typeof row !== 'object') throw new Error('Expected a UTXO object.');
            const txid = row.txid ?? row.transactionId;
            if (typeof txid !== 'string' || !/^[0-9a-f]{64}$/i.test(txid)) {
                throw new Error('txid must contain exactly 64 hexadecimal characters.');
            }
            const vout = Number(integer(row.vout ?? row.outputIndex ?? row.index, 'vout', 0xffffffffn));
            const id = `${txid.toLowerCase()}:${vout}`;
            if (seen.has(id)) throw new Error('Duplicate txid/vout.');
            seen.add(id);
            if (row.isSpent === true || row.isAvailable === false) throw new Error('UTXO is marked spent or unavailable.');
            if (row.isConfirmed === false || row.status?.confirmed === false) throw new Error('UTXO is marked unconfirmed.');
            if ((row.address !== undefined && row.address !== address) ||
                (row.addresses !== undefined && (!Array.isArray(row.addresses) || !row.addresses.includes(address)))) {
                throw new Error('UTXO address does not match the selected wallet.');
            }
            const script = row.scriptPubKey?.hex ?? row.scriptPubKey ?? row.script?.hex ?? row.script;
            if (script !== undefined && (typeof script !== 'string' || script.toLowerCase() !== scriptPubKey.toLowerCase())) {
                throw new Error('Only P2PKH scripts belonging to the selected wallet can be signed.');
            }
            const unit = row.value?.unit ?? row.unit;
            if (unit !== undefined && unit !== 'DOGE') throw new Error('UTXO amount unit must be DOGE.');
            let value;
            if (row.satoshis !== undefined || typeof row.value === 'string' || typeof row.value === 'number') {
                value = integer(row.satoshis ?? row.value, 'value/satoshis (koinu)', MAX_UINT64);
            } else {
                const amount = row.value?.amount ?? row.amount;
                if (typeof amount !== 'string') throw new Error('Provide value/satoshis in koinu, or amount as a DOGE decimal string.');
                value = dogeToKoinu(amount);
            }
            if (value <= 0n) throw new Error('UTXO value must be greater than zero.');
            total += value;
            if (total > MAX_UINT64) throw new Error('Total UTXO value is out of range.');
            return { txid: txid.toLowerCase(), vout, value: value.toString(), scriptPubKey: scriptPubKey.toLowerCase() };
        } catch (error) {
            throw new Error(`UTXO ${index + 1}: ${error.message}`);
        }
    });
}
