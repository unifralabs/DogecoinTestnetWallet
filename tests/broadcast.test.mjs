import test from 'node:test';
import assert from 'node:assert/strict';
import { BROADCAST_SETTINGS_KEY, DEFAULT_BROADCAST_SETTINGS, validateBroadcastSettings, loadBroadcastSettings, saveBroadcastSettings, clearBroadcastSettings } from '../js/broadcast-settings.js';
import { broadcastSignedTransaction } from '../js/broadcast.js';

const txid = 'ab'.repeat(32);
const rpc = { type: 'jsonrpc', url: 'https://rpc.example.test/dogecoin/testnet?project=demo' };
const response = (body, status = 200) => new Response(body, { status });
const memoryStorage = () => {
    const data = new Map();
    return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
};

test('remembers the RPC URL without authentication and supports clearing saved settings', () => {
    const storage = memoryStorage();
    assert.deepEqual(loadBroadcastSettings(storage), DEFAULT_BROADCAST_SETTINGS);
    saveBroadcastSettings({ ...rpc, authorization: 'Basic temporary' }, storage);
    assert.deepEqual(loadBroadcastSettings(storage), rpc);
    assert.equal(storage.getItem(BROADCAST_SETTINGS_KEY).includes('temporary'), false);
    clearBroadcastSettings(storage);
    assert.equal(storage.getItem(BROADCAST_SETTINGS_KEY), null);
    assert.deepEqual(loadBroadcastSettings(storage), DEFAULT_BROADCAST_SETTINGS);
});

test('invalid endpoints cannot overwrite saved settings or fall back to an unintended URL', () => {
    const storage = memoryStorage();
    saveBroadcastSettings(rpc, storage);
    for (const settings of [{ ...rpc, url: '' }, { ...rpc, url: '/tx' }, { ...rpc, url: 'javascript:alert(1)' }, { ...rpc, url: 'wss://example.test' }, { ...rpc, url: 'https://user:password@example.test' }, { ...rpc, url: 'https://example.test/#fragment' }, { ...rpc, type: 'unsupported' }]) {
        assert.throws(() => saveBroadcastSettings(settings, storage));
        assert.deepEqual(loadBroadcastSettings(storage), rpc);
    }
    storage.setItem(BROADCAST_SETTINGS_KEY, '{bad-json');
    assert.throws(() => loadBroadcastSettings(storage));
    assert.deepEqual(validateBroadcastSettings({ type: 'jsonrpc', url: ' http://127.0.0.1:44555/ ' }), { type: 'jsonrpc', url: 'http://127.0.0.1:44555/' });
});

test('legacy REST settings and an unconfigured RPC never make a broadcast request', async () => {
    const legacy = { type: 'electrs', url: 'https://doge-electrs-testnet-demo.qed.me/tx' };
    const storage = memoryStorage();
    storage.setItem(BROADCAST_SETTINGS_KEY, JSON.stringify(legacy));
    assert.throws(() => loadBroadcastSettings(storage), /JSON-RPC/);
    let calls = 0;
    for (const settings of [legacy, DEFAULT_BROADCAST_SETTINGS]) {
        await assert.rejects(broadcastSignedTransaction('deadbeef', settings, async () => { calls++; }));
    }
    assert.equal(calls, 0);
});

test('JSON-RPC uses sendrawtransaction and extracts a validated result', async () => {
    const result = await broadcastSignedTransaction('deadbeef', rpc, async (url, options) => {
        assert.equal(url, rpc.url);
        assert.equal(options.headers['Content-Type'], 'application/json');
        assert.equal(options.headers.Authorization, undefined);
        const body = JSON.parse(options.body);
        assert.deepEqual(body, { jsonrpc: '1.0', id: 'dogecoin-wallet', method: 'sendrawtransaction', params: ['deadbeef'] });
        return response(JSON.stringify({ result: txid, error: null, id: body.id }));
    });
    assert.equal(result, txid);
});

test('RPC and HTTP rejection, invalid JSON/IDs and missing txids fail without retry', async () => {
    const cases = [
        [rpc, response(JSON.stringify({ error: { code: -26, message: 'bad-txns-inputs-spent' }, result: null, id: 'dogecoin-wallet' }), 500), /-26.*bad-txns-inputs-spent/],
        [rpc, response('<html>error</html>', 502), /invalid JSON/],
        [rpc, response(JSON.stringify({ result: txid, id: 'another-request' })), /ID does not match/],
        [rpc, response(JSON.stringify({ result: null, id: 'dogecoin-wallet' })), /valid transaction ID/],
        [rpc, response(JSON.stringify({ result: null, id: 'dogecoin-wallet' }), 503), /HTTP 503/],
        [rpc, response(txid), /invalid JSON/]
    ];
    for (const [settings, reply, expected] of cases) {
        let calls = 0;
        await assert.rejects(broadcastSignedTransaction('deadbeef', settings, async () => { calls++; return reply; }), expected);
        assert.equal(calls, 1);
    }
});

test('invalid hex and header injection make no request; network/timeout failures are not retried', async () => {
    let calls = 0;
    const never = async () => { calls++; throw new Error('Should not fetch'); };
    for (const hex of ['', 'abc', '0x12', 'not hex']) await assert.rejects(broadcastSignedTransaction(hex, rpc, never), /hexadecimal/);
    await assert.rejects(broadcastSignedTransaction('deadbeef', { ...rpc, authorization: 'Bearer x\r\nExtra: value' }, never), /single-line/);
    assert.equal(calls, 0);
    await assert.rejects(broadcastSignedTransaction('deadbeef', rpc, async () => { calls++; throw new TypeError('Failed to fetch'); }), /CORS/);
    assert.equal(calls, 1);
    await assert.rejects(broadcastSignedTransaction('deadbeef', rpc, async () => { calls++; throw new DOMException('Aborted', 'AbortError'); }), /may have been accepted/);
    assert.equal(calls, 2);
});

test('RPC uses the exact endpoint and optional HTTP Basic authentication in one POST', async () => {
    let calls = 0;
    const settings = { ...rpc, authorization: 'Basic dXNlcjpwYXNz' };
    assert.equal(await broadcastSignedTransaction('deadbeef', settings, async (url, options) => {
        calls++;
        assert.equal(url, rpc.url);
        assert.equal(options.method, 'POST');
        assert.equal(options.headers.Authorization, settings.authorization);
        assert.equal(options.credentials, 'omit');
        assert.equal(options.redirect, 'error');
        assert.deepEqual(JSON.parse(options.body).params, ['deadbeef']);
        return response(JSON.stringify({ result: txid, error: null, id: 'dogecoin-wallet' }));
    }), txid);
    assert.equal(calls, 1);
});
