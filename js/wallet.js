import { generatePrivateKey, getPublicKey, DOGECOIN_TESTNET, sha256Double, hash160 } from './crypto-utils.js';
import { saveWalletToDB, getWalletFromDB, deleteWalletFromDB, updateWalletList } from './storage.js';
import { showAlert, updateWalletUI } from './ui.js';

let wallet = {
    privateKey: null,
    address: null,
    wif: null,
    label: '',
    balance: 0,
    balanceAvailable: false
};

function privateKeyToWIF(privateKeyHex) {
    const extended = DOGECOIN_TESTNET.wif.toString(16).padStart(2, '0') + privateKeyHex + '01';
    const hash = sha256Double(window.CryptoJS.enc.Hex.parse(extended));
    const checksum = hash.toString().substring(0, 8);
    const fullHex = extended + checksum;
    const bytes = [];
    for (let i = 0; i < fullHex.length; i += 2) {
        bytes.push(parseInt(fullHex.substr(i, 2), 16));
    }
    return window.bs58.encode(bytes);
}

function wifToPrivateKey(wif) {
    try {
        const decoded = bs58.decode(wif);
        const hex = decoded.map(b => b.toString(16).padStart(2, '0')).join('');
        const payload = hex.substring(0, hex.length - 8);
        const checksum = hex.substring(hex.length - 8);
        const hash = sha256Double(CryptoJS.enc.Hex.parse(payload));
        const expectedChecksum = hash.toString().substring(0, 8);
        
        if (checksum !== expectedChecksum) {
            throw new Error('Invalid checksum');
        }
        
        return hex.substring(2, hex.length - 10);
    } catch (error) {
        throw new Error('Invalid WIF format');
    }
}

function publicKeyToAddress(publicKeyHex) {
    const publicKeyBytes = CryptoJS.enc.Hex.parse(publicKeyHex);
    const hash160Result = hash160(publicKeyBytes);
    const versionedHash = DOGECOIN_TESTNET.pubKeyHash.toString(16).padStart(2, '0') + hash160Result.toString();
    const hash = sha256Double(CryptoJS.enc.Hex.parse(versionedHash));
    const checksum = hash.toString().substring(0, 8);
    const fullHex = versionedHash + checksum;
    const bytes = [];
    for (let i = 0; i < fullHex.length; i += 2) {
        bytes.push(parseInt(fullHex.substr(i, 2), 16));
    }
    return bs58.encode(bytes);
}

function isValidAddress(address) {
    try {
        const decoded = bs58.decode(address);
        const hex = decoded.map(b => b.toString(16).padStart(2, '0')).join('');
        
        if (hex.length !== 50) return false;
        
        const payload = hex.substring(0, 42);
        const checksum = hex.substring(42);
        const hash = sha256Double(CryptoJS.enc.Hex.parse(payload));
        const expectedChecksum = hash.toString().substring(0, 8);
        
        return checksum === expectedChecksum;
    } catch (error) {
        return false;
    }
}

function generateWallet() {
    try {
        const privateKeyHex = generatePrivateKey();
        const publicKeyHex = getPublicKey(privateKeyHex);
        const wif = privateKeyToWIF(privateKeyHex);
        const address = publicKeyToAddress(publicKeyHex);

        wallet.privateKey = privateKeyHex;
        wallet.address = address;
        wallet.wif = wif;
        wallet.label = '新钱包';
        wallet.balance = 0;
        wallet.balanceAvailable = false;

        saveCurrentWallet();
        updateWalletUI();
        updateWalletList(address);
        
        showAlert('新钱包已生成', 'success');
    } catch (error) {
        showAlert(`生成钱包失败: ${error.message}`, 'error');
    }
}

function saveCurrentWallet() {
    if (wallet.address) {
        saveWalletToDB(wallet).then(() => {
            console.log('Wallet saved to IndexedDB');
            updateWalletList(wallet.address);
        }).catch(error => {
            console.error('Failed to save wallet:', error);
        });
    }
}

function loadWallet(address) {
    return getWalletFromDB(address).then(storedWallet => {
        if (storedWallet) {
            wallet.privateKey = storedWallet.privateKey;
            wallet.address = storedWallet.address;
            wallet.label = storedWallet.label;
            wallet.balance = storedWallet.balance;
            if (storedWallet.wif) {
                wallet.wif = storedWallet.wif;
            } else if (storedWallet.privateKey) { // Fallback for older data
                wallet.wif = privateKeyToWIF(storedWallet.privateKey);
            }
            wallet.balanceAvailable = storedWallet.balanceAvailable;
            updateWalletUI();
            console.log('Wallet loaded from IndexedDB:', wallet.address);
        } else {
            console.error('Wallet not found in IndexedDB:', address);
            showAlert('钱包未找到', 'error');
        }
    }).catch(error => {
        console.error('Failed to load wallet:', error);
        showAlert('加载钱包失败', 'error');
    });
}

function deleteCurrentWallet() {
    if (wallet.address) {
        deleteWalletFromDB(wallet.address).then(() => {
            console.log('Wallet deleted from IndexedDB');
            clearCurrentWallet();
            updateWalletUI();
            updateWalletList();
            showAlert('钱包已删除', 'success');
        }).catch(error => {
            console.error('Failed to delete wallet:', error);
            showAlert('删除钱包失败: ' + error.message, 'error');
        });
    }
}

function clearCurrentWallet() {
    wallet.privateKey = null;
    wallet.address = null;
    wallet.wif = null;
    wallet.label = '';
    wallet.balance = 0;
    wallet.balanceAvailable = false;
    updateWalletUI();
}

function importWallet() {
    try {
        const wifInput = document.getElementById('importPrivateKey').value.trim();
        if (!wifInput) {
            showAlert('请输入私钥', 'error');
            return;
        }

        const privateKeyHex = wifToPrivateKey(wifInput);
        const publicKeyHex = getPublicKey(privateKeyHex);
        const address = publicKeyToAddress(publicKeyHex);

        wallet.privateKey = privateKeyHex;
        wallet.address = address;
        wallet.wif = wifInput; // User input is WIF
        wallet.label = '导入钱包';
        wallet.balance = 0;
        wallet.balanceAvailable = false;

        saveCurrentWallet();
        updateWalletUI();
        showAlert('钱包已导入', 'success');
    } catch (error) {
        showAlert(`导入钱包失败: ${error.message}`, 'error');
    }
}

export {
    wallet,
    generateWallet,
    importWallet,
    loadWallet,
    deleteCurrentWallet,
    clearCurrentWallet,
    isValidAddress,
    wifToPrivateKey
};
