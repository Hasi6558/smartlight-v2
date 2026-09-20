import { $, state, fmtData, escapeHtml, SQLITE_API_URL, SKU_API_URL, SETTINGS_API_URL } from './state.js';

export async function checkServerMqttStatus() {
  try {
    const res = await fetch('/api/mqtt/status');
    if (res.ok) {
      const data = await res.json();
      state.serverConnected = data.connected;
      state.serverConnecting = data.connecting;

      updateMqttUIState(data);
      if (data.apInfo) setApInfo(data.apInfo);

      setApPresence(!!(data.apTrafficSeen || (data.apInfo && (data.apInfo.IP || data.apInfo.ID)) || (data.logs?.received?.length > 0)));
      if (data.logs) renderServerLogs(data.logs);
    }
  } catch (e) {
    updateMqttUIState({ connected: false, connecting: false, lastError: "Host Server unreachable" });
    setApPresence(false);
  }
}

function setApPresence(seen) {
  const dot = $('apDot'), text = $('apText');
  if (dot && text) {
    dot.className = seen ? 'dot connected' : 'dot';
    text.textContent = seen ? 'AP: traffic seen' : 'AP: no traffic seen';
  }
}

export function updateMqttUIState(statusData) {
  const isConn = statusData.connected, isConnecting = statusData.connecting;
  const topbarBtn = $('topbarConnectBtn'), settingsBtn = $('startBtn');
  const lightToggleBtn = $('lightToggleBtn'), lightStatus = $('lightStatus');

  if (topbarBtn) {
    topbarBtn.textContent = isConn ? 'Disconnect' : (isConnecting ? 'Connecting…' : 'Connect');
    topbarBtn.className = isConn ? 'btn-sm btn-danger' : (isConnecting ? 'btn-sm btn-accent' : 'btn-sm btn-primary');
  }
  if (settingsBtn) {
    settingsBtn.textContent = isConn ? 'DISCONNECT SERVER FROM BROKER' : (isConnecting ? 'CONNECTING SERVER…' : 'CONNECT SERVER TO BROKER');
    settingsBtn.className = isConn ? 'btn-block btn-danger' : (isConnecting ? 'btn-block btn-accent' : 'btn-block btn-primary');
  }
  if (lightToggleBtn) lightToggleBtn.disabled = !isConn;
  if (lightStatus) {
    lightStatus.className = 'light-status ' + (isConn ? 'ok' : (statusData.lastError ? 'bad' : ''));
    lightStatus.textContent = isConn ? 'Host server connected to broker.' : (isConnecting ? 'Broker connection in progress…' : (statusData.lastError || 'Broker disconnected. Click Connect to enable.'));
  }
  if ($('statusDot')) $('statusDot').className = 'dot' + (isConn ? ' connected' : (isConnecting ? ' connecting' : (statusData.lastError ? ' error' : '')));
  if ($('statusText')) $('statusText').textContent = isConn ? 'Broker: connected' : (isConnecting ? 'Broker: connecting…' : (statusData.lastError ? `Error: ${statusData.lastError}` : 'Broker: disconnected'));
}

export async function triggerServerConnect() {
  const config = {
    host: $('host')?.value.trim(), port: $('port')?.value.trim(), wsPath: $('wsPath')?.value.trim(),
    clientId: $('clientId')?.value.trim(), username: $('username')?.value.trim(),
    password: $('password')?.value, subTopic: $('subTopic')?.value.trim()
  };
  updateMqttUIState({ connected: false, connecting: true });
  try {
    const res = await fetch('/api/mqtt/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
    if (res.ok) setTimeout(checkServerMqttStatus, 1000);
  } catch (e) {
    updateMqttUIState({ connected: false, connecting: false, lastError: e.message });
  }
}

export async function triggerServerDisconnect() {
  try { await fetch('/api/mqtt/disconnect', { method: 'POST' }); checkServerMqttStatus(); } catch (e) {}
}

export async function publishMqttViaServer(topic, payload) {
  if (!state.serverConnected) { alert("Host server is not connected to MQTT broker."); return false; }
  try {
    const res = await fetch('/api/mqtt/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic, payload }) });
    if (res.ok) { checkServerMqttStatus(); return true; }
    const errData = await res.json();
    alert(`Publish failed: ${errData.error || 'Server error'}`);
    return false;
  } catch (e) {
    alert(`Publish error: ${e.message}`);
    return false;
  }
}

function setApInfo(info) {
  const map = { apId: info.ID ?? info.apId, apIp: info.IP ?? info.apIp, apMac: info.MAC ?? info.apMac, apFw: info.Firmware ?? info.firmware };
  Object.entries(map).forEach(([elId, val]) => {
    const el = $(elId);
    if (el && val !== undefined && val !== null && val !== '') { el.textContent = val; el.classList.remove('empty'); }
  });
}

function renderServerLogs(logs) {
  if ($('reqBody') && logs.published?.length > 0) {
    $('reqBody').innerHTML = logs.published.map(l => `<tr><td class="time">${escapeHtml(l.time)}</td><td class="code">${escapeHtml(l.code)}</td><td class="name">${escapeHtml(l.name)}</td><td class="name">${escapeHtml(l.topic)}</td><td class="data">${escapeHtml(fmtData(l.data))}</td></tr>`).join('');
  }
  if ($('resBody') && logs.received?.length > 0) {
    $('resBody').innerHTML = logs.received.map(l => `<tr><td class="time">${escapeHtml(l.time)}</td><td class="code">${escapeHtml(l.code)}</td><td class="name">${escapeHtml(l.name)}</td><td class="name">${escapeHtml(l.topic)}</td><td class="data">${escapeHtml(fmtData(l.data))}</td></tr>`).join('');
  }
}

export async function loadSettings() {
  try {
    const res = await fetch(SETTINGS_API_URL);
    if (res.ok) {
      const settings = await res.json();
      ['AreaTag', 'ShelfTag', 'ItemTag'].forEach(type => { if (settings['icon_' + type]) state.settings.icons[type] = settings['icon_' + type]; });

      const { applySubpageVisibility } = await import('./UI/tabs.js');
      applySubpageVisibility('light', settings['show_light_control'] !== 'false');
      applySubpageVisibility('wh-db', settings['show_wh_db'] !== 'false');
      applySubpageVisibility('debug', settings['show_debug_console'] === 'true');
      applySubpageVisibility('warehouse', settings['show_wh_config'] === 'true');

      if (settings.mqtt_host && $('host')) $('host').value = settings.mqtt_host;
      if (settings.mqtt_port && $('port')) $('port').value = settings.mqtt_port;
      if (settings.task_timeout_minutes) {
        state.settings.taskTimeoutMinutes = parseInt(settings.task_timeout_minutes, 10) || 10;
        if ($('picklistTimeoutInput')) $('picklistTimeoutInput').value = state.settings.taskTimeoutMinutes;
      }
    }
  } catch (e) {}
}

export async function saveTagsToStorage() { try { await fetch(SQLITE_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.tags) }); } catch (e) {} }
export async function loadTagsFromStorage() { try { const res = await fetch(SQLITE_API_URL); if (res.ok) state.tags = await res.json(); } catch (e) {} }
export async function saveSkusToStorage() { try { await fetch(SKU_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.skus) }); } catch (e) {} }
export async function loadSkusFromStorage() { try { const res = await fetch(SKU_API_URL); if (res.ok) state.skus = await res.json(); } catch (e) {} }

export async function loadInventoryData() {
  try {
    const res = await fetch('/api/inventory');
    if (res.ok) {
      state.inventory = await res.json();
      const { renderInventoryTable } = await import('./modules/inventory.js');
      renderInventoryTable();
    }
  } catch(e) {}
}

export async function loadTransactionsData() {
  try {
    const res = await fetch('/api/transactions');
    if (res.ok) {
      state.transactions = await res.json();
      const { renderTransactionsTable } = await import('./modules/inventory.js');
      renderTransactionsTable();
    }
  } catch(e) {}
}

export async function savePicklistsToStorage() {
  try {
    await fetch('/api/picklists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.picklists)
    });
  } catch(e) {}
}

export async function loadPicklistsFromStorage() {
  try {
    const res = await fetch('/api/picklists');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) state.picklists = data;
    }
  } catch(e) {}
}

export async function saveTemplatesToStorage() {
  const res = await fetch('/api/picklist-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state.templates)
  });
  if (!res.ok) throw new Error('Failed to save list templates.');
}

export async function loadTemplatesFromStorage() {
  const res = await fetch('/api/picklist-templates');
  if (!res.ok) throw new Error('Failed to load list templates.');
  const data = await res.json();
  if (Array.isArray(data)) state.templates = data;
}

export function initApiListeners() {
  $('sendBtn')?.addEventListener('click', () => {
    const topic = $('pubTopic')?.value.trim();
    const raw = $('msgData')?.value.trim();
    let data = raw;
    if (raw) { try { data = JSON.parse(raw); } catch (e) {} }
    if (!topic) { alert('Set a topic first.'); return; }
    publishMqttViaServer(topic, data);
  });

  $('picklistTimeoutInput')?.addEventListener('change', (e) => {
    const mins = Math.max(1, parseInt(e.target.value, 10) || 10);
    state.settings.taskTimeoutMinutes = mins;
    fetch(SETTINGS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'task_timeout_minutes', value: mins.toString() })
    }).catch(() => {});
  });
}