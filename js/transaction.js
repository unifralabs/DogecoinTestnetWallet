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

function selectUTXOs(utxos, amountToSendSatoshis, feePerByte = 100, opReturnDataLength = 0) {
    let selectedUtxos = [];
    let currentTotalValue = 0;
    let estimatedFee = 0;

    // Sort UTXOs: smallest first to try and match amount, or largest first to minimize inputs
    // For simplicity, using smallest first. Could be optimized.
    const sortedUtxos = [...utxos].sort((a, b) => a.value - b.value); 

    for (const utxo of sortedUtxos) {
        selectedUtxos.push(utxo);
        currentTotalValue += utxo.value;

        // Estimate fee with current selected inputs and outputs (recipient, change, optional OP_RETURN)
        // This is iterative and approximate.
        let numOutputs = 2; // Base: recipient and change
        if (opReturnDataLength > 0) {
            numOutputs += 1; // Add OP_RETURN output
        }
        estimatedFee = calculateActualEstimatedFee(selectedUtxos.length, numOutputs, feePerByte, opReturnDataLength);

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

function createScriptPubKey(address) {
    console.log('Creating script for address:', address);
    const decoded = bs58.decode(address);
    const hex = decoded.map(b => b.toString(16).padStart(2, '0')).join('');
    console.log('Decoded hex:', hex);
    
    // Check the version byte to determine address type
    const versionByte = hex.substring(0, 2);
    console.log('Version byte:', versionByte);
    
    if (versionByte === '6f' || versionByte === '71') {
        // Dogecoin testnet P2PKH (starts with 'n' or 'm')
        const pubKeyHash = hex.substring(2, 42);
        console.log('P2PKH pubKeyHash:', pubKeyHash);
        return '76a914' + pubKeyHash + '88ac';
    } else if (versionByte === 'c4') {
        // Dogecoin testnet P2SH (starts with '2')
        const scriptHash = hex.substring(2, 42);
        console.log('P2SH scriptHash:', scriptHash);
        return 'a914' + scriptHash + '87';
    } else {
        console.error('Unsupported address type, version byte:', versionByte);
        throw new Error('Unsupported address type');
    }
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

function calculateActualEstimatedFee(numInputs, numOutputs, feeRatePerByte = 100, opReturnDataLength = 0) { // feeRatePerByte in satoshis
    const baseTxSize = 10; // Approx: version (4) + locktime (4) + input_count (1) + output_count (1)
    const inputSize = numInputs * 148; // Approx: 32(prevTxId) + 4(vout) + 1(scriptLen) + 107(scriptSig) + 4(sequence)
    let outputSize = numOutputs * 34; // Approx: 8(value) + 1(scriptLen) + 25(scriptPubKey for P2PKH)
    
    // Add extra size for OP_RETURN output if present
    if (opReturnDataLength > 0) {
        // OP_RETURN output: 8(value) + 1(scriptLen) + 2(OP_RETURN + length) + dataLength
        const opReturnOutputSize = 8 + 1 + 2 + opReturnDataLength;
        outputSize += opReturnOutputSize - 34; // Replace one standard output size with OP_RETURN size
    }
    
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
        showAlert('Please create or import wallet first', 'error');
        return;
    }

    const amount = parseFloat(document.getElementById('amount').value);
    if (isNaN(amount) || amount <= 0) {
        showAlert('Please enter valid amount', 'error');
        return;
    }
    const amountSatoshis = Math.round(amount * 1e8);

    try {
        const utxos = await getUTXOs(wallet.address);
        if (!utxos || utxos.length === 0) {
            showAlert('No available UTXOs to calculate fee', 'error');
            return;
        }

        // Check for OP_RETURN data
        const opReturnData = document.getElementById('opReturnData') ? document.getElementById('opReturnData').value.trim() : '';
        let opReturnDataLength = 0;
        if (opReturnData) {
            const opReturnFormat = document.getElementById('opReturnFormat') ? document.getElementById('opReturnFormat').value : 'string';
            if (opReturnFormat === 'hex') {
                opReturnDataLength = opReturnData.replace(/\s+/g, '').length / 2;
            } else {
                opReturnDataLength = new TextEncoder().encode(opReturnData).length;
            }
        }

        // For fee calculation, consider all outputs (recipient, change, optional OP_RETURN)
        const selectionResult = selectUTXOs(utxos, amountSatoshis, 100, opReturnDataLength); // 100 sat/byte fee rate
        if (!selectionResult) {
            showAlert('Insufficient balance to pay this amount, cannot estimate fee', 'error');
            return;
        }

        const { estimatedFee } = selectionResult;
        document.getElementById('estimatedFee').textContent = (estimatedFee / 1e8).toFixed(8) + " DOGE";
        showAlert('Fee estimation successful', 'success');
    } catch (error) {
        showAlert('Fee calculation failed: ' + error.message, 'error');
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
        pendingList.innerHTML = '<li>Please select wallet first.</li>';
        return;
    }
    // Filter pending transactions from the in-memory array for the current wallet
    // This array should be kept in sync with IndexedDB by other functions.
    const dbPendingTxs = broadcastedTransactions.filter(tx => tx.address === currentWalletAddress && tx.status === 'pending')
                                             .sort((a,b) => b.broadcastTime - a.broadcastTime);

    if (dbPendingTxs.length === 0) {
        pendingList.innerHTML = '<li>No pending transactions.</li>';
        return;
    }
    pendingList.innerHTML = dbPendingTxs.map(tx =>
        `<li>TXID: <a href="https://sochain.com/tx/DOGETEST/${tx.txid}" target="_blank">${tx.txid.substring(0,10)}...</a> - Send ${tx.amount} DOGE to ${tx.recipient.substring(0,10)}... - Status: ${tx.status}</li>`
    ).join('');
}

function viewBroadcastedTransactions() { // Made synchronous
    const broadcastedTableBody = document.getElementById('broadcastedTransactions');
    const noBroadcastedTransactionsDiv = document.getElementById('noBroadcastedTransactions');

    if (!broadcastedTableBody || !noBroadcastedTransactionsDiv) return;

    const currentWalletAddress = wallet.address;
    if (!currentWalletAddress) {
        broadcastedTableBody.innerHTML = ''; // Clear table body
        noBroadcastedTransactionsDiv.innerHTML = 'Please select wallet first.';
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

async function createActualTransaction(selectedUtxos, recipientAddress, amountToSendSatoshis, changeAddress, privateKeyHex, feeSatoshis, opReturnData = null, opReturnFormat = 'string') {
    const version = '01000000'; // 4 bytes, little-endian
    const locktime = '00000000'; // 4 bytes, little-endian
    const sequence = 'ffffffff'; // 4 bytes, little-endian
    const sighashAllHex = '01000000'; // SIGHASH_ALL as 4-byte LE hex
    const sighashByte = '01'; // SIGHASH_ALL as 1 byte

    let totalInputAmountSatoshis = 0;
    selectedUtxos.forEach(utxo => totalInputAmountSatoshis += utxo.value);

    const changeAmountSatoshis = totalInputAmountSatoshis - amountToSendSatoshis - feeSatoshis;

    if (changeAmountSatoshis < 0) {
        throw new Error('Insufficient funds after calculation (inputs - amount - fee < 0)');
    }

    const inputs = [];
    const scriptPubKeyForInputs = createScriptPubKey(wallet.address); // Assuming all UTXOs are from current wallet

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
    const recipientScriptPubKey = createScriptPubKey(recipientAddress);
    outputs.push({
        value: BigInt(amountToSendSatoshis),
        scriptPubKey: recipientScriptPubKey
    });

    // Add OP_RETURN output if data is provided
    if (opReturnData) {
        const opReturnScript = createOpReturnScript(opReturnData, opReturnFormat);
        outputs.push({
            value: BigInt(0), // OP_RETURN outputs have zero value
            scriptPubKey: opReturnScript
        });
    }

    const DUST_THRESHOLD_SATOSHIS = 1000000; // 0.01 DOGE, adjust as needed
    if (changeAmountSatoshis >= DUST_THRESHOLD_SATOSHIS) {
        const changeScriptPubKey = createScriptPubKey(changeAddress);
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
        showAlert('Please create or import wallet first', 'error');
        return;
    }

    const amount = parseFloat(document.getElementById('amount').value);
    const recipientAddress = document.getElementById('toAddress').value.trim();
    const userFee = parseFloat(document.getElementById('fee').value) || 0; // Get user input fee

    if (isNaN(amount) || amount <= 0 || !recipientAddress) {
        showAlert('Please enter amount and recipient address', 'error');
        return;
    }
    const amountSatoshis = Math.round(amount * 1e8);

    try {
        const utxos = await getUTXOs(wallet.address);
        if (!utxos || utxos.length === 0) {
            showAlert('No available UTXOs', 'error');
            return;
        }

        // Get OP_RETURN data if provided
        const opReturnData = document.getElementById('opReturnData') ? document.getElementById('opReturnData').value.trim() : '';
        const opReturnFormat = document.getElementById('opReturnFormat') ? document.getElementById('opReturnFormat').value : 'string';
        let opReturnDataLength = 0;
        if (opReturnData) {
            if (opReturnFormat === 'hex') {
                opReturnDataLength = opReturnData.replace(/\s+/g, '').length / 2;
            } else {
                opReturnDataLength = new TextEncoder().encode(opReturnData).length;
            }
            
            // Validate OP_RETURN data size (max 80 bytes for standard relay)
            if (opReturnDataLength > 80) {
                showAlert('OP_RETURN data length cannot exceed 80 bytes', 'error');
                return;
            }
        }

        let actualFeeSatoshis;
        let actualSelectedUtxos;
        let totalInputAmount;

        if (userFee > 0) {
            // User entered non-zero fee, use user specified fee
            actualFeeSatoshis = Math.round(userFee * 1e8);
            
            // Use user specified fee to select UTXOs
            const feePerByte = 100; // This is only used for UTXO selection estimation
            let selectionResult = selectUTXOs(utxos, amountSatoshis, feePerByte, opReturnDataLength);
            
            if (!selectionResult) {
                showAlert('Insufficient balance to pay amount and estimated fee', 'error');
                return;
            }
            
            actualSelectedUtxos = selectionResult.selectedUtxos;
            totalInputAmount = selectionResult.totalInputAmount;
            
            // Check if user specified fee is sufficient
            if (totalInputAmount < amountSatoshis + actualFeeSatoshis) {
                showAlert('Insufficient balance to pay specified amount and fee', 'error');
                return;
            }
        } else {
            // User entered fee is 0, use automatically calculated fee
            const feePerByte = 100; // satoshis per byte
            let selectionResult = selectUTXOs(utxos, amountSatoshis, feePerByte, opReturnDataLength);

            if (!selectionResult) {
                showAlert('Insufficient balance to pay amount and estimated fee', 'error');
                return;
            }
            
            actualSelectedUtxos = selectionResult.selectedUtxos;
            totalInputAmount = selectionResult.totalInputAmount;
            actualFeeSatoshis = selectionResult.estimatedFee;
        }

        let changeAmountSatoshis = totalInputAmount - amountSatoshis - actualFeeSatoshis;
        
        if (changeAmountSatoshis < 0) {
            showAlert('Insufficient balance after calculation (totalInput - amount - fee < 0), please adjust amount or wait for more UTXOs', 'error');
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
            actualFeeSatoshis,
            opReturnData || null,
            opReturnFormat
        );

        const txHashBytes = sha256Double(CryptoJS.enc.Hex.parse(rawTxHex));
        const localTxid = reverseHex(txHashBytes.toString(CryptoJS.enc.Hex));

        addPendingTransaction({ 
            txid: localTxid, 
            amount: amount, 
            recipient: recipientAddress, 
            fee: actualFeeSatoshis / 1e8,
            opReturnData: opReturnData || null
        });

        const broadcastedTxid = await broadcastTransaction(rawTxHex);
        // Use broadcastedTxid as the canonical one
        await addBroadcastedTransaction({ 
            txid: broadcastedTxid, 
            amount: amount, 
            recipient: recipientAddress, 
            fee: actualFeeSatoshis / 1e8,
            opReturnData: opReturnData || null
        }, wallet.address);

        let successMessage = 'Transaction sent successfully, TXID: ' + broadcastedTxid;
        if (opReturnData) {
            successMessage += ', includes OP_RETURN data: ' + opReturnData.substring(0, 20) + (opReturnData.length > 20 ? '...' : '');
        }
        showAlert(successMessage, 'success');
        refreshBalanceAndUpdateUI(); // Refresh balance after sending
    } catch (error) {
        console.error("Transaction send failed details:", error);
        showAlert('Transaction send failed: ' + error.message, 'error');
    }
}

function openInBrowser() {
    if (wallet.address) {
        const url = `https://sochain.com/address/DOGETEST/${wallet.address}`;
        window.open(url, '_blank');
    } else {
        showAlert('Please select or generate wallet first', 'error');
    }
}





function testConnection() {
    showAlert('Connection test feature not yet implemented', 'info');
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
            throw new Error(`API request failed: ${response.status} - ${errorText}`);
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
        console.error('Failed to fetch transaction history:', error);
        showAlert('Failed to fetch transaction history: ' + error.message, 'error');
        return [];
    }
}

function viewTransactionHistory(transactions) {
    const historyList = document.getElementById('transactionHistoryList'); // Ensure this element exists in HTML
    if (!historyList) return;

    if (transactions.length === 0) {
        historyList.innerHTML = '<li>No historical transactions.</li>';
        return;
    }
    historyList.innerHTML = transactions.map(tx => `
        <li><strong>TXID:</strong> <a href="https://sochain.com/tx/DOGETEST/${tx.txid}" target="_blank">${tx.txid}</a><br>
            <strong>Status:</strong> ${tx.confirmed ? `Confirmed (Block ${tx.block_height || 'N/A'})` : 'Unconfirmed'}<br>
            <strong>Time:</strong> ${tx.block_time} ${tx.fee ? `<br><strong>Fee:</strong> ${(tx.fee / 1e8).toFixed(8)} DOGE` : ''}</li>`).join('');
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
    createScriptPubKey,
    createOpReturnScript,
    serializeTransaction,
    calculateFee,
    sendTransaction,
    openInBrowser,
    testConnection,
    viewPendingTransactions,
    viewBroadcastedTransactions,
    refreshWalletTransactionHistory,
    loadPersistedBroadcastedTransactions,
    checkPendingTransactionsStatus // Export new function
};
