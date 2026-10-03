import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPublicKey, ECDH, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseCustomUtxos } from '../js/custom-utxos.js';

// Use Node/OpenSSL hashing and signature verification, independently of the wallet signer.
class WordArray {
    constructor(bytes) { this.bytes = bytes; }
    toString() { return this.bytes.toString('hex'); }
}
const hash = (name, data) => new WordArray(createHash(name).update(data.bytes).digest());
globalThis.window = { CryptoJS: { enc: { Hex: { parse: hex => new WordArray(Buffer.from(hex, 'hex')) } }, SHA256: data => hash('sha256', data), RIPEMD160: data => hash('ripemd160', data) } };
globalThis.CryptoJS = window.CryptoJS;
globalThis.document = { addEventListener() {} };
vm.runInThisContext(await readFile(new URL('../crypto-libs.js', import.meta.url), 'utf8'));
globalThis.bs58 = window.bs58;
const { wallet } = await import('../js/wallet.js');
const { createActualTransaction, createScriptPubKey } = await import('../js/transaction.js');
const sha = buffer => createHash('sha256').update(buffer).digest();
const le = (number, length) => { const b = Buffer.alloc(length); if (length === 8) b.writeBigUInt64LE(BigInt(number)); else b.writeUIntLE(Number(number), 0, length); return b; };
const addressFor = pub => {
    const payload = Buffer.concat([Buffer.from([0x71]), createHash('ripemd160').update(sha(Buffer.from(pub, 'hex'))).digest()]);
    return bs58.encode(Buffer.concat([payload, sha(sha(payload)).subarray(0, 4)]));
};
const key = '1'.padStart(64, '0'); // Public test vector, never a real wallet.
const pub = new window.elliptic.ec('secp256k1').keyFromPrivate(key, 'hex').getPublic(true, 'hex');
wallet.address = addressFor(pub);
wallet.privateKey = key;

function decode(hex) {
    const data = Buffer.from(hex, 'hex'); let offset = 0;
    const take = n => { const v = data.subarray(offset, offset + n); offset += n; return v; };
    const size = () => { const p = take(1)[0]; return p < 253 ? p : Number(take(p === 253 ? 2 : p === 254 ? 4 : 8).readUIntLE(0, p === 253 ? 2 : 4)); };
    const version = take(4);
    const inputCount = size(); const inputs = [];
    for (let i = 0; i < inputCount; i++) inputs.push({ txid: take(32), vout: take(4), script: take(size()), sequence: take(4) });
    const count = size(); const outputs = [];
    for (let i = 0; i < count; i++) outputs.push({ value: take(8), script: take(size()) });
    const locktime = take(4); assert.equal(offset, data.length);
    return { version, inputs, outputs, locktime };
}

test('custom inputs produce valid signatures and exact 10,000 DOGE output / large change', async () => {
    const scriptPubKey = createScriptPubKey(wallet.address);
    const rows = [6n * 100000000n, 900590091070537n].map((value, i) => ({ txid: (i ? 'ab' : 'cd').repeat(32), vout: i, value: String(value), scriptPubKey }));
    const selectedUtxos = parseCustomUtxos(JSON.stringify(rows), { address: wallet.address, scriptPubKey });
    const built = await createActualTransaction({ selectedUtxos, recipientAddress: wallet.address, changeAddress: wallet.address, privateKeyHex: key, amountToSendSatoshis: 1000000000000, feeSatoshis: 100000000 });
    const tx = decode(built.rawTxHex);
    assert.equal(tx.inputs.length, 2);
    assert.equal(tx.outputs[0].value.readBigUInt64LE(), 1000000000000n);
    const total = selectedUtxos.reduce((sum, u) => sum + BigInt(u.value), 0n);
    assert.equal(tx.outputs[1].value.readBigUInt64LE(), total - 1000000000000n - 100000000n);
    assert.equal(built.feeKoinu, '100000000');
    for (const [i, input] of tx.inputs.entries()) {
        assert.equal(Buffer.from(input.txid).reverse().toString('hex'), selectedUtxos[i].txid);
        assert.equal(input.vout.readUInt32LE(), selectedUtxos[i].vout);
        const sigLength = input.script[0];
        const signature = input.script.subarray(1, sigLength); // Excludes SIGHASH_ALL byte.
        assert.equal(input.script[sigLength], 1);
        const publicKey = input.script.subarray(sigLength + 2);
        const uncompressed = ECDH.convertKey(publicKey, 'secp256k1', undefined, undefined, 'uncompressed');
        const verifyingKey = createPublicKey({ key: { kty: 'EC', crv: 'secp256k1', x: uncompressed.subarray(1, 33).toString('base64url'), y: uncompressed.subarray(33).toString('base64url') }, format: 'jwk' });
        const preimage = Buffer.concat([tx.version, Buffer.from([tx.inputs.length]), ...tx.inputs.flatMap((v, j) => {
            const script = j === i ? Buffer.from(scriptPubKey, 'hex') : Buffer.alloc(0);
            return [v.txid, v.vout, Buffer.from([script.length]), script, v.sequence];
        }), Buffer.from([tx.outputs.length]), ...tx.outputs.flatMap(v => [v.value, Buffer.from([v.script.length]), v.script]), tx.locktime, le(1, 4)]);
        assert.equal(verify('sha256', sha(preimage), verifyingKey, signature), true, `signature ${i}`);
    }
});

test('insufficient imported funds fail; dust change is included in the reported fee', async () => {
    const opts = { selectedUtxos: [{ txid: 'ab'.repeat(32), vout: 0, value: '100050000' }], recipientAddress: wallet.address, changeAddress: wallet.address, privateKeyHex: key, amountToSendSatoshis: 100000000, feeSatoshis: 1000 };
    const built = await createActualTransaction(opts);
    assert.equal(built.feeKoinu, '50000');
    assert.equal(built.changeKoinu, '0');
    assert.equal(decode(built.rawTxHex).outputs.length, 1);
    await assert.rejects(createActualTransaction({ ...opts, amountToSendSatoshis: 200000000 }), /Insufficient funds/);
});

test('recipient checksum and network are validated', () => {
    assert.throws(() => createScriptPubKey(wallet.address.slice(0, -1) + '0'));
    assert.throws(() => createScriptPubKey('1BoatSLRHtKNngkdXEeobR76b53LETtpyT'), /Unsupported/);
});
