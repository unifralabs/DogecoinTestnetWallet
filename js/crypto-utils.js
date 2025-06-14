const DOGECOIN_TESTNET = {
    pubKeyHash: 0x71,
    scriptHash: 0xc4,
    wif: 0xf1
};

let secp256k1;

function initializeCrypto() {
    try {
        const EC = window.elliptic.ec;
        secp256k1 = new EC('secp256k1');
        return true;
    } catch (error) {
        console.error('Failed to initialize crypto:', error);
        return false;
    }
}

function sha256(data) {
    return window.CryptoJS.SHA256(data);
}

function sha256Double(data) {
    return sha256(sha256(data));
}

function ripemd160(data) {
    return window.CryptoJS.RIPEMD160(data);
}

function hash160(data) {
    return ripemd160(sha256(data));
}

function generatePrivateKey() {
    const keyPair = secp256k1.genKeyPair();
    return keyPair.getPrivate('hex');
}

function getPublicKey(privateKeyHex) {
    const keyPair = secp256k1.keyFromPrivate(privateKeyHex, 'hex');
    return keyPair.getPublic('hex');
}

export {
    DOGECOIN_TESTNET,
    initializeCrypto,
    sha256,
    sha256Double,
    ripemd160,
    hash160,
    generatePrivateKey,
    getPublicKey
};
