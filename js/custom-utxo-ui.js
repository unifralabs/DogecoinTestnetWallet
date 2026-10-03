import { parseCustomUtxos, formatDoge } from './custom-utxos.js';
import { showAlert, copyToClipboard } from './ui.js';

let signedResult = null;

export function isCustomUtxoMode() {
    return document.getElementById('utxoSource')?.value === 'custom';
}

export function readCustomUtxos(address, scriptPubKey) {
    const utxos = parseCustomUtxos(document.getElementById('customUtxos').value, { address, scriptPubKey });
    const cache = JSON.parse(localStorage.getItem('spent_utxos_cache') || '[]');
    const recent = new Set(cache.filter(item => item.timestamp > Date.now() - 24 * 60 * 60 * 1000).map(item => item.id));
    if (utxos.some(utxo => recent.has(`${utxo.txid}:${utxo.vout}`))) {
        throw new Error('An imported UTXO was recently broadcast by this wallet. Refresh your UTXO data.');
    }
    return utxos;
}

export function clearSignedResult() {
    signedResult = null;
    const panel = document.getElementById('signedTransactionPanel');
    if (panel) panel.hidden = true;
    const raw = document.getElementById('signedTransactionHex');
    if (raw) raw.value = '';
}

export function showSignedResult(result) {
    signedResult = result;
    document.getElementById('signedTransactionPanel').hidden = false;
    document.getElementById('signedTransactionHex').value = result.rawTxHex;
    document.getElementById('signedTransactionSummary').textContent =
        `Signed locally — not broadcast.\nTXID: ${result.txid}\nRecipient: ${result.recipient}\n` +
        `Amount: ${formatDoge(result.amountKoinu)} DOGE\nInputs: ${result.inputCount} (${formatDoge(result.inputTotalKoinu)} DOGE)\n` +
        `Network fee: ${formatDoge(result.feeKoinu)} DOGE\nChange: ${formatDoge(result.changeKoinu)} DOGE\n` +
        `Additional L2Scan fee: ${formatDoge(result.l2scanFeeKoinu)} DOGE`;
}

export function initializeCustomUtxoUI(getWallet, getScript) {
    const source = document.getElementById('utxoSource');
    if (!source) return;
    const input = document.getElementById('customUtxos');
    const summary = document.getElementById('customUtxoSummary');
    const table = document.getElementById('customUtxoRows');
    const invalidate = () => {
        clearSignedResult();
        summary.textContent = 'Not validated. All imported UTXOs will be used.';
        table.replaceChildren();
        input.removeAttribute('aria-invalid');
    };
    const preview = () => {
        invalidate();
        try {
            const wallet = getWallet();
            if (!wallet.address) throw new Error('Select or import a wallet first.');
            const utxos = readCustomUtxos(wallet.address, getScript(wallet.address));
            const total = utxos.reduce((sum, row) => sum + BigInt(row.value), 0n);
            summary.textContent = `${utxos.length} UTXO(s) · ${formatDoge(total)} DOGE. Format checked locally; on-chain availability is not checked.`;
            for (const utxo of utxos) {
                const tr = document.createElement('tr');
                for (const value of [utxo.txid, utxo.vout, formatDoge(utxo.value)]) {
                    const td = document.createElement('td');
                    td.textContent = String(value);
                    tr.appendChild(td);
                }
                table.appendChild(tr);
            }
        } catch (error) {
            summary.textContent = error.message;
            input.setAttribute('aria-invalid', 'true');
        }
    };
    source.addEventListener('change', () => {
        document.getElementById('customUtxoPanel').hidden = !isCustomUtxoMode();
        invalidate();
    });
    input.addEventListener('input', invalidate);
    document.getElementById('validateUtxosBtn').addEventListener('click', preview);
    document.getElementById('customUtxoFile').addEventListener('change', async event => {
        invalidate();
        const file = event.target.files[0];
        if (!file) return;
        try {
            if (file.size > 1024 * 1024) throw new Error('UTXO JSON must be smaller than 1 MB.');
            input.value = await file.text();
            preview();
        } catch (error) { summary.textContent = error.message; }
        event.target.value = '';
    });
    document.getElementById('copySignedTransactionBtn').addEventListener('click', () => {
        if (signedResult) copyToClipboard(signedResult.rawTxHex, 'Signed transaction hex copied');
    });
    document.getElementById('downloadSignedTransactionBtn').addEventListener('click', () => {
        if (!signedResult) return;
        const url = URL.createObjectURL(new Blob([JSON.stringify(signedResult, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `dogecoin-testnet-${signedResult.txid}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showAlert('Signed transaction downloaded; it has not been broadcast.', 'info');
    });
    source.closest('.section').addEventListener('input', event => {
        if (event.target.id !== 'signedTransactionHex') clearSignedResult();
    });
    source.closest('.section').addEventListener('change', clearSignedResult);
    document.addEventListener('wallet-changed', invalidate);
}
