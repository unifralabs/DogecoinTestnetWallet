import { validateBroadcastSettings } from './broadcast-settings.js';

// One attempt only: a timeout may occur after the provider has accepted the transaction.
export async function broadcastSignedTransaction(txHex, settings, fetchImpl = fetch) {
    const { url } = validateBroadcastSettings(settings);
    if (typeof txHex !== 'string' || !/^(?:[0-9a-f]{2})+$/i.test(txHex)) {
        throw new Error('Signed transaction must be an even-length hexadecimal string.');
    }
    const authorization = settings.authorization || '';
    if (/[\r\n]/.test(authorization)) throw new Error('Authorization must be a single-line header value.');
    const headers = { 'Content-Type': 'application/json' };
    if (authorization) headers.Authorization = authorization;
    const id = 'dogecoin-wallet';
    const body = JSON.stringify({ jsonrpc: '1.0', id, method: 'sendrawtransaction', params: [txHex] });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        const response = await fetchImpl(url, {
            method: 'POST', headers, body, signal: controller.signal,
            credentials: 'omit', redirect: 'error'
        });
        const text = (await response.text()).trim();
        let result;
        try { result = JSON.parse(text); }
        catch { throw new Error(`RPC returned invalid JSON (HTTP ${response.status}).`); }
        if (result?.error) {
            throw new Error(`RPC error ${result.error.code ?? ''}: ${result.error.message || 'Transaction rejected.'}`);
        }
        if (!response.ok) throw new Error(`Broadcast HTTP ${response.status}: ${response.statusText}`);
        if (!result || result.id !== id) throw new Error('RPC response ID does not match the broadcast request.');
        const txid = result.result;
        if (typeof txid !== 'string' || !/^[0-9a-f]{64}$/i.test(txid)) {
            throw new Error('Broadcast endpoint did not return a valid transaction ID.');
        }
        return txid.toLowerCase();
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error('Broadcast timed out. It may have been accepted; check the transaction ID before retrying.');
        }
        if (error instanceof TypeError) {
            throw new Error('Cannot reach the broadcast endpoint. Check its URL, CORS support, and HTTPS/mixed-content settings. Check transaction status before retrying.');
        }
        throw error;
    } finally { clearTimeout(timeout); }
}
