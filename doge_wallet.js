/**
 * Dogecoin Testnet Wallet Implementation
 * Using browser-compatible crypto libraries
 */
window.onload = function() {
    updateOpReturnPlaceholder();
}
// Global variables
let wallet = {
    privateKey: null,
    address: null,
    label: '',
    balance: 0,
    balanceAvailable: false
};

let useElectrs = true;
let useElectrsProxy = false;
let EC, secp256k1, DOGECOIN_TESTNET;

// 自动刷新配置
let autoRefreshInterval = null;
const AUTO_REFRESH_INTERVAL = 30000; // 30秒自动刷新一次

// 区块链信息自动刷新配置
let blockInfoInterval = null;
const BLOCK_INFO_REFRESH_INTERVAL = 1000; // 1秒刷新一次

// Initialize crypto libraries and network parameters
function initializeCrypto() {
    // Check if required libraries are loaded
    if (typeof CryptoJS === 'undefined' || typeof bs58 === 'undefined' || typeof elliptic === 'undefined') {
        alert('Required crypto libraries failed to load. Please refresh the page.');
        return false;
    }

    console.log('Crypto libraries loaded successfully');

    // Initialize elliptic curve
    EC = elliptic.ec;
    secp256k1 = new EC('secp256k1');

    // Dogecoin network parameters
    DOGECOIN_TESTNET = {
        pubKeyHash: 0x71,  // Testnet address prefix
        scriptHash: 0xc4,  // Testnet script address prefix
        wif: 0xf1,          // Testnet WIF prefix
        bip32: {
            public: 0x043587cf,
            private: 0x04358394
        }
    };

    return true;
}

function getElectrsUrl() {
    if (useElectrsProxy) {
        return '/electrs';
    } else {
        return 'https://doge-electrs-testnet-demo.qed.me';
    }
}

function getCorsProxyUrl(url) {
    // 在本地环境下使用 CORS 代理
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    }
    return url;
}

// Utility functions
function sha256(data) {
    return CryptoJS.SHA256(data);
}

function sha256Double(data) {
    return sha256(sha256(data));
}

function ripemd160(data) {
    return CryptoJS.RIPEMD160(data);
}

function hash160(data) {
    return ripemd160(sha256(data));
}

// Generate random private key
function generatePrivateKey() {
    const keyPair = secp256k1.genKeyPair();
    return keyPair.getPrivate('hex');
}

// Get public key from private key
function getPublicKey(privateKeyHex) {
    const keyPair = secp256k1.keyFromPrivate(privateKeyHex, 'hex');
    return keyPair.getPublic('hex');
}

// Convert private key to WIF format
function privateKeyToWIF(privateKeyHex) {
    const extended = DOGECOIN_TESTNET.wif.toString(16).padStart(2, '0') + privateKeyHex + '01';
    const hash = sha256Double(CryptoJS.enc.Hex.parse(extended));
    const checksum = hash.toString().substring(0, 8);
    const fullHex = extended + checksum;
    // Convert hex string to byte array
    const bytes = [];
    for (let i = 0; i < fullHex.length; i += 2) {
        bytes.push(parseInt(fullHex.substr(i, 2), 16));
    }
    return bs58.encode(bytes);
}

// Convert WIF to private key
function wifToPrivateKey(wif) {
    try {
        const decoded = bs58.decode(wif);
        const hex = decoded.map(b => b.toString(16).padStart(2, '0')).join('');
        
        // Verify checksum
        const payload = hex.substring(0, hex.length - 8);
        const checksum = hex.substring(hex.length - 8);
        const hash = sha256Double(CryptoJS.enc.Hex.parse(payload));
        const expectedChecksum = hash.toString().substring(0, 8);
        
        if (checksum !== expectedChecksum) {
            throw new Error('Invalid checksum');
        }
        
        // Extract private key (remove version byte and compression flag)
        return hex.substring(2, hex.length - 10);
    } catch (error) {
        throw new Error('Invalid WIF format');
    }
}

// Generate address from public key
function publicKeyToAddress(publicKeyHex) {
    const publicKeyBytes = CryptoJS.enc.Hex.parse(publicKeyHex);
    const hash160Result = hash160(publicKeyBytes);
    const versionedHash = DOGECOIN_TESTNET.pubKeyHash.toString(16).padStart(2, '0') + hash160Result.toString();
    const hash = sha256Double(CryptoJS.enc.Hex.parse(versionedHash));
    const checksum = hash.toString().substring(0, 8);
    const fullHex = versionedHash + checksum;
    // Convert hex string to byte array
    const bytes = [];
    for (let i = 0; i < fullHex.length; i += 2) {
        bytes.push(parseInt(fullHex.substr(i, 2), 16));
    }
    return bs58.encode(bytes);
}

// Validate Dogecoin address
function isValidAddress(address) {
    try {
        const decoded = bs58.decode(address);
        const hex = decoded.map(b => b.toString(16).padStart(2, '0')).join('');
        
        if (hex.length !== 50) return false; // 25 bytes * 2
        
        const payload = hex.substring(0, 42);
        const checksum = hex.substring(42);
        const hash = sha256Double(CryptoJS.enc.Hex.parse(payload));
        const expectedChecksum = hash.toString().substring(0, 8);
        
        return checksum === expectedChecksum;
    } catch (error) {
        return false;
    }
}

// Cookie utilities
function setCookie(name, value, days = 30) {
    const expires = new Date();
    expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires.toUTCString()};path=/`;
}

function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length, c.length));
    }
    return null;
}

function deleteCookie(name) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
}

// Wallet management
function getWalletList() {
    const stored = getCookie('dogecoin_wallets');
    return stored ? JSON.parse(stored) : [];
}

function saveCurrentWallet() {
    if (!wallet.address || !wallet.privateKey) return;

    const walletList = getWalletList();
    const existingIndex = walletList.findIndex(w => w.address === wallet.address);

    const walletData = {
        address: wallet.address,
        privateKey: wallet.privateKey,
        label: wallet.label || `钱包 ${wallet.address.substring(0, 8)}...`,
        createdAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
        walletList[existingIndex] = walletData;
    } else {
        walletList.push(walletData);
    }

    if (walletList.length > 10) {
        walletList.splice(0, walletList.length - 10);
    }

    setCookie('dogecoin_wallets', JSON.stringify(walletList));
    setCookie('current_wallet_address', wallet.address);
    updateWalletSelector();
}

function loadWallet(address) {
    const walletList = getWalletList();
    const walletData = walletList.find(w => w.address === address);

    if (!walletData) {
        showAlert('钱包不存在', 'error');
        return;
    }
    
        wallet.address = walletData.address;
        wallet.privateKey = walletData.privateKey;
    wallet.label = walletData.label || `钱包 ${walletData.address.substring(0, 8)}...`;
    wallet.balance = 0;
        wallet.balanceAvailable = false;

        document.getElementById('address').textContent = wallet.address;
        document.getElementById('privateKey').textContent = wallet.privateKey;
    document.getElementById('balance').textContent = '加载中...';
        document.getElementById('balance').style.color = '#666';

        updateCopyButtons();
    updateWalletSelector(); // 更新下拉框选中状态
    setCookie('current_wallet_address', address);
    
    // 自动刷新余额
    setTimeout(async () => {
        await refreshBalance();
        // 启动自动刷新
        startAutoRefresh();
    }, 500);
}

function updateWalletSelector() {
    const walletList = getWalletList();
    const selectElement = document.getElementById('walletSelect');

    selectElement.innerHTML = '<option value="">请生成或导入钱包</option>';

    walletList.forEach(w => {
        const option = document.createElement('option');
        option.value = w.address;
        option.textContent = `${w.label} (${w.address.substring(0, 8)}...${w.address.substring(w.address.length - 6)})`;

        if (wallet.address === w.address) {
            option.selected = true;
        }

        selectElement.appendChild(option);
    });
}

function updateCopyButtons() {
    const addressBtn = document.getElementById('copyAddressBtn');
    const privateKeyBtn = document.getElementById('copyPrivateKeyBtn');

    if (wallet.address) {
        addressBtn.disabled = false;
        addressBtn.style.background = '#4299e1';
    } else {
        addressBtn.disabled = true;
        addressBtn.style.background = '#6c757d';
    }

    if (wallet.privateKey) {
        privateKeyBtn.disabled = false;
        privateKeyBtn.style.background = '#4299e1';
    } else {
        privateKeyBtn.disabled = true;
        privateKeyBtn.style.background = '#6c757d';
    }
}

// Global wallet functions
function generateWallet() {
    if (!secp256k1) {
        showAlert('加密库未初始化，请刷新页面', 'error');
        return;
    }

    try {
        const privateKeyHex = generatePrivateKey();
        const publicKeyHex = getPublicKey(privateKeyHex);
        const wif = privateKeyToWIF(privateKeyHex);
        const address = publicKeyToAddress(publicKeyHex);

        wallet.address = address;
        wallet.privateKey = wif;
        wallet.label = `钱包 ${address.substring(0, 8)}...`;
        wallet.balance = 0;
        wallet.balanceAvailable = false;

        saveCurrentWallet();
        updateWalletSelector();

        // Automatically select the new wallet and update fields
        document.getElementById('walletSelect').value = wallet.address;
        document.getElementById('address').textContent = wallet.address;
        document.getElementById('privateKey').textContent = wallet.privateKey;

        updateCopyButtons();

        showAlert('钱包生成成功！\n地址: ' + address, 'success');
        
        // 自动刷新余额
        setTimeout(async () => {
            await refreshBalance();
            // 启动自动刷新
            startAutoRefresh();
        }, 1000);

    } catch (error) {
        showAlert('生成钱包失败: ' + error.message, 'error');
    }
}

function importWallet() {
    const privateKeyInput = document.getElementById('importPrivateKey').value.trim();
    
    if (!privateKeyInput) {
        showAlert('请输入私钥', 'error');
        return;
    }

    try {
        const privateKeyHex = wifToPrivateKey(privateKeyInput);
        const publicKeyHex = getPublicKey(privateKeyHex);
        const address = publicKeyToAddress(publicKeyHex);

        wallet.address = address;
        wallet.privateKey = privateKeyInput;
        wallet.label = `钱包 ${address.substring(0, 8)}...`;
        wallet.balance = 0;
        wallet.balanceAvailable = false;

        saveCurrentWallet();
        updateWalletSelector();
        updateCopyButtons();

        document.getElementById('importPrivateKey').value = '';
        showAlert('钱包导入成功！\n地址: ' + address, 'success');
        
        // 自动刷新余额
        setTimeout(async () => {
            await refreshBalance();
            // 启动自动刷新
            startAutoRefresh();
        }, 1000);

    } catch (error) {
        showAlert('导入钱包失败: ' + error.message, 'error');
    }
}

function switchWallet() {
    const selectElement = document.getElementById('walletSelect');
    const selectedAddress = selectElement.value;

    if (selectedAddress && selectedAddress !== wallet.address) {
        loadWallet(selectedAddress);
    } else if (!selectedAddress) {
        clearCurrentWallet();
    }
}

function deleteCurrentWallet() {
    if (!wallet.address) {
        showAlert('没有可删除的钱包', 'error');
        return;
    }

    if (confirm(`确定要删除钱包 "${wallet.label}" 吗？`)) {
        const walletList = getWalletList();
        const newList = walletList.filter(w => w.address !== wallet.address);
        setCookie('dogecoin_wallets', JSON.stringify(newList));
        clearCurrentWallet();
        updateWalletSelector();
        showAlert('钱包已删除', 'success');
    }
}

function clearCurrentWallet() {
    wallet.address = '';
    wallet.privateKey = '';
    wallet.label = '';
    wallet.balance = 0;
    wallet.balanceAvailable = false;

    document.getElementById('address').textContent = '点击生成钱包';
    document.getElementById('privateKey').textContent = '点击生成钱包';
    document.getElementById('balance').textContent = '点击生成钱包';
    document.getElementById('balance').style.color = '#666';
    
    updateCopyButtons();
    deleteCookie('current_wallet_address');
    
    // 停止自动刷新
    stopAutoRefresh();
    
    // 停止区块链信息自动刷新
    stopBlockInfoAutoRefresh();
}

// Copy functions
function copyAddress() {
    if (!wallet.address) {
        showAlert('没有可复制的地址', 'error');
        return;
    }
    copyToClipboard(wallet.address, '地址已复制到剪贴板');
}

function copyPrivateKey() {
    if (!wallet.privateKey) {
        showAlert('没有可复制的私钥', 'error');
        return;
    }
    copyToClipboard(wallet.privateKey, '私钥已复制到剪贴板');
}

function copyToClipboard(text, successMessage) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => {
            showAlert(successMessage, 'success');
        }).catch(() => {
            fallbackCopy(text, successMessage);
        });
    } else {
        fallbackCopy(text, successMessage);
    }
}

function fallbackCopy(text, successMessage) {
    try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);

        if (successful) {
            showAlert(successMessage, 'success');
        } else {
            showAlert('复制失败，请手动选择复制', 'error');
        }
    } catch (err) {
        showAlert('复制失败，请手动选择复制', 'error');
    }
}

// Balance and connection management
async function refreshBalance() {
    if (!wallet.address) {
        showAlert('请先生成钱包', 'error');
        return;
    }

    if (useElectrs) {
        await refreshBalanceElectrs();
    } else {
        showAlert('RPC余额查询功能暂未实现', 'error');
    }
}

async function refreshBalanceElectrs() {
    try {
        const baseUrl = getElectrsUrl();
        let response, data;
        
        if (useElectrsProxy) {
            // 使用 Electrs API 格式 (代理模式)
            response = await fetch(`${baseUrl}/address/${wallet.address}`);
            if (response.ok) {
                data = await response.json();
                const balanceSatoshi = data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
                wallet.balance = balanceSatoshi / 100000000;
                wallet.balanceAvailable = true;

                const balanceElement = document.getElementById('balance');
                balanceElement.textContent = wallet.balance.toFixed(8) + ' DOGE';
                balanceElement.style.color = '#38a169';

                const utxoCount = data.chain_stats.funded_txo_count - data.chain_stats.spent_txo_count;
                showAlert(`余额已更新: ${wallet.balance.toFixed(8)} DOGE\n(Electrs 代理 - ${utxoCount}个UTXO)`, 'success');
            } else {
                throw new Error('Electrs查询失败: ' + response.status);
            }
        } else {
            // 使用 Electrs API 格式 (直连模式)
            const apiUrl = `${baseUrl}/address/${wallet.address}`;
            const finalUrl = getCorsProxyUrl(apiUrl);
            const isUsingProxy = finalUrl !== apiUrl;
            
            response = await fetch(finalUrl);
            if (response.ok) {
                data = await response.json();
                const balanceSatoshi = data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
                wallet.balance = balanceSatoshi / 100000000;
                wallet.balanceAvailable = true;

                const balanceElement = document.getElementById('balance');
                balanceElement.textContent = wallet.balance.toFixed(8) + ' DOGE';
                balanceElement.style.color = '#38a169';

                const utxoCount = data.chain_stats.funded_txo_count - data.chain_stats.spent_txo_count;
                const connectionType = isUsingProxy ? 'CORS代理' : '直连';
                showAlert(`余额已更新: ${wallet.balance.toFixed(8)} DOGE\n(Electrs ${connectionType} - ${utxoCount}个UTXO)`, 'success');
            } else {
                throw new Error('Electrs查询失败: ' + response.status);
            }
        }
    } catch (error) {
        wallet.balanceAvailable = false;
        const balanceElement = document.getElementById('balance');
        balanceElement.textContent = 'API不可用';
        balanceElement.style.color = '#e53e3e';
        
        const method = useElectrsProxy ? '代理' : '直连';
        let errorMessage = error.message;
        
        // 检查是否是 CORS 错误
        if (error.message.includes('CORS') || error.message.includes('Failed to fetch')) {
            errorMessage = 'CORS跨域错误 - 请使用本地服务器或启用代理模式';
        }
        
        showAlert(`API查询失败 (${method}): ${errorMessage}\n\n💡 提示: 钱包生成功能仍然可用`, 'error');
    }
}

function switchQueryMethod() {
    const electrsRadio = document.querySelector('input[name="queryMethod"][value="electrs"]');
    useElectrs = electrsRadio.checked;

    const electrsOptions = document.getElementById('electrsOptions');
    electrsOptions.style.display = useElectrs ? 'flex' : 'none';

    setCookie('use_electrs', useElectrs ? 'true' : 'false');
    document.getElementById('rpcStatus').textContent = '正在检测连接...';
    document.getElementById('rpcStatus').style.color = '#666';

    setTimeout(() => autoTestConnection(), 100);
}

function toggleElectrsProxy() {
    const proxyCheckbox = document.getElementById('useProxy');
    
    // 在本地环境下禁止启用代理
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        if (proxyCheckbox.checked) {
            proxyCheckbox.checked = false;
            showAlert('本地服务器环境下无法使用代理模式\n请使用直连模式', 'error');
        }
        useElectrsProxy = false;
        return;
    }
    
    useElectrsProxy = proxyCheckbox.checked;
    setCookie('use_electrs_proxy', useElectrsProxy ? 'true' : 'false');

    if (useElectrs) {
        document.getElementById('rpcStatus').textContent = '正在检测连接...';
        document.getElementById('rpcStatus').style.color = '#666';
        setTimeout(() => autoTestElectrsConnection(), 100);
    }
}

function testConnection() {
    if (useElectrs) {
        testElectrsConnection();
    } else {
        testRPCConnection();
    }
}

function autoTestConnection() {
    if (useElectrs) {
        autoTestElectrsConnection();
    }
}

async function testElectrsConnection() {
    try {
        const baseUrl = getElectrsUrl();
        const apiUrl = `${baseUrl}/`;
        const finalUrl = getCorsProxyUrl(apiUrl);
        const response = await fetch(finalUrl);
        
        if (response.ok) {
            const isUsingCorsProxy = finalUrl !== apiUrl;
            let method;
            if (useElectrsProxy) {
                method = '代理';
            } else if (isUsingCorsProxy) {
                method = 'CORS代理';
            } else {
                method = '直连';
            }
            document.getElementById('rpcStatus').textContent = `Electrs API 已连接 (${method})`;
            document.getElementById('rpcStatus').style.color = '#38a169';
            showAlert(`Electrs API连接成功！(${method})`, 'success');
        } else {
            throw new Error('连接失败: ' + response.status);
        }
    } catch (error) {
        const method = useElectrsProxy ? '代理' : '直连';
        document.getElementById('rpcStatus').textContent = `Electrs API 连接失败 (${method})`;
        document.getElementById('rpcStatus').style.color = '#e53e3e';
        
        let errorMessage = error.message;
        if (error.message.includes('CORS') || error.message.includes('Failed to fetch')) {
            errorMessage = 'CORS跨域错误 - 请使用本地服务器或启用代理模式';
        }
        
        showAlert(`Electrs API连接失败 (${method}): ${errorMessage}`, 'error');
    }
}

async function autoTestElectrsConnection() {
    try {
        const baseUrl = getElectrsUrl();
        const apiUrl = `${baseUrl}/`;
        const finalUrl = getCorsProxyUrl(apiUrl);
        const response = await fetch(finalUrl);
        
        if (response.ok) {
            const method = useElectrsProxy ? '代理' : '直连';
            document.getElementById('rpcStatus').textContent = `Electrs API 已连接 (${method})`;
            document.getElementById('rpcStatus').style.color = '#38a169';

            // 不自动刷新余额，让用户手动操作
        } else {
            throw new Error('连接失败: ' + response.status);
        }
    } catch (error) {
        const method = useElectrsProxy ? '代理' : '直连';
        document.getElementById('rpcStatus').textContent = `Electrs API 连接失败 (${method})`;
        document.getElementById('rpcStatus').style.color = '#e53e3e';
    }
}


// Transaction functions
async function sendTransaction() {
    if (!wallet.address || !wallet.privateKey) {
        showAlert('请先生成或导入钱包', 'error');
        return;
    }

    const toAddress = document.getElementById('toAddress').value.trim();
    const amount = parseFloat(document.getElementById('amount').value);
    const fee = parseFloat(document.getElementById('fee').value);
    const opReturnData = document.getElementById('opReturnData').value.trim();
    const opReturnFormat = getOpReturnFormat();

    // 验证OP_RETURN数据
    if (opReturnData) {
        const validation = validateOpReturnData(opReturnData, opReturnFormat);
        if (!validation.valid) {
            showAlert('OP_RETURN数据错误: ' + validation.error, 'error');
            return;
        }
    }

    // 验证输入
    if (!toAddress) {
        showAlert('请输入接收地址', 'error');
        return;
    }

    if (!isValidAddress(toAddress)) {
        showAlert('接收地址格式无效', 'error');
        return;
    }

    if (!amount || amount <= 0) {
        showAlert('请输入有效的发送数量', 'error');
        return;
    }

    if (!fee || fee <= 0) {
        showAlert('请输入有效的手续费', 'error');
        return;
    }

    if (!wallet.balanceAvailable) {
        showAlert('请先刷新余额', 'error');
        return;
    }

    const totalAmount = amount + fee;
    if (totalAmount > wallet.balance) {
        showAlert(`余额不足\n需要: ${totalAmount.toFixed(8)} DOGE\n可用: ${wallet.balance.toFixed(8)} DOGE`, 'error');
        return;
    }

    try {
        showAlert('正在创建交易...', 'success');
        
        // 获取 UTXO
        const rawUtxos = await getUTXOs(wallet.address);
        console.log('Raw UTXOs from API:', rawUtxos);
        
        if (!rawUtxos || rawUtxos.length === 0) {
            throw new Error('没有可用的 UTXO，请等待交易确认或获取更多测试币');
        }
        
        // 验证 UTXO 是否仍然可用
        const validUtxos = await validateUTXOs(rawUtxos);
        console.log('Valid UTXOs after validation:', validUtxos);
        
        if (!validUtxos || validUtxos.length === 0) {
            throw new Error('所有 UTXO 都已被花费，请等待新的交易确认或获取更多测试币');
        }

        // 创建交易
        const transaction = await createDogecoinTransaction(
            wallet.address,
            wallet.privateKey,
            toAddress,
            amount,
            fee,
            validUtxos,
            opReturnData,
            opReturnFormat
        );

        // 广播交易
        const txid = await broadcastTransaction(transaction);
        
        showAlert(`交易发送成功！\n交易ID: ${txid}`, 'success');
        
        // 清空表单
        document.getElementById('toAddress').value = '';
        document.getElementById('amount').value = '';
        document.getElementById('fee').value = '';
        document.getElementById('opReturnData').value = '';
        
        // 自动刷新余额
        await refreshBalanceAfterTransaction();

    } catch (error) {
        console.error('Transaction error:', error);
        showAlert('交易发送失败: ' + error.message, 'error');
    }
}

async function sendOpReturnOnly() {
    if (!wallet.address || !wallet.privateKey) {
        showAlert('请先生成或导入钱包', 'error');
            return;
        }

    const fee = parseFloat(document.getElementById('fee').value);
    const opReturnData = document.getElementById('opReturnData').value.trim();
    const opReturnFormat = getOpReturnFormat();

    if (!opReturnData) {
        showAlert('请输入 OP_RETURN 数据', 'error');
        return;
    }

    // 验证OP_RETURN数据
    const validation = validateOpReturnData(opReturnData, opReturnFormat);
    if (!validation.valid) {
        showAlert('OP_RETURN数据错误: ' + validation.error, 'error');
        return;
    }

    if (!fee || fee <= 0) {
        showAlert('请输入有效的手续费', 'error');
        return;
    }

    if (!wallet.balanceAvailable) {
        showAlert('请先刷新余额', 'error');
        return;
    }

    if (fee > wallet.balance) {
        showAlert(`余额不足支付手续费\n需要: ${fee.toFixed(8)} DOGE\n可用: ${wallet.balance.toFixed(8)} DOGE`, 'error');
        return;
    }

    try {
        showAlert('正在创建 OP_RETURN 交易...', 'success');
        
        // 获取 UTXO
        const rawUtxos = await getUTXOs(wallet.address);
        console.log('Raw UTXOs from API:', rawUtxos);
        
        if (!rawUtxos || rawUtxos.length === 0) {
            throw new Error('没有可用的 UTXO，请等待交易确认或获取更多测试币');
        }
        
        // 验证 UTXO 是否仍然可用
        const validUtxos = await validateUTXOs(rawUtxos);
        console.log('Valid UTXOs after validation:', validUtxos);
        
        if (!validUtxos || validUtxos.length === 0) {
            throw new Error('所有 UTXO 都已被花费，请等待新的交易确认或获取更多测试币');
        }

        // 创建仅包含 OP_RETURN 的交易
        const transaction = await createDogecoinTransaction(
            wallet.address,
            wallet.privateKey,
            null, // 没有接收地址
            0,    // 没有发送金额
            fee,
            validUtxos,
            opReturnData
        );

        // 广播交易
        const txid = await broadcastTransaction(transaction);
        
        showAlert(`OP_RETURN 交易发送成功！\n交易ID: ${txid}`, 'success');
        
        // 清空表单
        document.getElementById('opReturnData').value = '';
        document.getElementById('fee').value = '';
        
        // 自动刷新余额
        await refreshBalanceAfterTransaction();

    } catch (error) {
        console.error('OP_RETURN transaction error:', error);
        showAlert('OP_RETURN 交易发送失败: ' + error.message, 'error');
    }
}

// UTXO and Transaction functions
async function getUTXOs(address) {
    try {
        const baseUrl = getElectrsUrl();
        const apiUrl = `${baseUrl}/address/${address}/utxo`;
        const finalUrl = getCorsProxyUrl(apiUrl);
        
        const response = await fetch(finalUrl);

        if (response.ok) {
            const utxos = await response.json();
            console.log('Raw UTXO data:', utxos);
            
            // 过滤并验证 UTXO
            const validUtxos = utxos.filter(utxo => {
                // 确保 UTXO 已确认且有效
                const isConfirmed = utxo.status && utxo.status.confirmed;
                const hasValue = utxo.value && utxo.value > 0;
                const hasValidTxid = utxo.txid && utxo.txid.length === 64;
                const hasValidVout = typeof utxo.vout === 'number' && utxo.vout >= 0;
                
                if (!isConfirmed) {
                    console.log('Skipping unconfirmed UTXO:', utxo.txid, utxo.vout);
                }
                
                return isConfirmed && hasValue && hasValidTxid && hasValidVout;
            });
            
            console.log('Filtered valid UTXOs:', validUtxos);
            return validUtxos;
        } else {
            throw new Error('获取 UTXO 失败: ' + response.status);
        }
    } catch (error) {
        console.error('Error fetching UTXOs:', error);
        throw error;
    }
}

// 验证 UTXO 是否仍然可用
async function validateUTXO(txid, vout) {
    try {
        const baseUrl = getElectrsUrl();
        const apiUrl = `${baseUrl}/tx/${txid}/outspend/${vout}`;
        const finalUrl = getCorsProxyUrl(apiUrl);
        
        const response = await fetch(finalUrl);

        if (response.ok) {
            const data = await response.json();
            // 如果 spent 为 false 或者不存在，说明 UTXO 未被花费
            const isUnspent = !data.spent;
            console.log(`UTXO ${txid}:${vout} is ${isUnspent ? 'unspent' : 'spent'}`);
            return isUnspent;
        } else {
            console.warn(`Could not validate UTXO ${txid}:${vout}, assuming valid`);
            return true; // 如果无法验证，假设有效
        }
    } catch (error) {
        console.warn(`Error validating UTXO ${txid}:${vout}:`, error);
        return true; // 如果验证失败，假设有效
    }
}

// 批量验证 UTXO
async function validateUTXOs(utxos) {
    console.log('Validating UTXOs...');
    const validUtxos = [];
    
    for (const utxo of utxos) {
        const isValid = await validateUTXO(utxo.txid, utxo.vout);
        if (isValid) {
            validUtxos.push(utxo);
        } else {
            console.log(`Removing spent UTXO: ${utxo.txid}:${utxo.vout}`);
        }
    }
    
    console.log(`Validated ${validUtxos.length} out of ${utxos.length} UTXOs`);
    return validUtxos;
}






/////////////////////////////////////////////



/**
 * **NEW FUNCTION**
 * Creates a P2SH locking script from a base58 address.
 * @param {string} address - The base58 encoded P2SH address.
 * @returns {string} The hex-encoded P2SH scriptPubKey.
 */
function createP2SHScript(address) {
    const decoded = bs58.decode(address);
    const hex = decoded.map(b => b.toString(16).padStart(2, '0')).join('');
    const scriptHash = hex.substring(2, 42); // Remove version and checksum
    return 'a914' + scriptHash + '87';
}

/**
 * **NEW FUNCTION**
 * Creates a locking script (scriptPubKey) by detecting the address type.
 * This function resolves the core bug.
 * @param {string} address - The base58 encoded Dogecoin address.
 * @returns {string} The corresponding hex-encoded scriptPubKey.
 */
function createScriptPubKeyFromAddress(address) {
    try {
        const decoded = bs58.decode(address);
        const version = decoded[0];

        if (version === DOGECOIN_TESTNET.pubKeyHash) {
            return createP2PKHScript(address);
        } else if (version === DOGECOIN_TESTNET.scriptHash) {
            return createP2SHScript(address);
        } else {
            throw new Error(`Unsupported address version: ${version}`);
        }
    } catch (e) {
        throw new Error(`Invalid address format: ${address}`);
    }
}

/**
 * **MODIFIED FUNCTION**
 * Creates, signs, and serializes a Dogecoin transaction using only native functions.
 * @param {string} fromAddress - Address for change output.
 * @param {string} privateKeyWIF - WIF-encoded private key for signing.
 * @param {string} toAddress - Destination address.
 * @param {number} amount - Amount in DOGE to send.
 * @param {number} fee - Fee in DOGE.
 * @param {Array} utxos - Available Unspent Transaction Outputs.
 * @param {string} opReturnData - Optional data for OP_RETURN.
 * @param {string} opReturnFormat - 'string' or 'hex'.
 * @returns {Promise<string>} The raw, serialized transaction hex.
 */
async function createDogecoinTransaction(fromAddress, privateKeyWIF, toAddress, amount, fee, utxos, opReturnData, opReturnFormat = 'string') {
    try {
        const amountKoinu = Math.round(amount * 100000000);
        const feeKoinu = Math.round(fee * 100000000);
        
        const selectedUtxos = selectUTXOs(utxos, amountKoinu + feeKoinu);
        if (!selectedUtxos) {
            throw new Error('没有足够的 UTXO');
        }
        
        const totalInput = selectedUtxos.reduce((sum, utxo) => sum + utxo.value, 0);
        const change = totalInput - (amountKoinu + feeKoinu);
        
        const tx = {
            version: 1,
            inputs: [],
            outputs: [],
            locktime: 0
        };
        
        for (const utxo of selectedUtxos) {
            tx.inputs.push({
                txid: utxo.txid,
                vout: utxo.vout,
                scriptSig: '', // To be filled by signing
                sequence: 0xffffffff
            });
        }
        
        // **BUG FIX**: Use the new function that detects address type
        if (toAddress && amountKoinu > 0) {
            tx.outputs.push({
                value: amountKoinu,
                scriptPubKey: createScriptPubKeyFromAddress(toAddress)
            });
        }
        
        if (opReturnData) {
            tx.outputs.push({
                value: 0,
                scriptPubKey: createOpReturnScript(opReturnData, opReturnFormat)
            });
        }
        
        const DUST_THRESHOLD = 100000000; // 1 DOGE in koinu
        if (change > DUST_THRESHOLD) {
             // **BUG FIX**: Use the new function for the change address as well
            tx.outputs.push({
                value: change,
                scriptPubKey: createScriptPubKeyFromAddress(fromAddress)
            });
        }
        
        // Sign the transaction using the native signing function
        const signedTx = await signTransaction(tx, selectedUtxos, privateKeyWIF);
        
        // Serialize the transaction using the native serialization function
        const txHex = serializeTransaction(signedTx);

        // Final validations
        if (!/^[0-9a-fA-F]+$/.test(txHex) || txHex.length % 2 !== 0) {
            throw new Error('交易序列化结果无效 (Invalid hex).');
        }
        
        return txHex;

    } catch (error) {
        console.error("Error in createDogecoinTransaction:", error);
        throw new Error('创建交易失败: ' + error.message);
    }
}

//////////////////////////////////////////////////  
async function createTransaction(fromAddress, privateKeyWIF, toAddress, amount, fee, utxos, opReturnData) {
    try {
        // 转换金额为 satoshi
        const amountSatoshi = Math.round(amount * 100000000);
        const feeSatoshi = Math.round(fee * 100000000);
        
        // 选择 UTXO
        const selectedUtxos = selectUTXOs(utxos, amountSatoshi + feeSatoshi);
        if (!selectedUtxos) {
            throw new Error('没有足够的 UTXO');
        }
        
        // 计算找零
        const totalInput = selectedUtxos.reduce((sum, utxo) => sum + utxo.value, 0);
        const totalOutput = amountSatoshi + feeSatoshi;
        const change = totalInput - totalOutput;
        
        // 创建交易
        const tx = {
            version: 1,
            inputs: [],
            outputs: [],
            locktime: 0
        };
        
        // 添加输入
        for (const utxo of selectedUtxos) {
            tx.inputs.push({
                txid: utxo.txid,
                vout: utxo.vout,
                scriptSig: '', // 稍后填充
                sequence: 0xffffffff
            });
        }
        
        // 添加输出
        if (toAddress && amountSatoshi > 0) {
            // 普通输出
            tx.outputs.push({
                value: amountSatoshi,
                scriptPubKey: createP2PKHScript(toAddress)
            });
        }
        
        // 添加 OP_RETURN 输出
        if (opReturnData) {
            tx.outputs.push({
                value: 0,
                scriptPubKey: createOpReturnScript(opReturnData)
            });
        }
        
        // 添加找零输出
        if (change > 0) {
            tx.outputs.push({
                value: change,
                scriptPubKey: createP2PKHScript(fromAddress)
            });
        }
        
        // 签名交易
        const signedTx = await signTransaction(tx, selectedUtxos, privateKeyWIF);
        
        // 序列化交易
        const txHex = serializeTransaction(signedTx);
        console.log('Serialized transaction hex:', txHex);
        console.log('Transaction hex length:', txHex.length);
        
        // 验证交易十六进制格式
        if (!/^[0-9a-fA-F]+$/.test(txHex)) {
            throw new Error('交易序列化包含无效字符');
        }
        
        if (txHex.length % 2 !== 0) {
            throw new Error('交易序列化长度不是偶数');
        }
        
        // 基本交易格式验证
        if (txHex.length < 120) { // 最小交易大小约60字节
            throw new Error('交易太小，可能格式错误');
        }
        
        // 验证交易版本（前4字节应该是01000000）
        const versionHex = txHex.substring(0, 8);
        if (versionHex !== '01000000') {
            console.warn('Transaction version is not 1:', versionHex);
        }
        
        return txHex;

    } catch (error) {
        console.error('Error creating transaction:', error);
        throw new Error('创建交易失败: ' + error.message);
    }
}

function selectUTXOs(utxos, targetAmount) {
    console.log('Selecting UTXOs for target amount:', targetAmount, 'satoshis');
    console.log('Available UTXOs:', utxos);
    
    if (!utxos || utxos.length === 0) {
        console.error('No UTXOs available');
        return null;
    }
    
    // 只使用已确认的 UTXO
    const confirmedUtxos = utxos.filter(utxo => utxo.status && utxo.status.confirmed);
    console.log('Confirmed UTXOs:', confirmedUtxos);
    
    if (confirmedUtxos.length === 0) {
        console.error('No confirmed UTXOs available');
        return null;
    }
    
    // 按金额排序，优先使用较大的 UTXO
    const sortedUtxos = confirmedUtxos.sort((a, b) => b.value - a.value);
    console.log('Sorted UTXOs (largest first):', sortedUtxos);
    
    let totalValue = 0;
    const selected = [];
    
    for (const utxo of sortedUtxos) {
        selected.push(utxo);
        totalValue += utxo.value;
        
        console.log(`Added UTXO: ${utxo.txid}:${utxo.vout} (${utxo.value} satoshis)`);
        console.log(`Total value so far: ${totalValue} satoshis`);
        
        if (totalValue >= targetAmount) {
            console.log(`Target reached! Selected ${selected.length} UTXOs with total value ${totalValue} satoshis`);
            return selected;
        }
    }
    
    console.error(`Insufficient funds: need ${targetAmount}, have ${totalValue}`);
    return null; // 余额不足
}

function createP2PKHScript(address) {
    // 解码地址获取 pubKeyHash
    const decoded = bs58.decode(address);
    const hex = decoded.map(b => b.toString(16).padStart(2, '0')).join('');
    const pubKeyHash = hex.substring(2, 42); // 移除版本字节和校验和
    
    // 创建 P2PKH 脚本: OP_DUP OP_HASH160 <pubKeyHash> OP_EQUALVERIFY OP_CHECKSIG
    return '76a914' + pubKeyHash + '88ac';
}

// OP_RETURN 数据处理函数
function getOpReturnFormat() {
    const formatRadio = document.querySelector('input[name="opReturnFormat"]:checked');
    return formatRadio ? formatRadio.value : 'string';
}

function updateOpReturnPlaceholder() {
    const format = getOpReturnFormat();
    const textarea = document.getElementById('opReturnData');
    const helpText = document.getElementById('opReturnHelp');
    
    if (format === 'hex') {
        textarea.placeholder = '输入十六进制数据\n例如: 48656c6c6f20446f6765636f696e21\n(对应 "Hello Dogecoin!")\n最大80字节';
        helpText.textContent = 'OP_RETURN十六进制格式：输入原始十六进制数据，支持不可见字符';
    } else {
        textarea.placeholder = '输入要在区块链上记录的数据\n例如: Hello Dogecoin!\n最大80字节';
        helpText.textContent = 'OP_RETURN允许在交易中包含任意数据，永久记录在区块链上';
    }
}

function validateOpReturnData(data, format) {
    if (!data) return { valid: true, processedData: '', byteLength: 0 };
    
    let processedData = '';
    let byteLength = 0;
    
    if (format === 'hex') {
        // 验证十六进制格式
        const cleanHex = data.replace(/\s+/g, ''); // 移除空格
        if (!/^[0-9a-fA-F]*$/.test(cleanHex)) {
            return { valid: false, error: '十六进制格式无效：只能包含0-9和a-f字符' };
        }
        if (cleanHex.length % 2 !== 0) {
            return { valid: false, error: '十六进制格式无效：字符数必须是偶数' };
        }
        
        processedData = cleanHex.toLowerCase();
        byteLength = cleanHex.length / 2;
    } else {
        // 字符串格式
        processedData = data;
        byteLength = new TextEncoder().encode(data).length; // 使用UTF-8字节长度
    }
    
    if (byteLength > 80) {
        return { valid: false, error: `数据过长：${byteLength}字节，最大80字节` };
    }
    
    return { valid: true, processedData, byteLength };
}

function createOpReturnScript(data, format = 'string') {
    if (!data) return '';
    
    let dataHex = '';
    
    if (format === 'hex') {
        // 十六进制格式：直接使用
        dataHex = data.replace(/\s+/g, '').toLowerCase();
    } else {
        // 字符串格式：转换为UTF-8字节然后转十六进制
        const encoder = new TextEncoder();
        const bytes = encoder.encode(data);
        dataHex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    
    const dataLength = (dataHex.length / 2).toString(16).padStart(2, '0');
    
    // 创建 OP_RETURN 脚本: OP_RETURN <length> <data>
    return '6a' + dataLength + dataHex;
}

async function signTransaction(tx, utxos, privateKeyWIF) {
    try {
        // 将 WIF 转换为私钥
        const privateKeyHex = wifToPrivateKey(privateKeyWIF);
        console.log('Private key hex:', privateKeyHex);
        
        const keyPair = secp256k1.keyFromPrivate(privateKeyHex, 'hex');
        console.log('KeyPair created successfully');
        
        // 测试签名函数是否存在
        if (typeof keyPair.sign !== 'function') {
            throw new Error('keyPair.sign is not a function');
        }
        
        // 为每个输入创建签名
        for (let i = 0; i < tx.inputs.length; i++) {
            const input = tx.inputs[i];
            const utxo = utxos.find(u => u.txid === input.txid && u.vout === input.vout);
            
            if (!utxo) {
                throw new Error(`找不到 UTXO: ${input.txid}:${input.vout}`);
            }
            
            // 创建签名哈希
            const sigHash = createSignatureHash(tx, i, wallet.address);
            console.log('Signature hash for input', i, ':', sigHash);
            
            // 签名
            const signature = keyPair.sign(sigHash);
            console.log('Signature created:', signature);
            
            const derSignature = signature.toDER();
            console.log('DER signature:', derSignature);
            
            // 创建 scriptSig
            const publicKey = keyPair.getPublic('hex');
            const sigScript = createSigScript(derSignature, publicKey);
            
            tx.inputs[i].scriptSig = sigScript;
        }
        
        return tx;

    } catch (error) {
        console.error('Error signing transaction:', error);
        throw new Error('签名交易失败: ' + error.message);
    }
}

function createSignatureHash(tx, inputIndex, fromAddress) {
    // 简化的签名哈希创建（SIGHASH_ALL）
    let txCopy = JSON.parse(JSON.stringify(tx));
    
    // 清空所有输入的 scriptSig
    for (let i = 0; i < txCopy.inputs.length; i++) {
        if (i === inputIndex) {
            // 当前输入使用前一个输出的 scriptPubKey
            txCopy.inputs[i].scriptSig = createP2PKHScript(fromAddress);
        } else {
            txCopy.inputs[i].scriptSig = '';
        }
    }
    
    // 序列化并添加 SIGHASH_ALL
    const serialized = serializeTransactionForSigning(txCopy);
    const withSigHashType = serialized + '01000000'; // SIGHASH_ALL
    
    // 双重 SHA256
    const hash1 = sha256(CryptoJS.enc.Hex.parse(withSigHashType));
    const hash2 = sha256(hash1);
    
    // 返回十六进制字符串，签名函数会处理转换
    return hash2.toString();
}

function createSigScript(derSignature, publicKey) {
    // DER 签名 + SIGHASH_ALL (0x01)
    const sigWithHashType = derSignature + '01';
    const sigLength = (sigWithHashType.length / 2).toString(16).padStart(2, '0');
    const pubKeyLength = (publicKey.length / 2).toString(16).padStart(2, '0');
    
    return sigLength + sigWithHashType + pubKeyLength + publicKey;
}

function serializeTransaction(tx) {
    let result = '';
    
    console.log('Serializing transaction:', JSON.stringify(tx, null, 2));
    
    // Version (4 bytes, little endian)
    result += reverseHex(tx.version.toString(16).padStart(8, '0'));
    console.log('Version:', tx.version, '-> hex:', reverseHex(tx.version.toString(16).padStart(8, '0')));
    
    // Input count
    const inputCountHex = encodeVarInt(tx.inputs.length);
    result += inputCountHex;
    console.log('Input count:', tx.inputs.length, '-> hex:', inputCountHex);
    
    // Inputs
    for (let i = 0; i < tx.inputs.length; i++) {
        const input = tx.inputs[i];
        console.log(`Processing input ${i}:`, input);
        
        // Previous transaction hash (32 bytes, little endian)
        if (!input.txid || input.txid.length !== 64) {
            throw new Error(`Invalid txid for input ${i}: ${input.txid}`);
        }
        const txidHex = reverseHex(input.txid);
        result += txidHex;
        
        // Previous output index (4 bytes, little endian)
        if (typeof input.vout !== 'number' || input.vout < 0) {
            throw new Error(`Invalid vout for input ${i}: ${input.vout}`);
        }
        const voutHex = reverseHex(input.vout.toString(16).padStart(8, '0'));
        result += voutHex;
        
        // Script length and script
        const scriptSig = input.scriptSig || '';
        if (scriptSig.length % 2 !== 0) {
            throw new Error(`Invalid scriptSig length for input ${i}: ${scriptSig.length}`);
        }
        const scriptLengthHex = encodeVarInt(scriptSig.length / 2);
        result += scriptLengthHex;
        result += scriptSig;
        
        // Sequence (4 bytes, little endian)
        const sequence = input.sequence || 0xffffffff;
        const sequenceHex = reverseHex(sequence.toString(16).padStart(8, '0'));
        result += sequenceHex;
        
        console.log(`Input ${i} serialized: txid=${txidHex}, vout=${voutHex}, scriptLen=${scriptLengthHex}, script=${scriptSig}, seq=${sequenceHex}`);
    }
    
    // Output count
    const outputCountHex = encodeVarInt(tx.outputs.length);
    result += outputCountHex;
    console.log('Output count:', tx.outputs.length, '-> hex:', outputCountHex);
    
    // Outputs
    for (let i = 0; i < tx.outputs.length; i++) {
        const output = tx.outputs[i];
        console.log(`Processing output ${i}:`, output);
        
        // Value (8 bytes, little endian)
        if (typeof output.value !== 'number' || output.value < 0) {
            throw new Error(`Invalid value for output ${i}: ${output.value}`);
        }
        const valueHex = reverseHex(output.value.toString(16).padStart(16, '0'));
        result += valueHex;
        
        // Script length and script
        const scriptPubKey = output.scriptPubKey || '';
        if (scriptPubKey.length % 2 !== 0) {
            throw new Error(`Invalid scriptPubKey length for output ${i}: ${scriptPubKey.length}`);
        }
        const scriptLengthHex = encodeVarInt(scriptPubKey.length / 2);
        result += scriptLengthHex;
        result += scriptPubKey;
        
        console.log(`Output ${i} serialized: value=${valueHex}, scriptLen=${scriptLengthHex}, script=${scriptPubKey}`);
    }
    
    // Locktime (4 bytes, little endian)
    const locktime = tx.locktime || 0;
    const locktimeHex = reverseHex(locktime.toString(16).padStart(8, '0'));
    result += locktimeHex;
    console.log('Locktime:', locktime, '-> hex:', locktimeHex);
    
    console.log('Final serialized transaction:', result);
    return result;
}

function serializeTransactionForSigning(tx) {
    // 用于签名的序列化，不输出调试信息
    let result = '';
    
    // Version (4 bytes, little endian)
    result += reverseHex(tx.version.toString(16).padStart(8, '0'));
    
    // Input count
    result += encodeVarInt(tx.inputs.length);
    
    // Inputs
    for (let i = 0; i < tx.inputs.length; i++) {
        const input = tx.inputs[i];
        
        // Previous transaction hash (32 bytes, little endian)
        result += reverseHex(input.txid);
        
        // Previous output index (4 bytes, little endian)
        result += reverseHex(input.vout.toString(16).padStart(8, '0'));
        
        // Script length and script
        const scriptSig = input.scriptSig || '';
        result += encodeVarInt(scriptSig.length / 2);
        result += scriptSig;
        
        // Sequence (4 bytes, little endian)
        const sequence = input.sequence || 0xffffffff;
        result += reverseHex(sequence.toString(16).padStart(8, '0'));
    }
    
    // Output count
    result += encodeVarInt(tx.outputs.length);
    
    // Outputs
    for (let i = 0; i < tx.outputs.length; i++) {
        const output = tx.outputs[i];
        
        // Value (8 bytes, little endian)
        result += reverseHex(output.value.toString(16).padStart(16, '0'));
        
        // Script length and script
        const scriptPubKey = output.scriptPubKey || '';
        result += encodeVarInt(scriptPubKey.length / 2);
        result += scriptPubKey;
    }
    
    // Locktime (4 bytes, little endian)
    const locktime = tx.locktime || 0;
    result += reverseHex(locktime.toString(16).padStart(8, '0'));
    
    return result;
}

function encodeVarInt(value) {
    if (value < 0) {
        throw new Error('VarInt value cannot be negative: ' + value);
    }
    
    if (value < 0xfd) {
        return value.toString(16).padStart(2, '0');
    } else if (value <= 0xffff) {
        return 'fd' + reverseHex(value.toString(16).padStart(4, '0'));
    } else if (value <= 0xffffffff) {
        return 'fe' + reverseHex(value.toString(16).padStart(8, '0'));
    } else {
        return 'ff' + reverseHex(value.toString(16).padStart(16, '0'));
    }
}

function reverseHex(hex) {
    // 将十六进制字符串按字节反转（小端序）
    let result = '';
    for (let i = hex.length - 2; i >= 0; i -= 2) {
        result += hex.substr(i, 2);
    }
    return result;
}

async function broadcastTransaction(txHex) {
    try {
        console.log('Broadcasting transaction hex:', txHex);
        console.log('Transaction hex length:', txHex.length);
        
        // 暂时跳过 RPC，直接使用 Electrs API 进行调试
        console.log('Using Electrs API for broadcast...');
        
        const baseUrl = getElectrsUrl();
        const apiUrl = `${baseUrl}/tx`;
        
        // 首先尝试直接调用（如果在本地环境）
        let finalUrl = apiUrl;
        let useProxy = true;
        
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            useProxy = false;
        } else {
            finalUrl = getCorsProxyUrl(apiUrl);
        }
        
        console.log('Broadcasting to URL:', finalUrl, useProxy ? '(via proxy)' : '(direct)');
        
        const response = await fetch(finalUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: txHex
        });
        
        console.log('Broadcast response status:', response.status);
        console.log('Broadcast response headers:', response.headers);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.log('Broadcast error response:', errorText);
            
            // 如果通过代理失败，尝试直接调用
            if (useProxy && response.status >= 400) {
                console.log('Proxy failed, trying direct API call...');
                return await broadcastTransactionDirect(txHex);
            }
            
            // 尝试解析错误信息
            let errorMessage = errorText;
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.error && errorJson.error.message) {
                    errorMessage = errorJson.error.message;
                } else if (errorJson.message) {
                    errorMessage = errorJson.message;
                }
            } catch (e) {
                // 如果不是JSON，使用原始错误文本
            }
            
            // 为常见错误提供更友好的提示
            if (errorMessage.includes('Missing inputs')) {
                errorMessage = '交易输入无效：所使用的 UTXO 可能已被花费。\n请刷新余额并重试，或等待新的交易确认。';
            } else if (errorMessage.includes('insufficient fee')) {
                errorMessage = '手续费不足，请增加手续费后重试。';
            } else if (errorMessage.includes('dust')) {
                errorMessage = '交易金额过小（粉尘交易），请增加发送金额。';
            }
            
            throw new Error(`广播失败 (${response.status}): ${errorMessage}`);
        }
        
        const txid = await response.text();
        console.log('Broadcast successful, txid:', txid);
        return txid.trim();
        
    } catch (error) {
        console.error('Error broadcasting transaction:', error);
        throw new Error('广播交易失败: ' + error.message);
    }
}

async function broadcastTransactionDirect(txHex) {
    try {
        const baseUrl = getElectrsUrl();
        const apiUrl = `${baseUrl}/tx`;

        console.log('Direct broadcast to:', apiUrl);
        
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: txHex
        });
        
        console.log('Direct broadcast response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.log('Direct broadcast error response:', errorText);
            throw new Error(`直接广播失败 (${response.status}): ${errorText}`);
        }
        
        const txid = await response.text();
        console.log('Direct broadcast successful, txid:', txid);
        return txid.trim();
        
    } catch (error) {
        console.error('Error in direct broadcast:', error);
        throw error;
    }
}

// Block info functions
async function refreshBlockInfo() {
    if (useElectrs) {
        await refreshBlockInfoElectrs();
    } else {
        showAlert('RPC区块信息查询功能暂未实现', 'error');
    }
}

async function refreshBlockInfoElectrs() {
    try {
        const baseUrl = getElectrsUrl();

        // 使用不同的API端点来获取区块信息
        let apiUrl, finalUrl, response;
        
        if (useElectrsProxy) {
            // 代理模式：使用简单的API端点
            apiUrl = `${baseUrl}/blocks/tip-height`;
            response = await fetch(apiUrl);
        } else {
            // 直连模式：尝试不同的API端点
            apiUrl = `${baseUrl}/blocks/tip-height`;
            finalUrl = getCorsProxyUrl(apiUrl);
            response = await fetch(finalUrl);
            
            // 如果失败，尝试备用端点
            if (!response.ok) {
                apiUrl = `${baseUrl}/api/blocks/tip-height`;
                finalUrl = getCorsProxyUrl(apiUrl);
                response = await fetch(finalUrl);
            }
        }

        if (response.ok) {
            const responseText = await response.text();
            console.log('Block height response:', responseText);
            
            let height;
            let blockHash = '获取中...';
            try {
                // 尝试解析为JSON
                const jsonData = JSON.parse(responseText);
                if (Array.isArray(jsonData) && jsonData.length > 0) {
                    // 如果是数组格式，取第一个元素（最新区块）
                    height = jsonData[0].height;
                    blockHash = jsonData[0].id || '未知';
                } else if (jsonData.height) {
                    // 如果是对象格式
                    height = jsonData.height;
                    blockHash = jsonData.id || jsonData.hash || '未知';
                } else {
                    // 如果是纯数字
                    height = jsonData;
                }
            } catch {
                // 如果不是JSON，尝试解析为纯文本数字
                height = parseInt(responseText.trim());
            }
            
            if (isNaN(height)) {
                throw new Error('无法解析区块高度: ' + responseText);
            }
            
            // 如果JSON中没有包含区块哈希，则单独获取
            if (blockHash === '获取中...') {
                try {
                    const blockHashUrl = useElectrsProxy ? 
                        `${baseUrl}/block-height/${height}` : 
                        getCorsProxyUrl(`${baseUrl}/block-height/${height}`);
                        
                    const blockHashResponse = await fetch(blockHashUrl);
                    if (blockHashResponse.ok) {
                        blockHash = await blockHashResponse.text();
                        blockHash = blockHash.trim();
                        
                        // 验证哈希格式（应该是64个十六进制字符）
                        if (!/^[a-fA-F0-9]{64}$/.test(blockHash)) {
                            blockHash = '格式错误';
                        }
                    }
                } catch (hashError) {
                    console.error('Failed to get block hash:', hashError);
                    blockHash = '获取失败';
                }
            }
            
            // 验证区块哈希格式
            if (blockHash !== '获取中...' && blockHash !== '获取失败' && blockHash !== '格式错误' && blockHash !== '未知') {
                if (!/^[a-fA-F0-9]{64}$/.test(blockHash)) {
                    blockHash = '格式错误';
                }
            }

            document.getElementById('blockHeight').textContent = height.toString();
            document.getElementById('latestBlock').textContent = blockHash.length > 16 ? 
                blockHash.substring(0, 16) + '...' : blockHash;
            
            // 只在手动刷新时显示成功提示
            if (!blockInfoInterval) {
                const method = useElectrsProxy ? '代理' : '直连';
                showAlert(`区块信息已更新 (Electrs ${method})\n高度: ${height}`, 'success');
            }
        } else {
            throw new Error(`Electrs查询失败: ${response.status} ${response.statusText}`);
        }
    } catch (error) {
        console.error('Block info refresh error:', error);
        document.getElementById('blockHeight').textContent = '未知';
        document.getElementById('latestBlock').textContent = 'API不可用';
        
        const method = useElectrsProxy ? '代理' : '直连';
        let errorMessage = error.message;
        
        if (error.message.includes('CORS') || error.message.includes('Failed to fetch')) {
            errorMessage = 'CORS跨域错误 - 请使用本地服务器或启用代理模式';
        }
        
        // 只在手动刷新时显示错误提示
        if (!blockInfoInterval) {
            showAlert(`Electrs区块信息查询失败 (${method}): ${errorMessage}`, 'error');
        } else {
            console.error(`Auto refresh block info failed: ${errorMessage}`);
        }
    }
}

function refreshHistory() {
    showAlert('交易历史已刷新', 'success');
}

// Transaction utility functions
function estimateTransactionSize(inputCount, outputCount, hasOpReturn = false) {
    // 基本交易大小估算
    const baseSize = 10; // version (4) + input count (1) + output count (1) + locktime (4)
    const inputSize = inputCount * 148; // 每个输入约 148 字节
    let outputSize = outputCount * 34; // 每个输出约 34 字节
    
    if (hasOpReturn) {
        outputSize += 50; // OP_RETURN 输出额外大小
    }
    
    return baseSize + inputSize + outputSize;
}

function calculateRecommendedFee(txSize) {
    // Dogecoin 推荐费率：1 DOGE per KB
    const feePerByte = 1 / 1024; // 1 DOGE per 1024 bytes
    const recommendedFee = Math.max(0.001, (txSize * feePerByte)); // 最小 0.001 DOGE
    return Math.ceil(recommendedFee * 1000) / 1000; // 保留 3 位小数
}

async function validateTransaction(toAddress, amount, fee) {
    const errors = [];
    
    if (!wallet.address || !wallet.privateKey) {
        errors.push('请先生成或导入钱包');
    }
    
    if (toAddress && !isValidAddress(toAddress)) {
        errors.push('接收地址格式无效');
    }
    
    if (amount && (isNaN(amount) || amount <= 0)) {
        errors.push('发送数量必须大于 0');
    }
    
    if (isNaN(fee) || fee <= 0) {
        errors.push('手续费必须大于 0');
    }
    
    if (fee < 0.001) {
        errors.push('手续费不能低于 0.001 DOGE');
    }
    
    if (!wallet.balanceAvailable) {
        errors.push('请先刷新余额');
    }
    
    const totalAmount = (amount || 0) + fee;
    if (wallet.balanceAvailable && totalAmount > wallet.balance) {
        errors.push(`余额不足：需要 ${totalAmount.toFixed(8)} DOGE，可用 ${wallet.balance.toFixed(8)} DOGE`);
    }
    
    return errors;
}

// 添加交易预览功能
async function previewTransaction() {
    const toAddress = document.getElementById('toAddress').value.trim();
    const amount = parseFloat(document.getElementById('amount').value) || 0;
    const fee = parseFloat(document.getElementById('fee').value) || 0;
    const opReturnData = document.getElementById('opReturnData').value.trim();
    
    const errors = await validateTransaction(toAddress, amount, fee);
    if (errors.length > 0) {
        showAlert('交易验证失败：\n' + errors.join('\n'), 'error');
        return;
    }
    
    try {
        // 获取 UTXO 来估算交易大小
        const utxos = await getUTXOs(wallet.address);
        const amountSatoshi = Math.round(amount * 100000000);
        const feeSatoshi = Math.round(fee * 100000000);
        const selectedUtxos = selectUTXOs(utxos, amountSatoshi + feeSatoshi);
        
        if (!selectedUtxos) {
            showAlert('没有足够的 UTXO', 'error');
            return;
        }
        
        const inputCount = selectedUtxos.length;
        const outputCount = (amount > 0 ? 1 : 0) + (opReturnData ? 1 : 0) + 1; // +1 for change
        const txSize = estimateTransactionSize(inputCount, outputCount, !!opReturnData);
        const recommendedFee = calculateRecommendedFee(txSize);
        
        const totalInput = selectedUtxos.reduce((sum, utxo) => sum + utxo.value, 0) / 100000000;
        const change = totalInput - amount - fee;
        
        let preview = `交易预览：\n\n`;
        if (amount > 0) {
            preview += `发送到: ${toAddress}\n`;
            preview += `金额: ${amount.toFixed(8)} DOGE\n`;
        }
        if (opReturnData) {
            preview += `OP_RETURN: ${opReturnData}\n`;
        }
        preview += `手续费: ${fee.toFixed(8)} DOGE\n`;
        preview += `找零: ${change.toFixed(8)} DOGE\n\n`;
        preview += `使用 UTXO: ${inputCount} 个\n`;
        preview += `交易大小: ~${txSize} 字节\n`;
        preview += `推荐手续费: ${recommendedFee.toFixed(3)} DOGE\n\n`;
        
        if (fee < recommendedFee) {
            preview += `⚠️ 手续费可能过低，建议至少 ${recommendedFee.toFixed(3)} DOGE`;
        } else {
            preview += `✅ 手续费合理`;
        }
        
        showAlert(preview, 'success');
        
    } catch (error) {
        showAlert('预览交易失败: ' + error.message, 'error');
    }
}

// 计算推荐手续费
async function calculateFee() {
    if (!wallet.address || !wallet.balanceAvailable) {
        showAlert('请先生成钱包并刷新余额', 'error');
        return;
    }
    
    try {
        const toAddress = document.getElementById('toAddress').value.trim();
        const amount = parseFloat(document.getElementById('amount').value) || 0;
        const opReturnData = document.getElementById('opReturnData').value.trim();
        
        // 获取 UTXO 来估算交易大小
        const utxos = await getUTXOs(wallet.address);
        if (!utxos || utxos.length === 0) {
            showAlert('没有可用的 UTXO', 'error');
            return;
        }
        
        // 估算需要的 UTXO 数量（使用临时手续费）
        const tempFee = 0.01; // 临时手续费用于估算
        const amountSatoshi = Math.round(amount * 100000000);
        const tempFeeSatoshi = Math.round(tempFee * 100000000);
        const selectedUtxos = selectUTXOs(utxos, amountSatoshi + tempFeeSatoshi);
        
        if (!selectedUtxos) {
            showAlert('余额不足以支付交易', 'error');
            return;
        }
        
        const inputCount = selectedUtxos.length;
        const outputCount = (amount > 0 ? 1 : 0) + (opReturnData ? 1 : 0) + 1; // +1 for change
        const txSize = estimateTransactionSize(inputCount, outputCount, !!opReturnData);
        const recommendedFee = calculateRecommendedFee(txSize);
        
        // 更新手续费输入框
        document.getElementById('fee').value = recommendedFee.toFixed(3);
        
        showAlert(`推荐手续费已计算：${recommendedFee.toFixed(3)} DOGE\n交易大小：~${txSize} 字节\n使用 UTXO：${inputCount} 个`, 'success');
        
    } catch (error) {
        showAlert('计算手续费失败: ' + error.message, 'error');
    }
}

// Test wallet function
function newWallet() {
    if (!secp256k1) {
        showAlert('加密库未初始化，请刷新页面', 'error');
        return;
    }

    try {
        const privateKeyHex = generatePrivateKey();
        const publicKeyHex = getPublicKey(privateKeyHex);
        const wif = privateKeyToWIF(privateKeyHex);
        const address = publicKeyToAddress(publicKeyHex);

        // 测试签名功能
        const keyPair = secp256k1.keyFromPrivate(privateKeyHex, 'hex');
        const testMessage = 'test message hash';
        const testHash = sha256(CryptoJS.enc.Utf8.parse(testMessage)).toString();
        
        try {
            const signature = keyPair.sign(testHash);
            const derSignature = signature.toDER();
            console.log('Signature test successful:', derSignature);
        } catch (signError) {
            console.error('Signature test failed:', signError);
            showAlert('签名测试失败: ' + signError.message, 'error');
            return;
        }

        const walletData = {
            address: address,
            network: 'testnet',
            privateKey: wif,
            utxos: [],
        };

        const message = `✓ Wallet created successfully via newWallet()\n\nAddress:\n${walletData.address}\n\nPrivate Key:\n${walletData.privateKey}\n\n(This test wallet is NOT saved or loaded in the UI)`;
        showAlert(message, 'success');
        return walletData;
    } catch (error) {
        showAlert('Test wallet creation failed: ' + error.message, 'error');
    }
}

// Alert system
function showAlert(message, type) {
    const alertsDiv = document.getElementById('alerts');
    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    alert.style.whiteSpace = 'pre-line';
    alert.textContent = message;

    alertsDiv.appendChild(alert);

    setTimeout(() => {
        alert.classList.add('show');
    }, 10);

    setTimeout(() => {
        alert.classList.remove('show');
        setTimeout(() => {
            if (alert.parentNode) {
                alert.remove();
            }
        }, 300);
    }, 4000);

    const alerts = alertsDiv.querySelectorAll('.alert');
    if (alerts.length > 5) {
        alerts[0].remove();
    }
}

// Restore wallet on page load
function restoreWallet() {
    const savedUseElectrs = getCookie('use_electrs');
    if (savedUseElectrs !== null) {
        useElectrs = savedUseElectrs === 'true';
        const radio = document.querySelector(`input[name="queryMethod"][value="${useElectrs ? 'electrs' : 'rpc'}"]`);
        if (radio) radio.checked = true;
    }

    const savedUseProxy = getCookie('use_electrs_proxy');
    if (savedUseProxy !== null) {
        useElectrsProxy = savedUseProxy === 'true';
        const proxyCheckbox = document.getElementById('useProxy');
        if (proxyCheckbox) proxyCheckbox.checked = useElectrsProxy;
    }

    // 检测是否在本地服务器环境，如果是则自动禁用代理
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        useElectrsProxy = false;
        const proxyCheckbox = document.getElementById('useProxy');
        if (proxyCheckbox) {
            proxyCheckbox.checked = false;
            proxyCheckbox.disabled = true;
        }
        // 添加提示
        const proxyLabel = proxyCheckbox?.parentElement;
        if (proxyLabel) {
            proxyLabel.style.opacity = '0.5';
            proxyLabel.title = '本地服务器环境下自动禁用代理模式';
        }
    }

    const electrsOptions = document.getElementById('electrsOptions');
    if (electrsOptions) {
        electrsOptions.style.display = useElectrs ? 'flex' : 'none';
    }

    const currentAddress = getCookie('current_wallet_address');
    if (currentAddress) {
        loadWallet(currentAddress);
    } else {
        // 如果没有当前钱包，只更新选择器
        updateWalletSelector();
        // 不自动测试连接，避免 404 错误
        document.getElementById('rpcStatus').textContent = '点击测试按钮检查连接';
        document.getElementById('rpcStatus').style.color = '#666';
    }
    
    // 自动启动余额自动刷新
    startAutoRefresh();
    
    // 自动启动区块链信息自动刷新
    startBlockInfoAutoRefresh();
    
    // 立即刷新一次区块链信息
    setTimeout(() => {
        refreshBlockInfo();
    }, 1000);
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    if (initializeCrypto()) {
        console.log('Dogecoin wallet initialized successfully');
        restoreWallet();
        
        // Expose functions to global scope for HTML onclick events
        window.generateWallet = generateWallet;
        window.importWallet = importWallet;
        window.switchWallet = switchWallet;
        window.deleteCurrentWallet = deleteCurrentWallet;
        window.copyAddress = copyAddress;
        window.copyPrivateKey = copyPrivateKey;
        window.refreshBalance = refreshBalance;
        window.switchQueryMethod = switchQueryMethod;
        window.toggleElectrsProxy = toggleElectrsProxy;
        window.testConnection = testConnection;
        window.sendTransaction = sendTransaction;
        window.sendOpReturnOnly = sendOpReturnOnly;
        window.previewTransaction = previewTransaction;
        window.calculateFee = calculateFee;
        window.refreshBlockInfo = refreshBlockInfo;
        window.refreshHistory = refreshHistory;
        window.newWallet = newWallet;
        window.testRPCConnection = testRPCConnection;
        window.startAutoRefresh = startAutoRefresh;
        window.stopAutoRefresh = stopAutoRefresh;
    }
});

// RPC Configuration
const RPC_CONFIG = {
    url: 'http://shu.unifra.xyz:44555/',
    username: 'user',
    password: 'password_test'
};

// 添加 RPC 调用函数
async function callRPC(method, params = []) {
    try {
        const auth = btoa(`${RPC_CONFIG.username}:${RPC_CONFIG.password}`);
        
        const requestBody = {
            jsonrpc: '2.0',
            id: Date.now(),
            method: method,
            params: params
        };
        
        console.log('RPC request to:', RPC_CONFIG.url);
        console.log('RPC request body:', requestBody);
        
        const response = await fetch(RPC_CONFIG.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${auth}`
            },
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            throw new Error(`RPC request failed: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('RPC response:', data);
        
        if (data.error) {
            throw new Error(`RPC error: ${data.error.code} - ${data.error.message}`);
        }
        
        return data.result;
        
    } catch (error) {
        console.error('RPC call failed:', error);
        
        // 如果是 CORS 错误，提供解决方案
        if (error.message.includes('CORS') || error.message.includes('Failed to fetch')) {
            throw new Error('CORS 错误：需要在本地服务器环境中运行，或者配置 RPC 服务器允许跨域访问');
        }
        
        throw error;
    }
}

async function testRPCConnection() {
    try {
        console.log('Testing RPC connection...');
        const blockCount = await callRPC('getblockcount');
        console.log('RPC connection successful, block count:', blockCount);
        
        const networkInfo = await callRPC('getnetworkinfo');
        console.log('Network info:', networkInfo);
        
        showAlert(`RPC 连接成功！\n当前区块高度: ${blockCount}\n网络: ${networkInfo.subversion}`, 'success');
        
        // 更新状态显示
        document.getElementById('rpcStatus').textContent = `RPC 连接正常 (区块: ${blockCount})`;
        document.getElementById('rpcStatus').style.color = '#28a745';
        
        return true;
    } catch (error) {
        console.error('RPC connection test failed:', error);
        showAlert(`RPC 连接失败: ${error.message}`, 'error');
        
        document.getElementById('rpcStatus').textContent = 'RPC 连接失败';
        document.getElementById('rpcStatus').style.color = '#dc3545';
        
        return false;
    }
}

// 更新自动刷新状态显示
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

// 启动自动刷新
function startAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
    
    autoRefreshInterval = setInterval(async () => {
        if (wallet.address && wallet.balanceAvailable) {
            try {
                console.log('Auto refreshing balance...');
                await refreshBalance();
            } catch (error) {
                console.error('Auto refresh failed:', error);
            }
        }
    }, AUTO_REFRESH_INTERVAL);
    
    console.log('Auto refresh started (every 30 seconds)');
    updateAutoRefreshStatus();
}

// 停止自动刷新
function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
        console.log('Auto refresh stopped');
    }
    updateAutoRefreshStatus();
}

// 在交易成功后自动刷新余额
async function refreshBalanceAfterTransaction() {
    try {
        console.log('Refreshing balance after transaction...');
        // 等待几秒让交易传播
        setTimeout(async () => {
            await refreshBalance();
        }, 3000);
    } catch (error) {
        console.error('Failed to refresh balance after transaction:', error);
    }
}

// 启动区块链信息自动刷新
function startBlockInfoAutoRefresh() {
    if (blockInfoInterval) {
        clearInterval(blockInfoInterval);
    }
    
    blockInfoInterval = setInterval(async () => {
        try {
            console.log('Auto refreshing block info...');
            await refreshBlockInfo();
        } catch (error) {
            console.error('Auto block info refresh failed:', error);
        }
    }, BLOCK_INFO_REFRESH_INTERVAL);
    
    console.log('Block info auto refresh started (every 1 second)');
    updateBlockInfoStatus();
}

// 停止区块链信息自动刷新
function stopBlockInfoAutoRefresh() {
    if (blockInfoInterval) {
        clearInterval(blockInfoInterval);
        blockInfoInterval = null;
        console.log('Block info auto refresh stopped');
    }
    updateBlockInfoStatus();
}

// 更新区块链信息自动刷新状态显示
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

// 切换区块链信息自动刷新
function toggleBlockInfoAutoRefresh() {
    const toggleBtn = document.getElementById('blockInfoToggleBtn');
    
    if (blockInfoInterval) {
        // 当前正在自动刷新，停止它
        stopBlockInfoAutoRefresh();
        if (toggleBtn) {
            toggleBtn.textContent = '开启自动刷新';
            toggleBtn.style.background = '#28a745';
        }
        showAlert('区块链信息自动刷新已停止', 'success');
    } else {
        // 当前未自动刷新，启动它
        startBlockInfoAutoRefresh();
        if (toggleBtn) {
            toggleBtn.textContent = '停止自动刷新';
            toggleBtn.style.background = '#dc3545';
        }
        showAlert('区块链信息自动刷新已启动 (每1秒)', 'success');
        
        // 立即刷新一次
        refreshBlockInfo();
    }
}