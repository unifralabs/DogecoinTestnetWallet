import { initializeCrypto } from './crypto-utils.js';
import { wallet, generateWallet, loadWallet, deleteCurrentWallet, importWallet } from './wallet.js';
import { fetchBalance, useElectrs, useElectrsProxy } from './network.js';
import { showAlert, updateWalletUI, copyToClipboard } from './ui.js';
import { testConnection, calculateFee, sendTransaction, openInBrowser, viewPendingTransactions, viewBroadcastedTransactions, refreshWalletTransactionHistory, loadPersistedBroadcastedTransactions, checkPendingTransactionsStatus } from './transaction.js';
import { updateWalletList } from './storage.js';

let autoRefreshInterval = null;
const AUTO_REFRESH_INTERVAL = 3000;

let blockInfoInterval = null;
const BLOCK_INFO_REFRESH_INTERVAL = 1000;
const TX_STATUS_CHECK_INTERVAL = 2000;

async function initializeApp() {
    try {
        console.log('Loading dependencies...');
        await window.initDeps().catch(error => {
            console.error('Failed to load dependencies:', error);
            throw error;
        });

        console.log('Verifying dependencies...');
        if (!window.CryptoJS) {
            throw new Error('CryptoJS failed to load properly');
        }
        if (!window.bs58) {
            throw new Error('Base58 library failed to load properly');
        }
        if (!window.elliptic) {
            throw new Error('Elliptic curve encryption library failed to load properly');
        }

        console.log('Dependencies verified, initializing crypto...');
        if (initializeCrypto()) {
            console.log('Crypto initialized, setting up app...');
            restoreWallet();
            addEventListeners();
            startAutoRefresh();
            await Promise.all([
                loadPersistedBroadcastedTransactions(), // Load on init
                refreshWalletTransactionHistory()
            ]);
            checkPendingTransactionsStatus(); // Initial check after loading persisted transactions
            updateWalletList();
        } else {
            throw new Error('Crypto module initialization failed');
        }
    } catch (error) {
        console.error('Failed to initialize app:', error);
        showAlert('Application initialization failed: ' + error.message, 'error');
        throw error;
    }
}

async function refreshBalance() {
    if (wallet.address) {
        showAlert('Refreshing balance...', 'info');
        try {
            const result = await fetchBalance(wallet.address);
            wallet.balance = result.balance / 100000000;
            wallet.balanceAvailable = true;
            updateWalletUI();
            showAlert('Balance updated', 'success');
        } catch (error) {
            console.error('Manual balance refresh failed:', error);
            wallet.balanceAvailable = false; // Indicates balance may be outdated
            updateWalletUI(); // Update UI even on error to reflect unavailable state
            showAlert('Balance refresh failed: ' + error.message, 'error');
        }
    } else {
        // If no active wallet, clear balance display or prompt to select wallet
        wallet.balance = 0;
        wallet.balanceAvailable = false;
        updateWalletUI();
        // showAlert('Please select or generate a wallet first', 'info'); // Optional prompt
    }
}

function restoreWallet() {
    const currentAddress = localStorage.getItem('current_wallet_address');
    if (currentAddress) {
        loadWallet(currentAddress)
            .then(async () => {
                await Promise.all([refreshBalance(), refreshWalletTransactionHistory(), loadPersistedBroadcastedTransactions()]);
                checkPendingTransactionsStatus(); // Also check status after loading wallet
            })
            .catch(error => {
                console.error("Failed to load or refresh history when restoring wallet:", error);
                Promise.all([refreshBalance(), loadPersistedBroadcastedTransactions(), refreshWalletTransactionHistory()]);
            });
    } else {
        updateWalletUI();
        // Ensure lists are cleared if no wallet
        // and no pending status check is needed if no wallet.
        Promise.resolve(loadPersistedBroadcastedTransactions()).then(() => {
            viewPendingTransactions(); // Clear UI if no wallet
            viewBroadcastedTransactions();
        });
        refreshWalletTransactionHistory();
    }
}

function startAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }

    autoRefreshInterval = setInterval(async () => {
        if (wallet.address) {
            try {
                const result = await fetchBalance(wallet.address);
                wallet.balance = result.balance / 100000000;
                wallet.balanceAvailable = true;
                updateWalletUI();
            } catch (error) {
                console.error('Auto refresh failed:', error);
            }
        }
    }, AUTO_REFRESH_INTERVAL);

    console.log('Auto refresh started (every 30 seconds)');
    updateAutoRefreshStatus();
}


function updateAutoRefreshStatus() {
    const statusElement = document.getElementById('autoRefreshStatus');
    if (statusElement) {
        if (autoRefreshInterval) {
            statusElement.textContent = '🔄 Auto refresh: 30s';
            statusElement.style.color = '#28a745';
        } else {
            statusElement.textContent = '⏸️ Auto refresh: Stopped';
            statusElement.style.color = '#666';
        }
    }
}

function updateBlockInfoStatus() {
    const statusElement = document.getElementById('blockInfoStatus');
    if (statusElement) {
        if (blockInfoInterval) {
            statusElement.textContent = '🔄 Auto refresh: 1s';
            statusElement.style.color = '#28a745';
        } else {
            statusElement.textContent = '⏸️ Auto refresh: Stopped';
            statusElement.style.color = '#666';
        }
    }
}

function addEventListeners() {
    console.log('Setting up event listeners...');

    const generateWalletBtn = document.getElementById('generateWalletBtn');
    if (generateWalletBtn) {
        console.log('Found generate wallet button, adding click listener');
        generateWalletBtn.addEventListener('click', () => {
            console.log('Generate wallet button clicked');
            generateWallet();
            // After generating wallet, address is in wallet object, can immediately refresh balance and history
            Promise.all([
                refreshBalance(),
                loadPersistedBroadcastedTransactions(), // Clear/load for new wallet
                refreshWalletTransactionHistory()
            ]).then(() => checkPendingTransactionsStatus());
        });
    } else {
        console.error('Generate wallet button not found');
    }

    const walletSelect = document.getElementById('walletSelect');
    if (walletSelect) {
        console.log('Found wallet select, adding change listener');
        walletSelect.addEventListener('change', (e) => {
            const selectedAddress = e.target.value;
            if (selectedAddress) {
                console.log('Loading wallet:', selectedAddress);
                loadWallet(selectedAddress)
                    .then(async () => {
                        await Promise.all([refreshBalance(), refreshWalletTransactionHistory(), loadPersistedBroadcastedTransactions()]);
                        checkPendingTransactionsStatus();
                    })
                    .catch(error => {
                        console.error("Failed to load or refresh history when selecting wallet:", error);
                        Promise.all([refreshBalance(), loadPersistedBroadcastedTransactions(), refreshWalletTransactionHistory()]);
                    });
            } else {
                clearCurrentWallet();
                updateWalletUI();
                Promise.resolve(loadPersistedBroadcastedTransactions()); // Clear list if no wallet selected
                refreshWalletTransactionHistory();
            }
        });
    } else {
        console.error('Wallet select not found');
    }
    const importWalletBtn = document.getElementById('importWalletBtn');
    if (importWalletBtn) {
        importWalletBtn.addEventListener('click', () => {
            const importResult = importWallet();
            Promise.resolve(importResult) // importWallet itself doesn't return promise, this is just for chaining
                .then(async () => {
                    await Promise.all([refreshBalance(), refreshWalletTransactionHistory(), loadPersistedBroadcastedTransactions()]);
                    checkPendingTransactionsStatus();
                })
                .catch(error => {
                    console.error("Error importing wallet or refreshing history:", error);
                    if (wallet.address) refreshWalletTransactionHistory();
                });
        });
    }
    const deleteWalletBtn = document.getElementById('deleteWalletBtn');
    if (deleteWalletBtn) {
        deleteWalletBtn.addEventListener('click', () => {
            deleteCurrentWallet()
                .then(async () => {
                    // After deleting, wallet.address will be null, so refreshBalance and others will show empty state.
                    await Promise.all([refreshBalance(), refreshWalletTransactionHistory(), loadPersistedBroadcastedTransactions()]);
                })
                .catch(error => console.error("Failed to delete wallet or refresh history:", error));
        });
    }
    document.getElementById('refreshBalanceBtn')?.addEventListener('click', () => refreshBalance());
    document.getElementById('testConnectionBtn')?.addEventListener('click', () => testConnection());
    const transactionButtons = {
        calculateFeeBtn: calculateFee,
        sendTransactionBtn: sendTransaction,
        viewInBrowser: (e) => {
            e.preventDefault();
            openInBrowser();
        }
    };

    Object.entries(transactionButtons).forEach(([id, handler]) => {
        const button = document.getElementById(id);
        if (button) button.addEventListener('click', handler);
    });

    // Add event listeners for copy buttons
    const copyAddressBtn = document.getElementById('copyAddressBtn');
    if (copyAddressBtn) {
        copyAddressBtn.addEventListener('click', () => {
            if (wallet.address) {
                copyToClipboard(wallet.address, 'Address copied to clipboard');
            }
        });
    }
    const copyPrivateKeyBtn = document.getElementById('copyPrivateKeyBtn');
    if (copyPrivateKeyBtn) {
        copyPrivateKeyBtn.addEventListener('click', () => {
            if (wallet.wif) {
                copyToClipboard(wallet.wif, 'Private key (WIF) copied to clipboard');
            }
        });
    }

    // Add OP_RETURN format selection event listeners
    const opReturnFormatRadios = document.querySelectorAll('input[name="opReturnFormat"]');
    const opReturnSelect = document.getElementById('opReturnFormat');
    const opReturnData = document.getElementById('opReturnData');

    opReturnFormatRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            if (opReturnSelect) {
                opReturnSelect.value = radio.value;
            }
            updateOpReturnPlaceholder();
        });
    });

    // Function to update OP_RETURN placeholder text
    function updateOpReturnPlaceholder() {
        if (opReturnData) {
            const selectedFormat = document.querySelector('input[name="opReturnFormat"]:checked')?.value || 'string';
            if (selectedFormat === 'hex') {
                opReturnData.placeholder = 'Enter hexadecimal data\nExample: 48656c6c6f20446f6765636f696e21\n(corresponds to "Hello Dogecoin!")\nMaximum 80 bytes';
            } else {
                opReturnData.placeholder = 'Enter string data\nExample: Hello Dogecoin!\nMaximum 80 bytes';
            }
        }
    }

    // Initialize placeholder
    updateOpReturnPlaceholder();

    refreshTransactionLists();
}

function refreshTransactionLists() {
    viewPendingTransactions();
    viewBroadcastedTransactions();
}

setInterval(refreshTransactionLists, 30000);
setInterval(refreshWalletTransactionHistory, 120000);
setInterval(checkPendingTransactionsStatus, TX_STATUS_CHECK_INTERVAL);

window.generateWallet = generateWallet;
window.deleteCurrentWallet = deleteCurrentWallet;
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM Content Loaded, initializing app...');
    initializeApp().catch(error => {
        console.error('App initialization error:', error);
        showAlert('Application initialization failed, please refresh page and try again', 'error');
    });
});
initializeApp();
