import { wallet } from './wallet.js';
import { getUTXOs, broadcastTransaction, fetchMempoolTransactions } from './network.js';
import { sha256Double } from './crypto-utils.js';
import { saveBroadcastedTxToDB, getBroadcastedTxsFromDB, getPendingTxsFromDB, updateTxStatusInDB } from './storage.js';
import { showAlert, updateWalletUI } from './ui.js'; // Added updateWalletUI for balance refresh

// Helper function to convert a number to a little-endian hex string of a specific byte length
function toLittleEndianHex(value, byteLength) {
    let hexString = BigInt(value).toString(16);
    if (hexString.length % 2 !== 0) {
        hexString = '0' + hexString;
    }
    while (hexString.length < byteLength * 2) {
        hexString = '00' + hexString;
    }
    hexString = hexString.slice(-byteLength * 2); // Ensure correct length from the end

    let littleEndianHex = '';
    for (let i = 0; i < byteLength; i++) {
        littleEndianHex += hexString.substring(hexString.length - (i + 1) * 2, hexString.length - i * 2);
    }
    return littleEndianHex;
}

function selectUTXOs(utxos, amountToSendSatoshis, feePerByte = 100) {
    let selectedUtxos = [];
    let currentTotalValue = 0;
    let estimatedFee = 0;

    // Sort UTXOs: smallest first to try and match amount, or largest first to minimize inputs
    // For simplicity, using smallest first. Could be optimized.
    const sortedUtxos = [...utxos].sort((a, b) => a.value - b.value); 

    for (const utxo of sortedUtxos) {
        selectedUtxos.push(utxo);
        currentTotalValue += utxo.value;

        // Estimate fee with current selected inputs and 2 outputs (recipient, change)
        // This is iterative and approximate.
        const numOutputs = 2; // Assume recipient and change for fee estimation
        estimatedFee = calculateActualEstimatedFee(selectedUtxos.length, numOutputs, feePerByte);

        if (currentTotalValue >= (amountToSendSatoshis + estimatedFee)) {
            return {
                selectedUtxos: selectedUtxos,
                totalInputAmount: currentTotalValue,
                estimatedFee: estimatedFee
            };
        }
    }

    return null;
}

function createP2PKHScript(address) {
    const decoded = bs58.decode(address);
    const hex = decoded.map(b => b.toString(16).padStart(2, '0')).join('');
    const pubKeyHash = hex.substring(2, 42);
    return '76a914' + pubKeyHash + '88ac';
}

function createOpReturnScript(data, format = 'string') {
    if (!data) return '';
    
    let dataHex = '';
    if (format === 'hex') {
        dataHex = data.replace(/\s+/g, '').toLowerCase();
    } else {
        const encoder = new TextEncoder();
        const bytes = encoder.encode(data);
        dataHex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    
    const dataLength = (dataHex.length / 2).toString(16).padStart(2, '0');
    return '6a' + dataLength + dataHex;
}

function createSignInputScript(signatureHexWithSighash, publicKeyHex) {
    const sigLenHex = (signatureHexWithSighash.length / 2).toString(16).padStart(2, '0');
    const pubKeyLenHex = (publicKeyHex.length / 2).toString(16).padStart(2, '0');
    return sigLenHex + signatureHexWithSighash + pubKeyLenHex + publicKeyHex;
}

function serializeTransaction(tx) {
    let serialized = '';
    serialized += tx.version.toString(16).padStart(8, '0');
    serialized += tx.inputCount.toString(16).padStart(2, '0');

    tx.inputs.forEach(input => {
        serialized += reverseHex(input.txid);
        serialized += toLittleEndianHex(input.vout, 4); // vout is 4 bytes LE
        serialized += input.scriptLength.toString(16).padStart(2, '0');
        serialized += input.script;
        serialized += input.sequence.toString(16).padStart(8, '0');
    });

    serialized += tx.outputCount.toString(16).padStart(2, '0');
    tx.outputs.forEach(output => {
        serialized += toLittleEndianHex(output.value, 8); // value is 8 bytes LE
        serialized += output.scriptLength.toString(16).padStart(2, '0');
        serialized += output.script;
    });

    serialized += tx.locktime.toString(16).padStart(8, '0');
    return serialized;
}

function reverseHex(hex) {
    let result = '';
    for (let i = hex.length - 2; i >= 0; i -= 2) {
        result += hex.substr(i, 2);
    }
    return result;
}

function calculateActualEstimatedFee(numInputs, numOutputs, feeRatePerByte = 100) { // feeRatePerByte in satoshis
    const baseTxSize = 10; // Approx: version (4) + locktime (4) + input_count (1) + output_count (1)
    const inputSize = numInputs * 148; // Approx: 32(prevTxId) + 4(vout) + 1(scriptLen) + 107(scriptSig) + 4(sequence)
    const outputSize = numOutputs * 34; // Approx: 8(value) + 1(scriptLen) + 25(scriptPubKey for P2PKH)
    
    const estimatedSize = baseTxSize + inputSize + outputSize;
    return estimatedSize * feeRatePerByte; // Total fee in satoshis
}


async function refreshBalanceAndUpdateUI() {
    if (wallet.address) {
        const balanceInfo = await fetchBalance(wallet.address); // Assuming fetchBalance is imported or available
        wallet.balance = balanceInfo.balance / 1e8;
        wallet.balanceAvailable = true;
        updateWalletUI();
    }
}

async function calculateFee() {
    if (!wallet.address) {
        showAlert('请先创建或导入钱包', 'error');
        return;
    }

    const amount = parseFloat(document.getElementById('amount').value);
    if (isNaN(amount) || amount <= 0) {
        showAlert('请输入有效的金额', 'error');
        return;
    }
    const amountSatoshis = Math.round(amount * 1e8);

    try {
        const utxos = await getUTXOs(wallet.address);
        if (!utxos || utxos.length === 0) {
            showAlert('没有可用的UTXO来计算费用', 'error');
            return;
        }

        // For fee calculation, assume 2 outputs (recipient, change)
        // A more precise calculation would involve selecting UTXOs first.
        const selectionResult = selectUTXOs(utxos, amountSatoshis, 100); // 100 sat/byte fee rate
        if (!selectionResult) {
            showAlert('余额不足以支付该金额，无法估算费用', 'error');
            return;
        }

        const { estimatedFee } = selectionResult;
        document.getElementById('estimatedFee').textContent = (estimatedFee / 1e8).toFixed(8) + " DOGE";
        showAlert('预估手续费计算成功', 'success');
    } catch (error) {
        showAlert('费用计算失败: ' + error.message, 'error');
    }
}

async function previewTransaction() {
    if (!wallet.address) {
        showAlert('请先创建或导入钱包', 'error');
        return;
    }

    const amount = parseFloat(document.getElementById('amount').value);
    const recipientAddress = document.getElementById('toAddress').value.trim();
    const feeText = document.getElementById('estimatedFee').textContent || '0';
    const fee = parseFloat(feeText.replace(" DOGE", ""));

    if (isNaN(amount) || amount <= 0 || !recipientAddress) {
        showAlert('请输入金额和接收地址', 'error');
        return;
    }
    if (isNaN(fee) || fee < 0) {
        showAlert('预估手续费无效', 'error');
        return;
    }

    try {
        updateTransactionPreview({
            from: wallet.address,
            to: recipientAddress,
            amount: amount,
            fee: fee
        });
        showAlert('交易预览已更新', 'success');
    } catch (error) {
        showAlert('生成交易预览失败: ' + error.message, 'error');
    }
}

const pendingTransactions = []; // Stores { txid, amount, recipient, fee, timestamp }
const broadcastedTransactions = []; // Stores { txid, amount, recipient, fee, broadcastTime }

function addPendingTransaction(transactionDetails) {
    pendingTransactions.unshift({ ...transactionDetails, timestamp: Date.now() });
    if (pendingTransactions.length > 10) pendingTransactions.pop(); // Keep last 10
    viewPendingTransactions();
}

async function addBroadcastedTransaction(transactionDetails, currentAddress) {
    const existingPendingIndex = pendingTransactions.findIndex(tx => tx.txid === transactionDetails.txid);
    if (existingPendingIndex !== -1) {
        pendingTransactions.splice(existingPendingIndex, 1);
    }
    const txWithTime = { 
        ...transactionDetails, 
        broadcastTime: Date.now(), 
        address: currentAddress, // Use passed address
        status: 'pending' // Initial status
    };
    broadcastedTransactions.unshift(txWithTime);
    if (broadcastedTransactions.length > 20) broadcastedTransactions.pop(); // Keep last 20

    try {
        await saveBroadcastedTxToDB(txWithTime, currentAddress);
    } catch (error) {
        console.error("Failed to save broadcasted transaction to DB:", error);
    }

    viewPendingTransactions(); // Refresh pending list
    viewBroadcastedTransactions();
}

function viewPendingTransactions() { // Made synchronous as it reads from memory
    const pendingList = document.getElementById('pendingTransactions');
    if (!pendingList) return;

    const currentWalletAddress = wallet.address;
    if (!currentWalletAddress) {
        pendingList.innerHTML = '<li>请先选择钱包。</li>';
        return;
    }
    // Filter pending transactions from the in-memory array for the current wallet
    // This array should be kept in sync with IndexedDB by other functions.
    const dbPendingTxs = broadcastedTransactions.filter(tx => tx.address === currentWalletAddress && tx.status === 'pending')
                                             .sort((a,b) => b.broadcastTime - a.broadcastTime);

    if (dbPendingTxs.length === 0) {
        pendingList.innerHTML = '<li>没有待处理的交易。</li>';
        return;
    }
    pendingList.innerHTML = dbPendingTxs.map(tx =>
        `<li>TXID: <a href="https://sochain.com/tx/DOGETEST/${tx.txid}" target="_blank">${tx.txid.substring(0,10)}...</a> - 发送 ${tx.amount} DOGE 到 ${tx.recipient.substring(0,10)}... - 状态: ${tx.status}</li>`
    ).join('');
}

function viewBroadcastedTransactions() { // Made synchronous
    const broadcastedTableBody = document.getElementById('broadcastedTransactions');
    const noBroadcastedTransactionsDiv = document.getElementById('noBroadcastedTransactions');

    if (!broadcastedTableBody || !noBroadcastedTransactionsDiv) return;

    const currentWalletAddress = wallet.address;
    if (!currentWalletAddress) {
        broadcastedTableBody.innerHTML = ''; // Clear table body
        noBroadcastedTransactionsDiv.innerHTML = '请先选择钱包。';
        noBroadcastedTransactionsDiv.style.display = 'block';
        document.getElementById('broadcastedTransactionsTable').style.display = 'none';
        return;
    }
    // Filter confirmed/failed transactions from the in-memory array for the current wallet
    // This array should be kept in sync with IndexedDB.
    const dbConfirmedTxs = broadcastedTransactions.filter(tx => tx.address === currentWalletAddress && (tx.status === 'confirmed' || tx.status === 'failed'))
                                               .sort((a,b) => b.broadcastTime - a.broadcastTime);
    
    broadcastedTableBody.innerHTML = ''; // Clear previous rows
    
    if (dbConfirmedTxs.length === 0) {
        noBroadcastedTransactionsDiv.style.display = 'block';
        document.getElementById('broadcastedTransactionsTable').style.display = 'none';
        return;
    }

    noBroadcastedTransactionsDiv.style.display = 'none';
    document.getElementById('broadcastedTransactionsTable').style.display = 'table';

    dbConfirmedTxs.forEach(tx => {
        const row = broadcastedTableBody.insertRow();
        row.insertCell().innerHTML = `<a href="https://sochain.com/tx/DOGETEST/${tx.txid}" target="_blank" title="${tx.txid}">${tx.txid.substring(0,10)}...</a>`;
        row.insertCell().textContent = tx.amount.toFixed(8);
        row.insertCell().innerHTML = `<span title="${tx.recipient}">${tx.recipient.substring(0,10)}...</span>`;
        row.insertCell().innerHTML = `<span class="transaction-status status-${tx.status}">${tx.status}</span>`;
        row.insertCell().textContent = tx.block_height || 'N/A';
        row.insertCell().textContent = tx.block_time ? new Date(tx.block_time * 1000).toLocaleString() : 'N/A';
    });
}

async function createActualTransaction(selectedUtxos, recipientAddress, amountToSendSatoshis, changeAddress, privateKeyHex, feeSatoshis) {
    const version = '01000000'; // 4 bytes, little-endian
    const locktime = '00000000'; // 4 bytes, little-endian
    const sequence = 'ffffffff'; // 4 bytes, little-endian
    const sighashAllHex = '01000000'; // SIGHASH_ALL as 4-byte LE hex
    const sighashByte = '01'; // SIGHASH_ALL as 1 byte

    let totalInputAmountSatoshis = 0;
    selectedUtxos.forEach(utxo => totalInputAmountSatoshis += utxo.value);

    const changeAmountSatoshis = totalInputAmountSatoshis - amountToSendSatoshis - feeSatoshis;

    if (changeAmountSatoshis < 0) {
        throw new Error('计算后资金不足 (inputs - amount - fee < 0)');
    }

    const inputs = [];
    const scriptPubKeyForInputs = createP2PKHScript(wallet.address); // Assuming all UTXOs are from current wallet

    selectedUtxos.forEach(utxo => {
        inputs.push({
            txid: utxo.txid,
            vout: utxo.vout,
            scriptSig: '', // Will be filled after signing
            sequence: sequence,
            scriptPubKeyToSpend: scriptPubKeyForInputs 
        });
    });
    const inputCountHex = inputs.length.toString(16).padStart(2, '0');

    const outputs = [];
    const recipientScriptPubKey = createP2PKHScript(recipientAddress);
    outputs.push({
        value: BigInt(amountToSendSatoshis),
        scriptPubKey: recipientScriptPubKey
    });

    const DUST_THRESHOLD_SATOSHIS = 1000000; // 0.01 DOGE, adjust as needed
    if (changeAmountSatoshis >= DUST_THRESHOLD_SATOSHIS) {
        const changeScriptPubKey = createP2PKHScript(changeAddress);
        outputs.push({
            value: BigInt(changeAmountSatoshis),
            scriptPubKey: changeScriptPubKey
        });
    }
    // If change is dust, it's effectively added to the fee and not included as an output.
    // The feeSatoshis passed to this function should already account for this.

    const outputCountHex = outputs.length.toString(16).padStart(2, '0');

    const ec = new window.elliptic.ec('secp256k1');
    const keyPair = ec.keyFromPrivate(privateKeyHex, 'hex');
    const publicKeyHex = keyPair.getPublic(true, 'hex'); // Compressed public key

    for (let i = 0; i < inputs.length; i++) {
        let txToSignParts = [];
        txToSignParts.push(version);
        txToSignParts.push(inputCountHex);

        for (let j = 0; j < inputs.length; j++) {
            txToSignParts.push(reverseHex(inputs[j].txid));
            txToSignParts.push(toLittleEndianHex(inputs[j].vout, 4));
            if (i === j) {
                const scriptToSign = inputs[j].scriptPubKeyToSpend;
                txToSignParts.push((scriptToSign.length / 2).toString(16).padStart(2, '0'));
                txToSignParts.push(scriptToSign);
            } else {
                txToSignParts.push('00'); // scriptSig length 0 for other inputs
            }
            txToSignParts.push(inputs[j].sequence);
        }

        txToSignParts.push(outputCountHex);
        outputs.forEach(output => {
            txToSignParts.push(toLittleEndianHex(output.value, 8));
            txToSignParts.push((output.scriptPubKey.length / 2).toString(16).padStart(2, '0'));
            txToSignParts.push(output.scriptPubKey);
        });
        txToSignParts.push(locktime);
        txToSignParts.push(sighashAllHex);

        const txToSignHex = txToSignParts.join('');
        const messageHash = sha256Double(CryptoJS.enc.Hex.parse(txToSignHex)).toString(CryptoJS.enc.Hex);
        
        const signatureObj = keyPair.sign(messageHash, { canonical: true });
        // The custom toDER() in crypto-libs.js already returns a hex string.
        const derSignatureHex = signatureObj.toDER(); 
        const finalSignatureWithSighash = derSignatureHex + sighashByte;

        inputs[i].scriptSig = createSignInputScript(finalSignatureWithSighash, publicKeyHex);
    }

    let finalTxHexParts = [];
    finalTxHexParts.push(version);
    finalTxHexParts.push(inputCountHex);
    inputs.forEach(input => {
        finalTxHexParts.push(reverseHex(input.txid));
        finalTxHexParts.push(toLittleEndianHex(input.vout, 4));
        finalTxHexParts.push((input.scriptSig.length / 2).toString(16).padStart(2, '0'));
        finalTxHexParts.push(input.scriptSig);
        finalTxHexParts.push(input.sequence);
    });
    finalTxHexParts.push(outputCountHex);
    outputs.forEach(output => {
        finalTxHexParts.push(toLittleEndianHex(output.value, 8));
        finalTxHexParts.push((output.scriptPubKey.length / 2).toString(16).padStart(2, '0'));
        finalTxHexParts.push(output.scriptPubKey);
    });
    finalTxHexParts.push(locktime);
    return finalTxHexParts.join('');
}

async function sendTransaction() {
    if (!wallet.address || !wallet.privateKey) {
        showAlert('请先创建或导入钱包', 'error');
        return;
    }

    const amount = parseFloat(document.getElementById('amount').value);
    const recipientAddress = document.getElementById('toAddress').value.trim();

    if (isNaN(amount) || amount <= 0 || !recipientAddress) {
        showAlert('请输入金额和接收地址', 'error');
        return;
    }
    const amountSatoshis = Math.round(amount * 1e8);

    try {
        const utxos = await getUTXOs(wallet.address);
        if (!utxos || utxos.length === 0) {
            showAlert('没有可用的UTXO', 'error');
            return;
        }

        const feePerByte = 100; // satoshis per byte
        let selectionResult = selectUTXOs(utxos, amountSatoshis, feePerByte);

        if (!selectionResult) {
            showAlert('余额不足以支付金额和预估手续费', 'error');
            return;
        }
        
        let { selectedUtxos: actualSelectedUtxos, totalInputAmount, estimatedFee: actualFeeSatoshis } = selectionResult;

        let changeAmountSatoshis = totalInputAmount - amountSatoshis - actualFeeSatoshis;
        
        if (changeAmountSatoshis < 0) {
            showAlert('计算后余额不足 (totalInput - amount - fee < 0)，请调整金额或等待更多UTXO', 'error');
            return;
        }

        const DUST_THRESHOLD = 1000000; // 0.01 DOGE. If change is less, add to fee.
        if (changeAmountSatoshis > 0 && changeAmountSatoshis < DUST_THRESHOLD) {
            actualFeeSatoshis += changeAmountSatoshis; // Add dust to fee
            changeAmountSatoshis = 0; // No change output
        }

        const rawTxHex = await createActualTransaction(
            actualSelectedUtxos,
            recipientAddress,
            amountSatoshis,
            wallet.address,
            wallet.privateKey,
            actualFeeSatoshis
        );

        const txHashBytes = sha256Double(CryptoJS.enc.Hex.parse(rawTxHex));
        const localTxid = reverseHex(txHashBytes.toString(CryptoJS.enc.Hex));

        addPendingTransaction({ txid: localTxid, amount: amount, recipient: recipientAddress, fee: actualFeeSatoshis / 1e8 });

        const broadcastedTxid = await broadcastTransaction(rawTxHex);
        // Use broadcastedTxid as the canonical one
        await addBroadcastedTransaction({ txid: broadcastedTxid, amount: amount, recipient: recipientAddress, fee: actualFeeSatoshis / 1e8 }, wallet.address);

        showAlert('交易发送成功，TXID: ' + broadcastedTxid, 'success');
        refreshBalanceAndUpdateUI(); // Refresh balance after sending
    } catch (error) {
        console.error("交易发送失败详情:", error);
        showAlert('交易发送失败: ' + error.message, 'error');
    }
}

function sendOpReturnOnly() {
    showAlert('OP_RETURN 交易功能尚未实现', 'info');
}

function openInBrowser() {
    if (wallet.address) {
        const url = `https://sochain.com/address/DOGETEST/${wallet.address}`;
        window.open(url, '_blank');
    } else {
        showAlert('请先选择或生成钱包', 'error');
    }
}

function updateTransactionPreview(previewData) {
    document.getElementById('previewTo').textContent = previewData.to || '-';
    document.getElementById('previewAmount').textContent = previewData.amount.toFixed(8) + " DOGE";
    document.getElementById('previewFee').textContent = previewData.fee.toFixed(8) + " DOGE";
    document.getElementById('previewTotal').textContent = (previewData.amount + previewData.fee).toFixed(8) + " DOGE";
}



function testConnection() {
    showAlert('连接测试功能尚未实现', 'info');
}
// Historical Transactions
async function fetchTransactionHistory(address) {
    if (!address) return [];
    try {
        // This needs access to getElectrsUrl() and potentially getCorsProxyUrl() from network.js
        // For simplicity, assuming direct access or these are made available globally/imported.
        // This is a simplified URL construction.
        const electrsBase = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && window.useElectrsProxy ? '/electrs' : 'https://doge-electrs-testnet-demo.qed.me';
        const apiUrl = `${electrsBase}/address/${address}/txs`;
        
        const response = await fetch(apiUrl); // May need CORS proxy if not using local proxy
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API请求失败: ${response.status} - ${errorText}`);
        }
        const txs = await response.json();
        return txs.map(tx => ({
            txid: tx.txid,
            fee: tx.fee,
            confirmed: tx.status.confirmed,
            block_height: tx.status.block_height,
            block_time: tx.status.block_time ? new Date(tx.status.block_time * 1000).toLocaleString() : 'N/A'
        }));
    } catch (error) {
        console.error('获取交易历史失败:', error);
        showAlert('获取交易历史失败: ' + error.message, 'error');
        return [];
    }
}

function viewTransactionHistory(transactions) {
    const historyList = document.getElementById('transactionHistoryList'); // Ensure this element exists in HTML
    if (!historyList) return;

    if (transactions.length === 0) {
        historyList.innerHTML = '<li>没有历史交易记录。</li>';
        return;
    }
    historyList.innerHTML = transactions.map(tx => `
        <li><strong>TXID:</strong> <a href="https://sochain.com/tx/DOGETEST/${tx.txid}" target="_blank">${tx.txid}</a><br>
            <strong>状态:</strong> ${tx.confirmed ? `已确认 (区块 ${tx.block_height || 'N/A'})` : '未确认'}<br>
            <strong>时间:</strong> ${tx.block_time} ${tx.fee ? `<br><strong>手续费:</strong> ${(tx.fee / 1e8).toFixed(8)} DOGE` : ''}</li>`).join('');
}

async function refreshWalletTransactionHistory() {
    if (wallet.address) {
        const history = await fetchTransactionHistory(wallet.address);
        viewTransactionHistory(history);
    } else {
        viewTransactionHistory([]); // Clear history if no wallet
    }
}

// Function to load broadcasted transactions from DB for the current wallet
async function loadPersistedBroadcastedTransactions() {
    if (wallet.address) { // Ensure wallet.address is available
        const persistedTxs = await getBroadcastedTxsFromDB(wallet.address);
        broadcastedTransactions.length = 0; // Clear in-memory array first
        persistedTxs.forEach(tx => broadcastedTransactions.push(tx));
        // After loading, update both views
        viewPendingTransactions();
        viewBroadcastedTransactions();
    } else {
        // If no wallet address, clear the in-memory array and update views to show empty state
        broadcastedTransactions.length = 0;
        viewPendingTransactions();
        viewBroadcastedTransactions();
    }
}

async function checkPendingTransactionsStatus() {
    if (!wallet.address) return;

    console.log('Checking status for pending transactions and fetching mempool txs...');

    // 1. Fetch mempool transactions from API
    const mempoolApiTxs = await fetchMempoolTransactions(wallet.address);

    // 2. Process and merge API mempool transactions into our local cache if they aren't already there
    for (const apiTx of mempoolApiTxs) {
        const existingTxIndex = broadcastedTransactions.findIndex(
            btx => btx.txid === apiTx.txid && btx.address === wallet.address
        );
        if (existingTxIndex === -1) { // If not found in our local cache
            // This is a new mempool transaction not initiated by this wallet instance
            // We need to determine if it's an incoming or outgoing tx to display amount/recipient meaningfully
            // For simplicity, we'll add it with a generic structure.
            // A more advanced wallet would parse vin/vout to determine this.
            const newMempoolTx = {
                txid: apiTx.txid,
                amount: 0, // Or try to parse from vout if relevant to wallet.address
                recipient: 'N/A', // Or try to parse
                fee: apiTx.fee / 1e8,
                broadcastTime: apiTx.status.block_time || Date.now(), // block_time for mempool tx is usually null
                address: wallet.address,
                status: 'pending', // All mempool txs are pending
                apiSource: true // Flag to indicate it came from API
            };
            broadcastedTransactions.unshift(newMempoolTx); // Add to our in-memory list
            // Optionally, save to IndexedDB if you want to persist these API-sourced pending txs
            // await saveBroadcastedTxToDB(newMempoolTx, wallet.address); 
        }
    }

    // 3. Check status for all transactions currently marked as 'pending' in our local cache
    const pendingToCheck = broadcastedTransactions.filter(tx => tx.address === wallet.address && tx.status === 'pending');
    if (pendingToCheck.length === 0) {
        // console.log('No pending transactions to check for address:', wallet.address); // Can be noisy
        return;
    }

    for (const tx of pendingToCheck) {
        try {
            const electrsBase = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && window.useElectrsProxy ? '/electrs' : 'https://doge-electrs-testnet-demo.qed.me';
            const apiUrl = `${electrsBase}/tx/${tx.txid}`;
            const response = await fetch(apiUrl);
            const txData = response.ok ? await response.json() : null;

            if (txData && txData.status && txData.status.confirmed) {
                const newStatusDetails = {
                    status: 'confirmed',
                    block_height: txData.status.block_height,
                    block_time: txData.status.block_time
                };
                // The key for IndexedDB is an array [address, txid]
                const dbKey = [wallet.address, tx.txid];
                await updateTxStatusInDB(dbKey, newStatusDetails);
                
                // Update the corresponding transaction in the in-memory broadcastedTransactions array
                const indexInBroadcasted = broadcastedTransactions.findIndex(btx => btx.txid === tx.txid && btx.address === wallet.address);
                if (indexInBroadcasted !== -1) {
                    Object.assign(broadcastedTransactions[indexInBroadcasted], newStatusDetails);
                }
                console.log(`Transaction ${tx.txid} confirmed.`);
            } else if (txData && txData.status && !txData.status.confirmed && !tx.apiSource) {
                // It's still pending according to the API, and it's one of our locally initiated ones. No change needed.
            } else if (!txData && !tx.apiSource) {
                 console.warn(`Failed to fetch status for locally initiated TX ${tx.txid} or it's not found. It remains pending locally.`);
            }
            // Add handling for reorgs or if a tx might become "failed" if not found after a long time (more complex)
        } catch (error) {
            console.error(`Error checking status for TXID ${tx.txid}:`, error);
        }
    }
    // After checking all statuses and potentially updating the in-memory array, refresh the UI lists.
    viewPendingTransactions();
    viewBroadcastedTransactions();
}
export {
    selectUTXOs,
    createP2PKHScript,
    createOpReturnScript,
    serializeTransaction,
    calculateFee,
    previewTransaction,
    sendTransaction,
    sendOpReturnOnly,
    openInBrowser,
    testConnection,
    viewPendingTransactions,
    viewBroadcastedTransactions,
    refreshWalletTransactionHistory,
    loadPersistedBroadcastedTransactions,
    checkPendingTransactionsStatus // Export new function
};
