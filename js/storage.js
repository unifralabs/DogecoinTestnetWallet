import { getElectrsUrl } from './network.js';
import { wallet } from './wallet.js';

const DB_NAME = 'dogecoin_wallet_db';
const DB_VERSION = 2; // Increment this version
const WALLET_STORE = 'wallets';
const BROADCASTED_TX_STORE = 'broadcasted_txs';

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = function (event) {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(WALLET_STORE)) {
                db.createObjectStore(WALLET_STORE, { keyPath: 'address' });
            }
            if (!db.objectStoreNames.contains(BROADCASTED_TX_STORE)) {
                const txStore = db.createObjectStore(BROADCASTED_TX_STORE, { keyPath: ['address', 'txid'] });
                txStore.createIndex('by_address_status', ['address', 'status'], { unique: false });
                txStore.createIndex('by_address', 'address', { unique: false });
            }
        };

        request.onsuccess = function (event) {
            resolve(event.target.result);
        };

        request.onerror = function (event) {
            reject(event.target.error);
        };
    });
}

function saveWalletToDB(wallet) {
    return openDatabase().then(db => {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(WALLET_STORE, 'readwrite');
            const store = transaction.objectStore(WALLET_STORE);
            const request = store.put(wallet);

            request.onsuccess = function () {
                resolve();
            };

            request.onerror = function (event) {
                reject(event.target.error);
            };
        });
    });
}

function getWalletFromDB(address) {
    return openDatabase().then(db => {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(WALLET_STORE, 'readonly');
            const store = transaction.objectStore(WALLET_STORE);
            const request = store.get(address);

            request.onsuccess = function (event) {
                resolve(event.target.result);
            };

            request.onerror = function (event) {
                reject(event.target.error);
            };
        });
    });
}

function deleteWalletFromDB(address) {
    return openDatabase().then(db => {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(WALLET_STORE, 'readwrite');
            const store = transaction.objectStore(WALLET_STORE);
            const request = store.delete(address);

            transaction.oncomplete = function() {
                console.log('Transaction completed: wallet deleted');
                resolve();
            };

            transaction.onerror = function(event) {
                console.error('Transaction error:', event.target.error);
                reject(event.target.error);
            };
        });
    });
}

function getAllWallets() {
    return openDatabase().then(db => {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(WALLET_STORE, 'readonly');
            const store = transaction.objectStore(WALLET_STORE);
            const request = store.getAll();

            request.onsuccess = function () {
                resolve(request.result);
            };

            request.onerror = function (event) {
                reject(event.target.error);
            };
        });
    });
}

function updateWalletList(addressToSelect) {
    getAllWallets().then(wallets => {
        const select = document.getElementById('walletSelect');
        if (!select) return;

        const currentValue = addressToSelect || select.value;

        select.innerHTML = '';
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = '选择钱包';
        select.appendChild(defaultOption);

        wallets.forEach(wallet => {
            const option = document.createElement('option');
            option.value = wallet.address;
            option.textContent = `${wallet.label || '未命名钱包'} (${wallet.address})`;
            select.appendChild(option);

            if (wallet.address === currentValue) {
                option.selected = true;
            }
        });

        console.log('Wallet list updated, selected address:', currentValue);
    }).catch(error => {
        console.error('Failed to update wallet list:', error);
    });
}

async function saveBroadcastedTxToDB(txDetails, currentAddress) {
    // Ensure txDetails includes address, txid, amount, recipient, fee, broadcastTime, and an initial status
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(BROADCASTED_TX_STORE, 'readwrite');
        const store = transaction.objectStore(BROADCASTED_TX_STORE);
        // Add a default status if not present, and ensure the address from the current wallet context is used.
            const txToSave = {
                ...txDetails,
                address: currentAddress, // 使用传入的地址
            status: txDetails.status || 'pending' 
        };
        if (!txToSave.address) {
            reject(new Error("Cannot save transaction without an address."));
            return;
        }
        const request = store.put(txToSave);

        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.error);
    });
}

async function getBroadcastedTxsFromDB(address) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(BROADCASTED_TX_STORE, 'readonly');
        const store = transaction.objectStore(BROADCASTED_TX_STORE);
        
        const index = store.index('by_address'); // Use the index for 'address'
        const request = index.getAll(address); // Get all transactions for the given address

        request.onsuccess = (event) => {
            const walletTxs = event.target.result;
            resolve(walletTxs.sort((a, b) => b.broadcastTime - a.broadcastTime)); // 按时间排序
        };
        request.onerror = (event) => reject(event.target.error);
    });
}

async function getPendingTxsFromDB(address) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(BROADCASTED_TX_STORE, 'readonly');
        const store = transaction.objectStore(BROADCASTED_TX_STORE);
        const index = store.index('by_address_status');
        // Query for transactions with address and status 'pending'
        const request = index.getAll(IDBKeyRange.only([address, 'pending']));

        request.onsuccess = (event) => {
            resolve(event.target.result.sort((a, b) => b.broadcastTime - a.broadcastTime));
        };
        request.onerror = (event) => reject(event.target.error);
    });
}

async function updateTxStatusInDB(txKey, newStatusDetails) {
    // txKey would be { address: wallet.address, txid: tx.txid }
    // newStatusDetails would be { status: 'confirmed', block_height: 123, block_time: ... }
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(BROADCASTED_TX_STORE, 'readwrite');
        const store = transaction.objectStore(BROADCASTED_TX_STORE);
        const getRequest = store.get(txKey); // txKey should be an array: [address, txid]

        getRequest.onsuccess = () => {
            const txToUpdate = getRequest.result;
            if (txToUpdate) {
                const updatedTx = { ...txToUpdate, ...newStatusDetails };
                const putRequest = store.put(updatedTx);
                putRequest.onsuccess = () => resolve(updatedTx);
                putRequest.onerror = (event) => reject(event.target.error);
            } else {
                reject(new Error('Transaction not found for update. Key: ' + JSON.stringify(txKey)));
            }
        };
        getRequest.onerror = (event) => reject(event.target.error);
    });
}

export {
    saveBroadcastedTxToDB,
    getBroadcastedTxsFromDB,
    getPendingTxsFromDB,
    updateTxStatusInDB,
    openDatabase,
    saveWalletToDB,
    getWalletFromDB,
    deleteWalletFromDB,
    getAllWallets,
    updateWalletList
};
