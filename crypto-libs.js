/**
 * Local Crypto Libraries for Dogecoin Wallet
 * Includes Base58, secp256k1, and other utilities
 */

// Base58 encoding/decoding implementation
(function() {
    'use strict';
    
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const ALPHABET_MAP = {};
    
    for (let i = 0; i < ALPHABET.length; i++) {
        ALPHABET_MAP[ALPHABET.charAt(i)] = i;
    }
    
    const BASE = 58;
    
    function encode(buffer) {
        if (buffer.length === 0) return '';
        
        let digits = [0];
        for (let i = 0; i < buffer.length; i++) {
            let carry = buffer[i];
            for (let j = 0; j < digits.length; j++) {
                carry += digits[j] << 8;
                digits[j] = carry % BASE;
                carry = Math.floor(carry / BASE);
            }
            
            while (carry > 0) {
                digits.push(carry % BASE);
                carry = Math.floor(carry / BASE);
            }
        }
        
        // Deal with leading zeros
        let k = 0;
        while (k < buffer.length && buffer[k] === 0) {
            k++;
        }
        
        let string = '';
        for (let i = 0; i < k; i++) {
            string += ALPHABET[0];
        }
        for (let i = digits.length - 1; i >= 0; i--) {
            string += ALPHABET[digits[i]];
        }
        
        return string;
    }
    
    function decode(string) {
        if (string.length === 0) return new Uint8Array(0);
        
        let bytes = [0];
        for (let i = 0; i < string.length; i++) {
            const char = string[i];
            if (!(char in ALPHABET_MAP)) {
                throw new Error('Invalid character: ' + char);
            }
            
            let carry = ALPHABET_MAP[char];
            for (let j = 0; j < bytes.length; j++) {
                carry += bytes[j] * BASE;
                bytes[j] = carry & 0xff;
                carry >>= 8;
            }
            
            while (carry > 0) {
                bytes.push(carry & 0xff);
                carry >>= 8;
            }
        }
        
        // Deal with leading zeros
        let k = 0;
        while (k < string.length && string[k] === ALPHABET[0]) {
            k++;
        }
        
        const result = new Uint8Array(k + bytes.length);
        for (let i = 0; i < k; i++) {
            result[i] = 0;
        }
        for (let i = 0; i < bytes.length; i++) {
            result[k + i] = bytes[bytes.length - 1 - i];
        }
        
        return result;
    }
    
    // Export bs58
    window.bs58 = {
        encode: function(buffer) {
            if (Array.isArray(buffer)) {
                buffer = new Uint8Array(buffer);
            }
            return encode(buffer);
        },
        decode: function(string) {
            return Array.from(decode(string));
        }
    };
})();

// Simplified elliptic curve implementation for secp256k1
(function() {
    'use strict';
    
    // secp256k1 parameters
    const P = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F');
    const N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
    const G = {
        x: BigInt('0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798'),
        y: BigInt('0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8')
    };
    
    function mod(a, m) {
        return ((a % m) + m) % m;
    }
    
    function modInverse(a, m) {
        if (a < 0n) a = mod(a, m);
        let [old_r, r] = [a, m];
        let [old_s, s] = [1n, 0n];
        
        while (r !== 0n) {
            const quotient = old_r / r;
            [old_r, r] = [r, old_r - quotient * r];
            [old_s, s] = [s, old_s - quotient * s];
        }
        
        return mod(old_s, m);
    }
    
    function pointAdd(p1, p2) {
        if (!p1) return p2;
        if (!p2) return p1;
        if (p1.x === p2.x) {
            if (p1.y === p2.y) {
                return pointDouble(p1);
            } else {
                return null; // Point at infinity
            }
        }
        
        const s = mod((p2.y - p1.y) * modInverse(p2.x - p1.x, P), P);
        const x3 = mod(s * s - p1.x - p2.x, P);
        const y3 = mod(s * (p1.x - x3) - p1.y, P);
        
        return { x: x3, y: y3 };
    }
    
    function pointDouble(p) {
        if (!p) return null;
        
        const s = mod((3n * p.x * p.x) * modInverse(2n * p.y, P), P);
        const x3 = mod(s * s - 2n * p.x, P);
        const y3 = mod(s * (p.x - x3) - p.y, P);
        
        return { x: x3, y: y3 };
    }
    
    function pointMultiply(k, p) {
        if (k === 0n) return null;
        if (k === 1n) return p;
        
        let result = null;
        let addend = p;
        
        while (k > 0n) {
            if (k & 1n) {
                result = pointAdd(result, addend);
            }
            addend = pointDouble(addend);
            k >>= 1n;
        }
        
        return result;
    }
    
    function generatePrivateKey() {
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        let privateKey = 0n;
        for (let i = 0; i < 32; i++) {
            privateKey = (privateKey << 8n) + BigInt(array[i]);
        }
        return mod(privateKey, N);
    }
    
    function getPublicKey(privateKey) {
        if (typeof privateKey === 'string') {
            privateKey = BigInt('0x' + privateKey);
        }
        const point = pointMultiply(privateKey, G);
        if (!point) throw new Error('Invalid private key');
        
        // Compressed public key format
        const prefix = point.y % 2n === 0n ? '02' : '03';
        const x = point.x.toString(16).padStart(64, '0');
        return prefix + x;
    }
    
    function signMessage(privateKey, messageHash) {
        if (typeof privateKey === 'string') {
            privateKey = BigInt('0x' + privateKey);
        }
        if (typeof messageHash === 'string') {
            messageHash = BigInt('0x' + messageHash);
        }
        
        let k, r, s;
        do {
            // Generate random k
            const kArray = new Uint8Array(32);
            crypto.getRandomValues(kArray);
            k = 0n;
            for (let i = 0; i < 32; i++) {
                k = (k << 8n) + BigInt(kArray[i]);
            }
            k = mod(k, N);
            if (k === 0n) continue;
            
            // Calculate r = (k * G).x mod n
            const point = pointMultiply(k, G);
            if (!point) continue;
            r = mod(point.x, N);
            if (r === 0n) continue;
            
            // Calculate s = k^-1 * (hash + r * privateKey) mod n
            const kInv = modInverse(k, N);
            s = mod(kInv * (messageHash + r * privateKey), N);
            
        } while (r === 0n || s === 0n);
        
        // Ensure s is in lower half of N (canonical signature)
        if (s > N / 2n) {
            s = N - s;
        }
        
        return { r, s };
    }
    
    function signatureToDER(signature) {
        const { r, s } = signature;
        
        console.log('DER encoding signature:', { r: r.toString(16), s: s.toString(16) });
        
        // Convert r and s to byte arrays
        let rBytes = r.toString(16);
        if (rBytes.length % 2) rBytes = '0' + rBytes;
        if (parseInt(rBytes.substring(0, 2), 16) >= 0x80) {
            rBytes = '00' + rBytes;
        }
        
        let sBytes = s.toString(16);
        if (sBytes.length % 2) sBytes = '0' + sBytes;
        if (parseInt(sBytes.substring(0, 2), 16) >= 0x80) {
            sBytes = '00' + sBytes;
        }
        
        console.log('DER r bytes:', rBytes, 'length:', rBytes.length / 2);
        console.log('DER s bytes:', sBytes, 'length:', sBytes.length / 2);
        
        // Build DER encoding
        const rLength = (rBytes.length / 2).toString(16).padStart(2, '0');
        const sLength = (sBytes.length / 2).toString(16).padStart(2, '0');
        const totalLength = (2 + rBytes.length / 2 + 2 + sBytes.length / 2).toString(16).padStart(2, '0');
        
        const derSignature = '30' + totalLength + '02' + rLength + rBytes + '02' + sLength + sBytes;
        console.log('Final DER signature:', derSignature, 'length:', derSignature.length / 2);
        
        return derSignature;
    }
    
    // Export elliptic
    window.elliptic = {
        ec: function(curve) {
            if (curve !== 'secp256k1') {
                throw new Error('Only secp256k1 is supported');
            }
            
            return {
                genKeyPair: function() {
                    const privateKey = generatePrivateKey();
                    return {
                        getPrivate: function(format) {
                            if (format === 'hex') {
                                return privateKey.toString(16).padStart(64, '0');
                            }
                            return privateKey;
                        },
                        getPublic: function(format) {
                            const pubKey = getPublicKey(privateKey);
                            if (format === 'hex') {
                                return pubKey;
                            }
                            return pubKey;
                        },
                        sign: function(messageHash) {
                            const signature = signMessage(privateKey, messageHash);
                            return {
                                r: signature.r,
                                s: signature.s,
                                toDER: function() {
                                    return signatureToDER(signature);
                                }
                            };
                        }
                    };
                },
                keyFromPrivate: function(privateKey, format) {
                    if (format === 'hex') {
                        privateKey = BigInt('0x' + privateKey);
                    }
                    return {
                        getPrivate: function(format) {
                            if (format === 'hex') {
                                return privateKey.toString(16).padStart(64, '0');
                            }
                            return privateKey;
                        },
                        getPublic: function(format) {
                            const pubKey = getPublicKey(privateKey);
                            if (format === 'hex') {
                                return pubKey;
                            }
                            return pubKey;
                        },
                        sign: function(messageHash) {
                            const signature = signMessage(privateKey, messageHash);
                            return {
                                r: signature.r,
                                s: signature.s,
                                toDER: function() {
                                    return signatureToDER(signature);
                                }
                            };
                        }
                    };
                }
            };
        }
    };
})();

console.log('Local crypto libraries loaded successfully'); 