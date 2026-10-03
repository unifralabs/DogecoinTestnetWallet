import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCustomUtxos, dogeToKoinu, formatDoge } from '../js/custom-utxos.js';

const context = { address: 'test-wallet', scriptPubKey: `76a914${'ab'.repeat(20)}88ac` };
const row = { txid: '01'.repeat(32), vout: 2, value: '900590091070537' };
const parse = data => parseCustomUtxos(JSON.stringify(data), context);

test('imports exact koinu values, including integers above Number.MAX_SAFE_INTEGER as strings', () => {
    assert.equal(parse([row])[0].value, row.value);
    assert.equal(parse([{ ...row, value: '9007199254740993' }])[0].value, '9007199254740993');
    assert.equal(formatDoge(row.value), '9005900.91070537');
    assert.equal(dogeToKoinu('10000'), 1000000000000n);
});

test('imports prepare responses and saved response wrapper; ignores provided sighashes and outputs', () => {
    const inputs = [{ transactionId: row.txid, outputIndex: 2, satoshis: 2663807000, script: context.scriptPubKey, address: context.address, sighash: 'untrusted' }];
    for (const payload of [{ inputs }, { data: { item: { inputs, outputs: [] } } }, { network: 'dogecoin/testnet', apiResponse: { data: { item: { inputs } } } }]) {
        assert.deepEqual(parse(payload)[0], { txid: row.txid, vout: 2, value: '2663807000', scriptPubKey: context.scriptPubKey });
    }
});

test('imports Crypto APIs historical and Esplora formats', () => {
    assert.equal(parse({ data: { items: [{ transactionId: row.txid, index: 2, value: { amount: '26.63807000', unit: 'DOGE' }, isAvailable: true, isConfirmed: true }] } })[0].value, '2663807000');
    assert.equal(parse([{ ...row, status: { confirmed: true } }])[0].value, row.value);
});

test('rejects duplicates, malformed references, unsafe values and explicit unavailable states', () => {
    assert.throws(() => parse([row, row]), /Duplicate/);
    for (const patch of [{ txid: 'x'.repeat(64) }, { vout: -1 }, { vout: 4294967296 }, { vout: true }, { value: 1.5 }, { value: 9007199254740992 }, { value: '0' }, { value: '-1' }, { value: '18446744073709551616' }, { isSpent: true }, { isAvailable: false }, { isConfirmed: false }, { status: { confirmed: false } }]) {
        assert.throws(() => parse([{ ...row, ...patch }]));
    }
    for (const text of ['1e3', '1.000000001', '-1', 'Infinity']) assert.throws(() => dogeToKoinu(text));
});

test('rejects foreign scripts, addresses, networks and currencies', () => {
    for (const patch of [{ address: 'someone-else' }, { addresses: ['someone-else'] }, { scriptPubKey: `a914${'ab'.repeat(20)}87` }, { script: `76a914${'ff'.repeat(20)}88ac` }, { unit: 'BTC' }]) {
        assert.throws(() => parse([{ ...row, ...patch }]));
    }
    assert.throws(() => parse({ network: 'mainnet', utxos: [row] }), /testnet/);
});

test('rejects empty, invalid and overflowing imports', () => {
    assert.throws(() => parseCustomUtxos('bad json', context), /Invalid/);
    assert.throws(() => parse([]), /No UTXOs/);
    assert.throws(() => parse([null]), /UTXO 1/);
    assert.throws(() => parse([{ ...row, value: '18446744073709551615' }, { ...row, vout: 1 }]), /Total/);
    assert.throws(() => parseCustomUtxos(JSON.stringify([row]), { address: null }), /wallet/);
});
