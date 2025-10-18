import { wallet } from './wallet.js';

function updateWalletUI() {
    if (wallet.address) {
        document.getElementById('address').textContent = wallet.address;
        document.getElementById('privateKey').textContent = wallet.wif || 'Generate or import wallet to view';
        document.getElementById('balance').textContent = `${wallet.balance.toFixed(8)} DOGE`;
        document.getElementById('balance').style.color = wallet.balanceAvailable ? '#38a169' : '#666';
    } else {
        document.getElementById('address').textContent = 'Click Generate Wallet';
        document.getElementById('privateKey').textContent = 'Click Generate Wallet'; // This will show WIF once available
        document.getElementById('balance').textContent = 'Click Generate Wallet';
        document.getElementById('balance').style.color = '#666';
    }
    
    updateCopyButtons();
}

function updateCopyButtons() {
    const copyAddressBtn = document.getElementById('copyAddressBtn');
    const copyPrivateKeyBtn = document.getElementById('copyPrivateKeyBtn');
    const viewInBrowserBtn = document.getElementById('viewInBrowser');
    
    if (copyAddressBtn) copyAddressBtn.disabled = !wallet.address;
    if (copyPrivateKeyBtn) copyPrivateKeyBtn.disabled = !wallet.wif; // Disable if no WIF
    if (viewInBrowserBtn) viewInBrowserBtn.disabled = !wallet.address;
}

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
            showAlert('Copy failed, please select and copy manually', 'error');
        }
    } catch (err) {
        showAlert('Copy failed, please select and copy manually', 'error');
    }
}

// Start the send button loading state and optionally show a progress message
function startSendLoading(message = 'Sending...') {
    try {
        const sendBtn = document.getElementById('sendTransactionBtn');
        const progress = document.getElementById('sendProgressText');
        // disable and visually dim the button, and replace its text with the message
        if (sendBtn) {
            // save original text so we can restore later
            if (!sendBtn.dataset.originalText) sendBtn.dataset.originalText = sendBtn.textContent;
            sendBtn.textContent = message;
            sendBtn.disabled = true;
            sendBtn.classList.add('btn-loading');
            // Quick inline visual change in case CSS for disabled buttons is not defined
            sendBtn.style.opacity = '0.6';
            sendBtn.style.cursor = 'not-allowed';
        }

        // hide any page-level spinner if present (we no longer use it)
        const pageSpinner = document.getElementById('sendSpinner');
        if (pageSpinner) pageSpinner.classList.add('hidden');

        if (progress) progress.textContent = message;
    } catch (e) {
        console.warn('startSendLoading failed', e);
    }
}

// Stop the send button loading state and optionally show a final message briefly
function stopSendLoading(finalMessage = '') {
    try {
        const sendBtn = document.getElementById('sendTransactionBtn');
        const progress = document.getElementById('sendProgressText');

        if (sendBtn) {
            // restore original text if we saved it
            if (sendBtn.dataset.originalText) {
                sendBtn.textContent = sendBtn.dataset.originalText;
                delete sendBtn.dataset.originalText;
            }
            sendBtn.disabled = false;
            sendBtn.classList.remove('btn-loading');
            sendBtn.style.opacity = '';
            sendBtn.style.cursor = '';
        }

        // ensure any page-level spinner is hidden
        const pageSpinner = document.getElementById('sendSpinner');
        if (pageSpinner) pageSpinner.classList.add('hidden');

        if (progress) {
            if (finalMessage) {
                progress.textContent = finalMessage;
                setTimeout(() => { if (progress) progress.textContent = ''; }, 1800);
            } else {
                progress.textContent = '';
            }
        }
    } catch (e) {
        console.warn('stopSendLoading failed', e);
    }
}

export {
    updateWalletUI,
    updateCopyButtons,
    showAlert,
    copyToClipboard,
    fallbackCopy
    ,startSendLoading,
    stopSendLoading
};
