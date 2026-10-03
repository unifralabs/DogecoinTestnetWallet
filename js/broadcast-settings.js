export const BROADCAST_SETTINGS_KEY = 'dogecoin_testnet_broadcast_settings_v1';
export const DEFAULT_BROADCAST_SETTINGS = Object.freeze({ type: 'jsonrpc', url: '' });

export function validateBroadcastSettings(settings) {
    if (!settings || settings.type !== 'jsonrpc') {
        throw new Error('Broadcasting requires a Dogecoin JSON-RPC endpoint. Enter and save your RPC URL.');
    }
    let url;
    try { url = new URL(settings.url.trim()); }
    catch { throw new Error('Enter a complete Dogecoin RPC URL, starting with https:// or http://.'); }
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('RPC URL must use HTTP or HTTPS.');
    if (url.username || url.password) throw new Error('Use the Authorization field instead of putting credentials in the URL.');
    if (url.hash) throw new Error('RPC URL must not contain a #fragment.');
    return { type: 'jsonrpc', url: url.href };
}

export function loadBroadcastSettings(storage = localStorage) {
    const saved = storage.getItem(BROADCAST_SETTINGS_KEY);
    return saved ? validateBroadcastSettings(JSON.parse(saved)) : { ...DEFAULT_BROADCAST_SETTINGS };
}

export function saveBroadcastSettings(settings, storage = localStorage) {
    const valid = validateBroadcastSettings(settings);
    // Do not persist authentication headers alongside the endpoint settings.
    storage.setItem(BROADCAST_SETTINGS_KEY, JSON.stringify(valid));
    return valid;
}

export function clearBroadcastSettings(storage = localStorage) {
    storage.removeItem(BROADCAST_SETTINGS_KEY);
}

export function getBroadcastSettings() {
    const url = document.getElementById('broadcastUrl');
    const settings = validateBroadcastSettings(url
        ? { type: 'jsonrpc', url: url.value }
        : loadBroadcastSettings());
    const authorization = document.getElementById('broadcastAuthorization')?.value.trim() || '';
    if (/[\r\n]/.test(authorization)) throw new Error('Authorization must be a single-line header value.');
    return { ...settings, authorization };
}

export function initializeBroadcastSettings() {
    const url = document.getElementById('broadcastUrl');
    if (!url) return;
    const status = document.getElementById('broadcastSettingsStatus');
    try {
        const saved = loadBroadcastSettings();
        url.value = saved.url;
        status.textContent = saved.url
            ? 'Saved RPC URL restored from this browser.'
            : 'Enter your Dogecoin testnet RPC URL. Save it to remember it in this browser.';
    } catch {
        url.value = '';
        status.textContent = 'Saved settings could not be used as Dogecoin JSON-RPC. Enter and save your RPC URL.';
    }
    url.addEventListener('input', () => {
        url.removeAttribute('aria-invalid');
        status.textContent = 'Changed — click Save to remember. Broadcasting uses the RPC URL currently shown.';
    });
    document.getElementById('saveBroadcastSettingsBtn').addEventListener('click', () => {
        try {
            const saved = saveBroadcastSettings({ type: 'jsonrpc', url: url.value });
            url.value = saved.url;
            url.removeAttribute('aria-invalid');
            status.textContent = 'Saved. This RPC URL will be restored the next time you open this site.';
        } catch (error) {
            url.setAttribute('aria-invalid', 'true');
            status.textContent = `Not saved: ${error.message}`;
        }
    });
    document.getElementById('resetBroadcastSettingsBtn').addEventListener('click', () => {
        url.value = '';
        document.getElementById('broadcastAuthorization').value = '';
        url.removeAttribute('aria-invalid');
        try {
            clearBroadcastSettings();
            status.textContent = 'Saved RPC URL cleared. Enter an RPC URL before broadcasting.';
        } catch (error) { status.textContent = `Cleared for this page, but could not clear browser storage: ${error.message}`; }
    });
}
