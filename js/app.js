import { initializeCrypto } from './crypto-utils.js';
import { wallet, generateWallet, loadWallet, deleteCurrentWallet, importWallet } from './wallet.js';
import { fetchBalance, useElectrs, useElectrsProxy } from './network.js';
import { showAlert, updateWalletUI, copyToClipboard } from './ui.js';
import { testConnection, calculateFee, previewTransaction, sendTransaction, sendOpReturnOnly, openInBrowser, viewPendingTransactions, viewBroadcastedTransactions, refreshWalletTransactionHistory, loadPersistedBroadcastedTransactions, checkPendingTransactionsStatus } from './transaction.js';
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
            throw new Error('CryptoJS 未能正确加载');
        }
        if (!window.bs58) {
            throw new Error('Base58 库未能正确加载');
        }
        if (!window.elliptic) {
            throw new Error('椭圆曲线加密库未能正确加载');
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
            throw new Error('加密模块初始化失败');
        }
    } catch (error) {
        console.error('Failed to initialize app:', error);
        showAlert('应用初始化失败: ' + error.message, 'error');
        throw error;
    }
}

async function refreshBalance() {
    if (wallet.address) {
        showAlert('正在刷新余额...', 'info');
        try {
            const result = await fetchBalance(wallet.address);
            wallet.balance = result.balance / 100000000;
            wallet.balanceAvailable = true;
            updateWalletUI();
            showAlert('余额已更新', 'success');
        } catch (error) {
            console.error('手动刷新余额失败:', error);
            wallet.balanceAvailable = false; // 表示余额可能已过时
            updateWalletUI(); // 即使出错也更新UI以反映不可用状态
            showAlert('刷新余额失败: ' + error.message, 'error');
        }
    } else {
        // 如果没有活动钱包，可以清除余额显示或提示选择钱包
        wallet.balance = 0;
        wallet.balanceAvailable = false;
        updateWalletUI();
        // showAlert('请先选择或生成钱包', 'info'); // 可选提示
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
            console.error("恢复钱包时加载或刷新历史失败:", error);
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
            statusElement.textContent = '🔄 自动刷新: 30秒';
            statusElement.style.color = '#28a745';
        } else {
            statusElement.textContent = '⏸️ 自动刷新: 已停止';
            statusElement.style.color = '#666';
        }
    }
}

function updateBlockInfoStatus() {
    const statusElement = document.getElementById('blockInfoStatus');
    if (statusElement) {
        if (blockInfoInterval) {
            statusElement.textContent = '🔄 自动刷新: 1秒';
            statusElement.style.color = '#28a745';
        } else {
            statusElement.textContent = '⏸️ 自动刷新: 已停止';
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
            // 生成钱包后，地址已在wallet对象中，可以立即刷新余额和历史
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
                    console.error("选择钱包时加载或刷新历史失败:", error);
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
            Promise.resolve(importResult) // importWallet本身不返回promise，这里只是为了链式调用
                .then(async () => {
                    await Promise.all([refreshBalance(), refreshWalletTransactionHistory(), loadPersistedBroadcastedTransactions()]);
                    checkPendingTransactionsStatus();
                })
                .catch(error => {
                console.error("导入钱包或刷新历史时出错:", error);
                if(wallet.address) refreshWalletTransactionHistory();
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
                .catch(error => console.error("删除钱包或刷新历史失败:", error));
        });
    }
    document.getElementById('refreshBalanceBtn')?.addEventListener('click', () => refreshBalance());
    document.getElementById('testConnectionBtn')?.addEventListener('click', () => testConnection());
    const transactionButtons = {
        calculateFeeBtn: calculateFee,
        previewTransactionBtn: previewTransaction,
        sendTransactionBtn: sendTransaction,
        sendOpReturnOnlyBtn: sendOpReturnOnly,
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
                copyToClipboard(wallet.address, '地址已复制到剪贴板');
            }
        });
    }
    const copyPrivateKeyBtn = document.getElementById('copyPrivateKeyBtn');
    if (copyPrivateKeyBtn) {
        copyPrivateKeyBtn.addEventListener('click', () => {
            if (wallet.wif) {
                copyToClipboard(wallet.wif, '私钥 (WIF) 已复制到剪贴板');
            }
        });
    }
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
        showAlert('应用初始化失败，请刷新页面重试', 'error');
    });
});
initializeApp();
