import { wallet } from './wallet.js';

function updateWalletUI() {
    if (wallet.address) {
        document.getElementById('address').textContent = wallet.address;
        document.getElementById('privateKey').textContent = wallet.wif || '生成或导入钱包以查看';
        document.getElementById('balance').textContent = `${wallet.balance.toFixed(8)} DOGE`;
        document.getElementById('balance').style.color = wallet.balanceAvailable ? '#38a169' : '#666';
    } else {
        document.getElementById('address').textContent = '点击生成钱包';
        document.getElementById('privateKey').textContent = '点击生成钱包'; // This will show WIF once available
        document.getElementById('balance').textContent = '点击生成钱包';
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
            showAlert('复制失败，请手动选择复制', 'error');
        }
    } catch (err) {
        showAlert('复制失败，请手动选择复制', 'error');
    }
}

export {
    updateWalletUI,
    updateCopyButtons,
    showAlert,
    copyToClipboard,
    fallbackCopy
};
