import { wallet } from './wallet.js';
import { getUTXOs, getVerifiedUTXOs, broadcastTransaction, fetchMempoolTransactions, fetchBalance } from './network.js';
import { sha256Double } from './crypto-utils.js';
import { saveBroadcastedTxToDB, getBroadcastedTxsFromDB, getPendingTxsFromDB, updateTxStatusInDB } from './storage.js';
import { showAlert, startSendLoading, stopSendLoading, updateWalletUI } from './ui.js'; // Added updateWalletUI for balance refresh

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

// Helper function to encode a number in CompactSize format (VarInt)
function toCompactSizeBytes(value) {
    if (value < 0xfd) {
        return value.toString(16).padStart(2, '0');
    } else if (value <= 0xffff) {
        return 'fd' + toLittleEndianHex(value, 2);
    } else if (value <= 0xffffffff) {
        return 'fe' + toLittleEndianHex(value, 4);
    } else {
        return 'ff' + toLittleEndianHex(value, 8);
    }
}
const DEFAULT_FEE_RATE_SAT_PER_BYTE = 1000; // 0.01 DOGE per kB = 1,000,000 satoshis per kB / 1000 bytes = 1000 satoshis per byte (Dogecoin standard relay fee)

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

    const dataLength = dataHex.length / 2;
    const dataLenHex = dataLength.toString(16).padStart(2, '0');
    if (dataLength <= 75) {
        // OP_RETURN <len> <data>
        return '6a' + dataLenHex + dataHex;
    }
    // For 76..80 bytes, use OP_PUSHDATA1
    return '6a4c' + dataLenHex + dataHex;
}

function createSignInputScript(signatureHexWithSighash, publicKeyHex) {
    const sigLenHex = (signatureHexWithSighash.length / 2).toString(16).padStart(2, '0');
    const pubKeyLenHex = (publicKeyHex.length / 2).toString(16).padStart(2, '0');
    return sigLenHex + signatureHexWithSighash + pubKeyLenHex + publicKeyHex;
}

function serializeTransaction(tx) {
    let serialized = '';
    serialized += tx.version.toString(16).padStart(8, '0');
    serialized += toCompactSizeBytes(tx.inputCount);

    tx.inputs.forEach(input => {
        serialized += reverseHex(input.txid);
        serialized += toLittleEndianHex(input.vout, 4); // vout is 4 bytes LE
        serialized += toCompactSizeBytes(input.script.length / 2);
        serialized += input.script;
        serialized += input.sequence.toString(16).padStart(8, '0');
    });

    serialized += toCompactSizeBytes(tx.outputCount);
    tx.outputs.forEach(output => {
        serialized += toLittleEndianHex(output.value, 8); // value is 8 bytes LE
        serialized += toCompactSizeBytes(output.script.length / 2);
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
    // Standard P2PKH output is ~34 bytes.
    // If there is an OP_RETURN, one of the outputs will have a different size.
    const standardOutputCount = opReturnDataLength > 0 ? numOutputs - 1 : numOutputs;
    let outputSize = standardOutputCount * 34;

    // Add extra size for OP_RETURN output if present
    if (opReturnDataLength > 0) {
        // OP_RETURN output: 8(value=0) + 1(scriptLen) + 1(OP_RETURN) + 1(len) + dataLength
        outputSize += (8 + 1 + 1 + 1 + opReturnDataLength);
    }

    const estimatedSize = baseTxSize + inputSize + outputSize;
    return estimatedSize * feeRatePerByte; // Total fee in satoshis
}


async function refreshBalanceAndUpdateUI() {
    if (wallet.address) {
        const balanceInfo = await fetchBalance(wallet.address); // Assuming fetchBalance is imported or available
        wallet.balance = parseInt(balanceInfo.balance) / 1e8;
        wallet.balanceAvailable = true;
        updateWalletUI();
    }
}

/**
 * Adds recently spent UTXOs to a temporary local cache to prevent double-spending.
 * @param {Array<object>} utxos - The array of UTXO objects that have been spent.
 */
function addSpentUTXOsToCache(utxos) {
    if (!utxos || utxos.length === 0) return;

    try {
        const stored = localStorage.getItem('spent_utxos_cache');
        const cache = stored ? JSON.parse(stored) : [];
        const now = Date.now();

        const newEntries = utxos.map(utxo => ({
            id: `${utxo.txid}:${utxo.vout}`,
            timestamp: now
        }));

        // Filter out old entries and merge with new ones, avoiding duplicates
        const fifteenMinutesAgo = now - 15 * 60 * 1000;
        const existingIds = new Set(newEntries.map(e => e.id));
        const updatedCache = cache.filter(item => item.timestamp > fifteenMinutesAgo && !existingIds.has(item.id));

        localStorage.setItem('spent_utxos_cache', JSON.stringify([...updatedCache, ...newEntries]));
    } catch (error) {
        console.error("Failed to update spent UTXOs cache:", error);
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
        .sort((a, b) => b.broadcastTime - a.broadcastTime);

    if (dbPendingTxs.length === 0) {
        pendingList.innerHTML = '<li>No pending transactions.</li>';
        return;
    }
    pendingList.innerHTML = dbPendingTxs.map(tx =>
        `<li>TXID: <a href="https://blockbook.qiaoxiaorui.org/tx/${tx.txid}" target="_blank">${tx.txid.substring(0, 10)}...</a> - Send ${tx.amount} DOGE to ${tx.recipient.substring(0, 10)}... - Status: ${tx.status}</li>`
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
        .sort((a, b) => b.broadcastTime - a.broadcastTime);

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
        row.insertCell().innerHTML = `<a href="https://sochain.com/tx/DOGETEST/${tx.txid}" target="_blank" title="${tx.txid}">${tx.txid.substring(0, 10)}...</a>`;
        row.insertCell().textContent = tx.amount.toFixed(8);
        row.insertCell().innerHTML = `<span title="${tx.recipient}">${tx.recipient.substring(0, 10)}...</span>`;
        row.insertCell().innerHTML = `<span class="transaction-status status-${tx.status}">${tx.status}</span>`;
        row.insertCell().textContent = tx.block_height || 'N/A';
        row.insertCell().textContent = tx.block_time ? new Date(tx.block_time * 1000).toLocaleString() : 'N/A';
    });
}

async function createActualTransaction(options) {
    const {
        selectedUtxos,
        recipientAddress,
        amountToSendSatoshis,
        changeAddress,
        privateKeyHex,
        feeSatoshis,
        opReturnData = null,
        opReturnFormat = 'string',
        l2scanFeeAddress = null,
        l2scanFeeSatoshis = 0,
    } = options;

    const version = '01000000'; // 4 bytes, little-endian
    const locktime = '00000000'; // 4 bytes, little-endian
    const sequence = 'ffffffff'; // 4 bytes, little-endian
    const sighashAllHex = '01000000'; // SIGHASH_ALL as 4-byte LE hex
    const sighashByte = '01'; // SIGHASH_ALL as 1 byte
    // Calculate the total amount to be sent from its components for robustness.
    const finalTotalAmountToSend = BigInt(amountToSendSatoshis || 0) + BigInt(l2scanFeeSatoshis || 0);
    let totalInputAmountSatoshis = 0n; // Use BigInt for summation
    selectedUtxos.forEach(utxo => {
        totalInputAmountSatoshis += BigInt(utxo.value); // Ensure value is treated as BigInt
    });

    // --- 详细调试日志 ---
    console.log("--- Detailed Transaction Breakdown ---");
    console.log("--- INPUTS ---");
    // selectedUtxos.forEach((utxo, index) => {
    //     console.log(`Input ${index}: value=${utxo.value} satoshis (from tx ${utxo.txid.substring(0, 10)}...:${utxo.vout})`);
    // });
    console.log(`inputCount=${selectedUtxos.length}`);
    console.log(`Total Input Value: ${totalInputAmountSatoshis} satoshis`);
    console.log("--- FEES ---");
    console.log(`Transaction Fee: ${feeSatoshis} satoshis (${(feeSatoshis / 1e8).toFixed(8)} DOGE)`);
    console.log(`Fee Rate: ${DEFAULT_FEE_RATE_SAT_PER_BYTE} satoshis per byte`);
    console.log("-----------------");
    // --- 结束日志 ---

    const changeAmountSatoshis = totalInputAmountSatoshis - finalTotalAmountToSend - BigInt(feeSatoshis);
    let finalFeeSatoshis = BigInt(feeSatoshis);
    let finalChangeAmountSatoshis = changeAmountSatoshis;

    console.log("--- CHANGE CALCULATION ---");
    console.log(`Total Input: ${totalInputAmountSatoshis} satoshis`);
    console.log(`Amount to Send (Recipient + L2Scan): ${finalTotalAmountToSend} satoshis`);
    console.log(`Initial Fee: ${feeSatoshis} satoshis`);
    console.log(`Calculated Change: ${changeAmountSatoshis} satoshis (${Number(changeAmountSatoshis) / 1e8} DOGE)`);
    console.log("--------------------------");

    if (finalChangeAmountSatoshis < 0n) {
        // --- 错误详情日志 ---
        console.error("--- INSUFFICIENT FUNDS ERROR ---");
        console.error(`Total Input: ${totalInputAmountSatoshis} satoshis`);
        console.error(`Total Sent (Recipient + L2Scan): ${finalTotalAmountToSend} satoshis`);
        console.error(`Fee: ${finalFeeSatoshis} satoshis`);
        const requiredSatoshis = finalTotalAmountToSend + finalFeeSatoshis;
        console.error(`Required: ${requiredSatoshis} satoshis`);
        const deficit = totalInputAmountSatoshis - requiredSatoshis;
        console.error(`Deficit: ${deficit} satoshis`);
        console.error("---------------------------------");
        // --- 结束日志 ---
        throw new Error(`Insufficient funds after calculation. Deficit: ${deficit} satoshis`);
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
    const inputCountHex = toCompactSizeBytes(inputs.length);

    const outputs = [];
    const recipientScriptPubKey = createScriptPubKey(recipientAddress);
    outputs.push({
        value: BigInt(amountToSendSatoshis),
        scriptPubKey: recipientScriptPubKey
    });
    console.log(`Created recipient output: ${amountToSendSatoshis} satoshis to ${recipientAddress}`);

    // Add L2Scan fee output if address is provided
    console.log(`L2Scan Fee Check: address='${l2scanFeeAddress}', amount=${l2scanFeeSatoshis}`);
    if (l2scanFeeAddress && l2scanFeeSatoshis > 0) {
        const l2scanFeeScriptPubKey = createScriptPubKey(l2scanFeeAddress);
        outputs.push({
            value: BigInt(l2scanFeeSatoshis),
            scriptPubKey: l2scanFeeScriptPubKey
        });
        console.log(`✓ Created L2Scan fee output: ${l2scanFeeSatoshis} satoshis to ${l2scanFeeAddress}`);
    } else {
        console.log(`⚠️ L2Scan fee output NOT created (address empty or amount is 0)`);
    }

    // Add OP_RETURN output if data is provided
    if (opReturnData) {
        const opReturnScript = createOpReturnScript(opReturnData, opReturnFormat);
        outputs.push({
            value: BigInt(0), // OP_RETURN outputs have zero value
            scriptPubKey: opReturnScript
        });
    }

    const DUST_THRESHOLD_SATOSHIS = 100000; // 0.001 DOGE (1 milliDOGE), more reasonable for Dogecoin
    console.log("--- DUST HANDLING ---");
    console.log(`Dust Threshold: ${DUST_THRESHOLD_SATOSHIS} satoshis (${DUST_THRESHOLD_SATOSHIS / 1e8} DOGE)`);
    console.log(`Change Amount: ${finalChangeAmountSatoshis} satoshis (${Number(finalChangeAmountSatoshis) / 1e8} DOGE)`);

    if (finalChangeAmountSatoshis > 0n && finalChangeAmountSatoshis < DUST_THRESHOLD_SATOSHIS) {
        // If change is positive but less than dust, add it to the fee.
        console.log(`⚠️ Change is dust, adding to fee: ${finalChangeAmountSatoshis} satoshis`);
        finalFeeSatoshis += finalChangeAmountSatoshis;
        finalChangeAmountSatoshis = 0n; // No change output will be created.
        console.log(`New total fee: ${finalFeeSatoshis} satoshis (${Number(finalFeeSatoshis) / 1e8} DOGE)`);
    } else if (finalChangeAmountSatoshis >= DUST_THRESHOLD_SATOSHIS) {
        // If change is sufficient, create a change output.
        console.log(`✓ Creating change output: ${finalChangeAmountSatoshis} satoshis (${Number(finalChangeAmountSatoshis) / 1e8} DOGE)`);
        const changeScriptPubKey = createScriptPubKey(changeAddress);
        outputs.push({
            value: finalChangeAmountSatoshis,
            scriptPubKey: changeScriptPubKey
        });
    } else if (finalChangeAmountSatoshis === 0n) {
        console.log(`No change needed (exact amount)`);
    }
    console.log("---------------------");

    // Log detailed output information
    console.log("--- OUTPUTS BREAKDOWN ---");
    outputs.forEach((output, index) => {
        const amountDOGE = Number(output.value) / 1e8;
        const scriptType = output.scriptPubKey.startsWith('76a914') ? 'P2PKH' :
            output.scriptPubKey.startsWith('a914') ? 'P2SH' :
                output.scriptPubKey.startsWith('6a') ? 'OP_RETURN' : 'Unknown';

        if (scriptType === 'OP_RETURN') {
            console.log(`Output ${index}: ${amountDOGE.toFixed(8)} DOGE (${output.value} satoshis) - ${scriptType} data`);
        } else { // Attempt to extract address info from scriptPubKey (simplified)
            // 尝试从 scriptPubKey 中提取地址信息（简化版）
            let addressInfo = 'Unknown address';
            if (scriptType === 'P2PKH') {
                const pubKeyHash = output.scriptPubKey.substring(6, 46); // 提取公钥哈希部分
                addressInfo = `P2PKH (pubKeyHash: ${pubKeyHash.substring(0, 10)}...)`;
            } else if (scriptType === 'P2SH') {
                const scriptHash = output.scriptPubKey.substring(4, 44);
                addressInfo = `P2SH (scriptHash: ${scriptHash.substring(0, 10)}...)`;
            }
            console.log(`Output ${index}: ${amountDOGE.toFixed(8)} DOGE (${output.value} satoshis) - ${addressInfo}`);
        }
    });
    console.log(`Total Outputs: ${outputs.length}`);

    // Calculate total output amount
    let totalOutputAmount = 0n;
    outputs.forEach(output => {
        totalOutputAmount += BigInt(output.value);
    });

    // Calculate actual fee
    const actualFeeSatoshis = totalInputAmountSatoshis - totalOutputAmount;
    console.log("--- FINAL FEE CALCULATION ---");
    console.log(`Total Input: ${totalInputAmountSatoshis} satoshis (${Number(totalInputAmountSatoshis) / 1e8} DOGE)`);
    console.log(`Total Output: ${totalOutputAmount} satoshis (${Number(totalOutputAmount) / 1e8} DOGE)`);
    console.log(`Actual Fee (Input - Output): ${actualFeeSatoshis} satoshis (${Number(actualFeeSatoshis) / 1e8} DOGE)`);
    console.log(`Expected Fee: ${finalFeeSatoshis} satoshis (${Number(finalFeeSatoshis) / 1e8} DOGE)`);
    if (actualFeeSatoshis !== finalFeeSatoshis) {
        console.log(`⚠️ Fee discrepancy: ${Number(actualFeeSatoshis - finalFeeSatoshis)} satoshis`);
    } else {
        console.log(`✓ Fee matches expected amount`);
    }
    console.log("-----------------------------");

    const outputCountHex = toCompactSizeBytes(outputs.length);

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
                txToSignParts.push(toCompactSizeBytes(scriptToSign.length / 2));
                txToSignParts.push(scriptToSign);
            } else {
                txToSignParts.push('00'); // scriptSig length 0 for other inputs
            }
            txToSignParts.push(inputs[j].sequence);
        }

        txToSignParts.push(outputCountHex);
        outputs.forEach(output => {
            txToSignParts.push(toLittleEndianHex(output.value, 8));
            txToSignParts.push(toCompactSizeBytes(output.scriptPubKey.length / 2));
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
        finalTxHexParts.push(toCompactSizeBytes(input.scriptSig.length / 2));
        finalTxHexParts.push(input.scriptSig);
        finalTxHexParts.push(input.sequence);
    });
    finalTxHexParts.push(outputCountHex);
    outputs.forEach(output => {
        finalTxHexParts.push(toLittleEndianHex(output.value, 8));
        finalTxHexParts.push(toCompactSizeBytes(output.scriptPubKey.length / 2));
        finalTxHexParts.push(output.scriptPubKey);
    });
    finalTxHexParts.push(locktime);
    return finalTxHexParts.join('');
}

async function sendTransactionWithUi() {
    startSendLoading('Preparing transaction...');
    try {
        await sendTransaction(); 
    } finally {
        stopSendLoading();
    }
}

async function sendTransaction() {
    //

    if (!wallet.address || !wallet.privateKey) {
        showAlert('Please create or import wallet first', 'error');
        return;
    }

    const amount = parseFloat(document.getElementById('amount').value);
    const recipientAddress = document.getElementById('toAddress').value.trim();
    const l2scanFeeAddress = document.getElementById('l2scanFeeAddress').value.trim();

    if (isNaN(amount) || amount <= 0 || !recipientAddress) {
        showAlert('Please enter amount and recipient address', 'error');
        return;
    }
    const amountSatoshis = Math.round(amount * 1e8);

    // Calculate L2Scan fee (0.3% of amount) only if address is provided
    let l2scanFeeAmount = 0;
    let l2scanFeeSatoshis = 0;
    if (l2scanFeeAddress && l2scanFeeAddress.trim() !== '') {
        l2scanFeeAmount = amount * 1e8 * 0.003; // 0.3%
        l2scanFeeSatoshis = Math.round(l2scanFeeAmount);
        console.log(`L2Scan fee calculated: ${l2scanFeeSatoshis} satoshis (${l2scanFeeSatoshis / 1e8} DOGE) to ${l2scanFeeAddress}`);
    } else {
        console.log('L2Scan fee address not provided, skipping L2Scan fee');
    }

    // Total amount needed including L2Scan fee (if any)
    const totalAmountNeededSatoshis = amountSatoshis + l2scanFeeSatoshis;

    try {
        const utxos = await getVerifiedUTXOs(wallet.address);
        if (!utxos || utxos.length === 0) {
            showAlert('No available UTXOs', 'error');
            return;
        }

        // Get OP_RETURN data if provided
        let opReturnData = document.getElementById('opReturnData') ? document.getElementById('opReturnData').value.trim() : '';
        let opReturnFormat = document.getElementById('opReturnFormat') ? document.getElementById('opReturnFormat').value : 'string';
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
        if (document.getElementById('dogeosAddress')) {
            const dogeosAddress = document.getElementById('dogeosAddress').value.trim();
            if (dogeosAddress) {
                opReturnData = dogeosAddress.toLowerCase().replace('0x', '00');
                opReturnDataLength = opReturnData.length / 2;
                opReturnFormat = "hex";
            }
        }

        let output = [];

        output.push(
            {
                address: recipientAddress,
                amount: amountSatoshis
            }
        )
        if (l2scanFeeAddress && l2scanFeeAmount > 0) {
            output.push({
                address: l2scanFeeAddress,
                amount: l2scanFeeAmount,
            })
        }
        output.push({
            address: wallet.address,
            amount: 0
        })

        const feePerByte = DEFAULT_FEE_RATE_SAT_PER_BYTE; // satoshis per byte
        let outputAmount = l2scanFeeAmount + amountSatoshis;

        // --- UTXO Selection Logic ---
        let actualSelectedUtxos = [];
        let totalInputAmount = 0n;
        let actualFeeSatoshis = 0;

        // Strategy 1: Find a single UTXO that is just large enough (optimal case)
        utxos.sort((a, b) => a.value - b.value); // Sort from smallest to largest

        let numOutputsForSingle = 1; // Recipient
        if (l2scanFeeAddress && l2scanFeeSatoshis > 0) numOutputsForSingle++;
        if (opReturnDataLength > 0) numOutputsForSingle++;
        numOutputsForSingle++; // Assume change output

        const feeForSingleInput = calculateActualEstimatedFee(1, numOutputsForSingle, feePerByte, opReturnDataLength);
        const targetForSingle = BigInt(totalAmountNeededSatoshis) + BigInt(feeForSingleInput);

        const singleUTXO = utxos.find(utxo => BigInt(utxo.value) >= targetForSingle);

        if (singleUTXO) {
            // Found a suitable single UTXO, this is the best case.
            actualSelectedUtxos = [singleUTXO];
            totalInputAmount = BigInt(singleUTXO.value);
            actualFeeSatoshis = feeForSingleInput;
        } else {
            // Strategy 2: Fallback to Largest-First Greedy Algorithm if no single UTXO is sufficient
            utxos.sort((a, b) => b.value - a.value); // Re-sort from largest to smallest

            for (const utxo of utxos) {
                actualSelectedUtxos.push(utxo);
                totalInputAmount += BigInt(utxo.value);

                // Estimate fee with the current number of inputs
                let numOutputs = 1; // Recipient
                if (l2scanFeeAddress && l2scanFeeSatoshis > 0) numOutputs++;
                if (opReturnDataLength > 0) numOutputs++;
                numOutputs++; // Assume change output will be needed

                actualFeeSatoshis = calculateActualEstimatedFee(actualSelectedUtxos.length, numOutputs, feePerByte, opReturnDataLength);

                // Check if we have gathered enough funds
                if (totalInputAmount >= BigInt(totalAmountNeededSatoshis) + BigInt(actualFeeSatoshis)) {
                    break; // Stop selecting once we have enough
                }
            }
        }

        // After the loop, check if we ultimately failed to gather enough funds
        if (totalInputAmount < BigInt(totalAmountNeededSatoshis) + BigInt(actualFeeSatoshis)) {
            showAlert(`Insufficient funds. Needed approx. ${(totalAmountNeededSatoshis + actualFeeSatoshis) / 1e8} DOGE, but only have ${Number(totalInputAmount) / 1e8} DOGE available.`, 'error');
            return;
        }
        // --- End of UTXO Selection ---

        // Final check before creating the transaction
        if (BigInt(totalInputAmount) < BigInt(totalAmountNeededSatoshis) + BigInt(actualFeeSatoshis)) {
            const needed = (BigInt(totalAmountNeededSatoshis) + BigInt(actualFeeSatoshis));
            showAlert(`Insufficient funds. Needed: ${Number(needed) / 1e8} DOGE, but only have ${Number(totalInputAmount) / 1e8} DOGE available.`, 'error');
            return;
        }

        // The logic for handling dust change is now correctly inside createActualTransaction.
        // We just pass the final calculated/specified fee.

        const rawTxHex = await createActualTransaction({
            selectedUtxos: actualSelectedUtxos,
            recipientAddress,
            amountToSendSatoshis: amountSatoshis,
            changeAddress: wallet.address,
            privateKeyHex: wallet.privateKey,
            feeSatoshis: actualFeeSatoshis,
            opReturnData: opReturnData || null,
            opReturnFormat,
            l2scanFeeAddress,
            l2scanFeeSatoshis,
        });

        console.log("Constructed Raw Transaction Hex Size:", rawTxHex.length);
        //console.log("Constructed Raw Transaction Hex:", rawTxHex);

        const txHashBytes = sha256Double(CryptoJS.enc.Hex.parse(rawTxHex));
        const localTxid = reverseHex(txHashBytes.toString(CryptoJS.enc.Hex));

        addPendingTransaction({
            txid: localTxid,
            amount: amount,
            recipient: recipientAddress,
            fee: actualFeeSatoshis / 1e8,
            l2scanFeeAmount: l2scanFeeAmount,
            l2scanFeeAddress: l2scanFeeAddress,
            opReturnData: opReturnData || null
        });

        const broadcastedTxid = await broadcastTransaction(rawTxHex);
        // After successful broadcast, immediately cache the spent UTXOs locally
        addSpentUTXOsToCache(actualSelectedUtxos);

        // Use broadcastedTxid as the canonical one
        await addBroadcastedTransaction({
            txid: broadcastedTxid,
            amount: amount,
            recipient: recipientAddress,
            fee: actualFeeSatoshis / 1e8,
            l2scanFeeAmount: l2scanFeeAmount,
            l2scanFeeAddress: l2scanFeeAddress,
            opReturnData: opReturnData || null
        }, wallet.address);

        let successMessage = 'Transaction sent successfully, TXID: ' + broadcastedTxid;
        if (l2scanFeeAddress && l2scanFeeAmount > 0) {
            successMessage += ', L2Scan fee: ' + l2scanFeeAmount.toFixed(8) + ' DOGE to ' + l2scanFeeAddress;
        }
        if (opReturnData) {
            successMessage += ', includes OP_RETURN data: ' + opReturnData.substring(0, 20) + (opReturnData.length > 20 ? '...' : '');
        }
        showAlert(successMessage, 'success');
        refreshBalanceAndUpdateUI(); // Refresh balance after sending
    } catch (error) {
        console.error("Transaction send failed details:", error);

        // 检查具体的错误类型并给出友好提示
        const errorMsg = error.message || '';

        if (errorMsg.includes('bad-txns-inputs-spent')) {
            showAlert('Transaction failed: An input was already spent.\nThis can happen if you send transactions quickly.\nYour balance is being refreshed. Please try again.', 'error');
            refreshBalanceAndUpdateUI();
        } else if (errorMsg.includes('absurdly-high-fee')) {
            showAlert('Transaction failed: Fee is too high.\nThis usually means there is an error in the transaction construction.\nPlease check the console for details.', 'error');
        } else if (errorMsg.includes('insufficient fee') || errorMsg.includes('min relay fee')) {
            showAlert('Transaction failed: Transaction fee is too low.\nPlease try again with a higher fee.', 'error');
        } else if (errorMsg.includes('dust')) {
            showAlert('Transaction failed: Output amount is too small (dust).\nMinimum amount is 0.001 DOGE per output.', 'error');
        } else if (errorMsg.includes('bad-txns-inputs-missingorspent')) {
            showAlert('Transaction failed: Input UTXOs are missing or already spent.\nYour balance is being refreshed. Please try again.', 'error');
            refreshBalanceAndUpdateUI();
        } else if (errorMsg.includes('txn-mempool-conflict')) {
            showAlert('Transaction failed: Conflicting transaction in mempool.\nPlease wait a moment and try again.', 'error');
        } else {
            showAlert('Transaction send failed: ' + errorMsg, 'error');
        }
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

async function refreshWalletTransactionHistory() {

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
                broadcastTime: apiTx.block_time || Date.now(), // block_time for mempool tx is usually null
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
            const electrsBase = 'https://blockbook.qiaoxiaorui.org/api/v2';
            const apiUrl = `${electrsBase}/tx/${tx.txid}`;
            const response = await fetch(apiUrl);
            const txData = response.ok ? await response.json() : null;

            if (txData && txData.confirmations > 0) {
                const newStatusDetails = {
                    status: 'confirmed',
                    block_height: txData.blockHeight,
                    block_time: txData.blockTime
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
    createScriptPubKey,
    createOpReturnScript,
    serializeTransaction,
    sendTransactionWithUi,
    openInBrowser,
    testConnection,
    viewPendingTransactions,
    viewBroadcastedTransactions,
    refreshWalletTransactionHistory,
    loadPersistedBroadcastedTransactions,
    checkPendingTransactionsStatus // Export new function
};
