(function(){
  "use strict";

  // ---------------- DOM Helper ----------------
  const $ = (id) => document.getElementById(id);

  // Helper function for Date/Time formatting
  function formatDateTime(isoStr) {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString([], {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }

  const STORAGE_KEY = 'ap_console_tags_v1';
  const SKU_STORAGE_KEY = 'ap_console_skus_v1';
  const SQLITE_API_URL = '/api/tags';
  const SKU_API_URL = '/api/skus';
  const SETTINGS_API_URL = '/api/settings';

  // ---------------- state ----------------
  const state = {
    serverConnected: false,
    serverConnecting: false,
    tags: [],
    skus: [],
    inventory: [],
    transactions: [],
    selectedUids: new Set(),
    selectedSkuNos: new Set(),
    filterType: 'ALL',
    sortBy: 'MANUAL',
    sortDir: 'ASC',
    useSQLiteBackend: true,
    configLocked: true,
    skuConfigLocked: true,
    collapsedAreas: new Set(),
    collapsedShelves: new Set(),
    stockCollapsedAreas: new Set(),
    stockCollapsedShelves: new Set(),
    isBatchEditingStock: false,
    batchAdjustments: {}, // skuNo -> quantityDelta
    invSortCol: 'skuNo',
    invSortDir: 'ASC',
    txSortCol: 'timestamp',
    txSortDir: 'DESC',
    txClusterPicklist: false,
    picklists: [],
    homeSubtab: 'TODAY', // 'TODAY' or 'HISTORY'
    historySelectedDate: '',
    showCompletedToday: false, // Default: Hide completed/cancelled tasks
    settings: {
      icons: { AreaTag: null, ShelfTag: null, ItemTag: null },
      taskTimeoutMinutes: 10
    }
  };

  let editingUid = null;
  let editingSkuNo = null;
  let currentSkuImageBase64 = '';
  let draggedWhObject = null;
  let currentEditingStockSku = null;

  const ICONS = {
    AreaTag: `<svg class="tag-icon-svg" viewBox="0 0 24 24"><path d="M3 3v18M21 3v18M3 7h18M3 14h18" stroke-width="2" stroke-linecap="round"/><rect x="5" y="9" width="4" height="4" rx="1" stroke-width="1.8"/><rect x="11" y="9" width="4" height="4" rx="1" stroke-width="1.8"/><rect x="15" y="16" width="4" height="4" rx="1" stroke-width="1.8"/></svg>`,
    ShelfTag: `<svg class="tag-icon-svg" viewBox="0 0 24 24"><rect x="2" y="9" width="5" height="6" rx="1" stroke-width="1.8"/><rect x="9" y="9" width="5" height="6" rx="1" stroke-width="1.8"/><rect x="16" y="9" width="5" height="6" rx="1" stroke-width="1.8"/><path d="M2 17h20" stroke-width="2" stroke-linecap="round"/></svg>`,
    ItemTag: `<svg class="tag-icon-svg" viewBox="0 0 24 24"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" stroke-width="1.8"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12" stroke-width="1.8"/></svg>`
  };

  function renderTagIcon(tagType){
    if (state.settings.icons[tagType]){
      return `<img src="${escapeHtml(state.settings.icons[tagType])}" class="tag-icon-svg" alt="${tagType}">`;
    }
    return ICONS[tagType] || '';
  }

  // ---------------- CONFIRMATION MODAL HELPER ----------------
  let confirmCallback = null;
  function confirmDialog(title, message, onConfirm) {
    $('confirmModalTitle').textContent = title || 'Confirm Action';
    $('confirmModalText').textContent = message || 'Are you sure you want to proceed?';
    confirmCallback = onConfirm;
    $('confirmModal').classList.add('active');
  }
  function closeConfirmDialog() {
    $('confirmModal').classList.remove('active');
    confirmCallback = null;
  }
  $('confirmModalCloseBtn').addEventListener('click', closeConfirmDialog);
  $('confirmModalCancelBtn').addEventListener('click', closeConfirmDialog);
  $('confirmModalActionBtn').addEventListener('click', () => {
    if (confirmCallback) confirmCallback();
    closeConfirmDialog();
  });

  // ---------------- TAP/CLICK OUTSIDE OVERLAY TO CLOSE SUBWINDOWS ----------------
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    let isMouseDownOnOverlay = false;
    
    overlay.addEventListener('mousedown', (e) => {
      isMouseDownOnOverlay = (e.target === overlay);
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && isMouseDownOnOverlay) {
        if (overlay.id === 'scannerModal') {
          closeScanner();
        } else if (overlay.id === 'skuFormModal') {
          toggleSkuForm(false);
        } else if (overlay.id === 'editStockModal') {
          closeEditStockModal();
        } else if (overlay.id === 'createListModal') {
          attemptCloseCreateListModal();
        } else if (overlay.id === 'whSkuPickerModal') {
          closeWhSkuPickerModal();
        } else {
          overlay.classList.remove('active');
        }
      }
    });
  });

  // ---------------- SERVER MQTT BACKEND GATEWAY COMMUNICATION ----------------
  async function checkServerMqttStatus() {
    try {
      const res = await fetch('/api/mqtt/status');
      if (res.ok) {
        const data = await res.json();
        state.serverConnected = data.connected;
        state.serverConnecting = data.connecting;

        updateMqttUIState(data);
        if (data.apInfo) setApInfo(data.apInfo);

        if (data.apTrafficSeen || (data.apInfo && (data.apInfo.IP || data.apInfo.ID)) || (data.logs && data.logs.received && data.logs.received.length > 0)) {
          setApPresence(true);
        } else {
          setApPresence(false);
        }

        if (data.logs) renderServerLogs(data.logs);
      }
    } catch(e) {
      updateMqttUIState({ connected: false, connecting: false, lastError: "Host Server unreachable" });
      setApPresence(false);
    }
  }

  function setApPresence(seen){
    const dot = $('apDot');
    const text = $('apText');
    if (seen){
      dot.className = 'dot connected';
      text.textContent = 'AP: traffic seen';
    } else {
      dot.className = 'dot';
      text.textContent = 'AP: no traffic seen';
    }
  }

  function updateMqttUIState(statusData) {
    const isConn = statusData.connected;
    const isConnecting = statusData.connecting;

    const topbarBtn = $('topbarConnectBtn');
    const settingsBtn = $('startBtn');
    const lightToggleBtn = $('lightToggleBtn');
    const lightStatus = $('lightStatus');

    if (isConn) {
      $('statusDot').className = 'dot connected';
      $('statusText').textContent = 'Broker: connected';

      topbarBtn.textContent = 'Disconnect';
      topbarBtn.className = 'btn-sm btn-danger';

      settingsBtn.textContent = 'DISCONNECT SERVER FROM BROKER';
      settingsBtn.className = 'btn-block btn-danger';

      lightToggleBtn.disabled = false;
      lightStatus.className = 'light-status ok';
      lightStatus.textContent = 'Host server connected to broker.';
    } else if (isConnecting) {
      $('statusDot').className = 'dot connecting';
      $('statusText').textContent = 'Broker: connecting…';

      topbarBtn.textContent = 'Connecting…';
      topbarBtn.className = 'btn-sm btn-accent';

      settingsBtn.textContent = 'CONNECTING SERVER…';
      settingsBtn.className = 'btn-block btn-accent';

      lightToggleBtn.disabled = true;
      lightStatus.className = 'light-status';
      lightStatus.textContent = 'Broker connection in progress…';
    } else {
      $('statusDot').className = 'dot' + (statusData.lastError ? ' error' : '');
      $('statusText').textContent = statusData.lastError ? `Error: ${statusData.lastError}` : 'Broker: disconnected';

      topbarBtn.textContent = 'Connect';
      topbarBtn.className = 'btn-sm btn-primary';

      settingsBtn.textContent = 'CONNECT SERVER TO BROKER';
      settingsBtn.className = 'btn-block btn-primary';

      lightToggleBtn.disabled = true;
      lightStatus.className = 'light-status bad';
      lightStatus.textContent = statusData.lastError ? statusData.lastError : 'Broker disconnected. Click Connect to enable.';
    }
  }

  async function triggerServerConnect() {
    const config = {
      host: $('host').value.trim(),
      port: $('port').value.trim(),
      wsPath: $('wsPath').value.trim(),
      clientId: $('clientId').value.trim(),
      username: $('username').value.trim(),
      password: $('password').value,
      subTopic: $('subTopic').value.trim()
    };

    updateMqttUIState({ connected: false, connecting: true });

    try {
      const res = await fetch('/api/mqtt/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      if (res.ok) {
        setTimeout(checkServerMqttStatus, 1000);
      }
    } catch(e) {
      updateMqttUIState({ connected: false, connecting: false, lastError: e.message });
    }
  }

  async function triggerServerDisconnect() {
    try {
      await fetch('/api/mqtt/disconnect', { method: 'POST' });
      checkServerMqttStatus();
    } catch(e){}
  }

  async function publishMqttViaServer(topic, payload) {
    if (!state.serverConnected) {
      alert("Host server is not connected to MQTT broker.");
      return false;
    }
    try {
      const res = await fetch('/api/mqtt/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, payload })
      });
      if (res.ok) {
        checkServerMqttStatus();
        return true;
      } else {
        const errData = await res.json();
        alert(`Publish failed: ${errData.error || 'Server error'}`);
        return false;
      }
    } catch(e) {
      alert(`Publish error: ${e.message}`);
      return false;
    }
  }

  $('topbarConnectBtn').addEventListener('click', () => {
    if (state.serverConnected || state.serverConnecting) triggerServerDisconnect();
    else triggerServerConnect();
  });

  $('startBtn').addEventListener('click', () => {
    if (state.serverConnected || state.serverConnecting) triggerServerDisconnect();
    else triggerServerConnect();
  });

  function renderServerLogs(logs) {
    if ($('reqBody')) {
      const reqBody = $('reqBody');
      if (logs.published && logs.published.length > 0) {
        reqBody.innerHTML = logs.published.map(l => 
          `<tr><td class="time">${escapeHtml(l.time)}</td><td class="code">${escapeHtml(l.code)}</td><td class="name">${escapeHtml(l.name)}</td><td class="name">${escapeHtml(l.topic)}</td><td class="data">${escapeHtml(fmtData(l.data))}</td></tr>`
        ).join('');
      }
    }

    if ($('resBody')) {
      const resBody = $('resBody');
      if (logs.received && logs.received.length > 0) {
        resBody.innerHTML = logs.received.map(l => 
          `<tr><td class="time">${escapeHtml(l.time)}</td><td class="code">${escapeHtml(l.code)}</td><td class="name">${escapeHtml(l.name)}</td><td class="name">${escapeHtml(l.topic)}</td><td class="data">${escapeHtml(fmtData(l.data))}</td></tr>`
        ).join('');
      }
    }
  }

  // Auto-timeout checking function
  function checkPicklistTimeouts() {
    const timeoutMin = state.settings.taskTimeoutMinutes || 10;
    const timeoutMs = timeoutMin * 60 * 1000;
    const now = Date.now();
    let stateChanged = false;

    state.picklists.forEach(list => {
      if (list.status === 'ACTIVE' && list.activatedAt) {
        const elapsed = now - new Date(list.activatedAt).getTime();
        if (elapsed >= timeoutMs) {
          // Auto-deactivate and set list to CANCELLED/TIMED_OUT
          finishList(list.uid, false);
          list.completedAt = new Date().toISOString();
          stateChanged = true;
        }
      }
    });

    if (stateChanged) {
      savePicklistsToStorage();
      renderPicklists();
    }
  }

  setInterval(() => {
    checkServerMqttStatus();
    checkPicklistTimeouts();
  }, 2500);

  // ---------------- Settings & Subpage Visibility ----------------
  async function loadSettings(){
    try {
      const res = await fetch(SETTINGS_API_URL);
      if (res.ok) {
        const settings = await res.json();
        ['AreaTag','ShelfTag','ItemTag'].forEach(type => {
          if (settings['icon_' + type]) {
            state.settings.icons[type] = settings['icon_' + type];
          }
        });

        // Load subpage visibility preferences
        if (settings['show_light_control'] !== undefined) {
          const show = settings['show_light_control'] === 'true';
          $('showLightControlCb').checked = show;
          applySubpageVisibility('light', show);
        } else {
          $('showLightControlCb').checked = true;
          applySubpageVisibility('light', true);
        }

        if (settings['show_wh_db'] !== undefined) {
          const show = settings['show_wh_db'] === 'true';
          $('showWhDbCb').checked = show;
          applySubpageVisibility('wh-db', show);
        } else {
          $('showWhDbCb').checked = true;
          applySubpageVisibility('wh-db', true);
        }

        if (settings['show_debug_console'] !== undefined) {
          const showDebug = settings['show_debug_console'] === 'true';
          $('showDebugConsoleCb').checked = showDebug;
          applySubpageVisibility('debug', showDebug);
        }
        if (settings['show_wh_config'] !== undefined) {
          const showWhConfig = settings['show_wh_config'] === 'true';
          $('showWhConfigCb').checked = showWhConfig;
          applySubpageVisibility('warehouse', showWhConfig);
        }

        if (settings.mqtt_host) $('host').value = settings.mqtt_host;
        if (settings.mqtt_port) $('port').value = settings.mqtt_port;
        if (settings.mqtt_wsPath) $('wsPath').value = settings.mqtt_wsPath;
        if (settings.mqtt_clientId) $('clientId').value = settings.mqtt_clientId;
        if (settings.mqtt_username) $('username').value = settings.mqtt_username;
        if (settings.mqtt_password) $('password').value = settings.mqtt_password;
        if (settings.mqtt_subTopic) $('subTopic').value = settings.mqtt_subTopic;
        if (settings.task_timeout_minutes) {
          state.settings.taskTimeoutMinutes = parseInt(settings.task_timeout_minutes, 10) || 10;
          if ($('picklistTimeoutInput')) $('picklistTimeoutInput').value = state.settings.taskTimeoutMinutes;
        }
      }
    } catch(e) {}
    updateSettingsPreviews();
  }

  // Event listener to save timeout changes
  $('picklistTimeoutInput')?.addEventListener('change', (e) => {
    const mins = Math.max(1, parseInt(e.target.value, 10) || 10);
    state.settings.taskTimeoutMinutes = mins;
    fetch(SETTINGS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'task_timeout_minutes', value: mins.toString() })
    }).catch(() => {});
  });

  function applySubpageVisibility(tabKey, show) {
    let btn = null;
    if (tabKey === 'light') btn = $('lightTabBtn');
    else if (tabKey === 'wh-db') btn = $('whDbTabBtn');
    else if (tabKey === 'warehouse') btn = $('whConfigTabBtn');
    else if (tabKey === 'debug') btn = $('debugTabBtn');

    if (btn) btn.style.display = show ? '' : 'none';
    
    // If currently active page is being hidden, fallback to Warehouse Stock
    if (!show && $('tab-' + tabKey) && $('tab-' + tabKey).classList.contains('active')) {
      switchTab('wh-stock');
    }
  }

  $('showLightControlCb')?.addEventListener('change', (e) => {
    const checked = e.target.checked;
    applySubpageVisibility('light', checked);
    fetch(SETTINGS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'show_light_control', value: checked ? 'true' : 'false' })
    }).catch(err => {});
  });

  $('showWhDbCb')?.addEventListener('change', (e) => {
    const checked = e.target.checked;
    applySubpageVisibility('wh-db', checked);
    fetch(SETTINGS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'show_wh_db', value: checked ? 'true' : 'false' })
    }).catch(err => {});
  });

  $('showDebugConsoleCb').addEventListener('change', (e) => {
    const checked = e.target.checked;
    applySubpageVisibility('debug', checked);
    fetch(SETTINGS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'show_debug_console', value: checked ? 'true' : 'false' })
    }).catch(err => {});
  });

  $('showWhConfigCb').addEventListener('change', (e) => {
    const checked = e.target.checked;
    applySubpageVisibility('warehouse', checked);
    fetch(SETTINGS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'show_wh_config', value: checked ? 'true' : 'false' })
    }).catch(err => {});
  });

  async function saveIconSetting(tagType, dataUrl){
    state.settings.icons[tagType] = dataUrl;
    try {
      await fetch(SETTINGS_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'icon_' + tagType, value: dataUrl || '' })
      });
    } catch(e){}
    updateSettingsPreviews();
    renderTagListAnimated();
  }

  async function clearIconSetting(tagType){
    state.settings.icons[tagType] = null;
    try { await fetch(`${SETTINGS_API_URL}/icon_${tagType}`, { method: 'DELETE' }); } catch(e){}
    updateSettingsPreviews();
    renderTagListAnimated();
  }

  function updateSettingsPreviews(){
    ['AreaTag','ShelfTag','ItemTag'].forEach(type => {
      const previewEl = $('iconPreview-' + type);
      if (previewEl){
        if (state.settings.icons[type]) {
          previewEl.innerHTML = `<img src="${escapeHtml(state.settings.icons[type])}" style="max-width:100%; max-height:100%; object-fit:contain;" alt="${type}">`;
        } else {
          previewEl.innerHTML = ICONS[type] || '';
        }
      }
    });
  }

  ['AreaTag','ShelfTag','ItemTag'].forEach(type => {
    const btnUpload = $('btnUpload-' + type);
    const fileInput = $('fileInput-' + type);
    const btnClear = $('btnClear-' + type);

    if (btnUpload && fileInput){
      btnUpload.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const maxDim = 200;
            let width = img.width, height = img.height;
            if (width > height) {
              if (width > maxDim) { height *= maxDim / width; width = maxDim; }
            } else {
              if (height > maxDim) { width *= maxDim / height; height = maxDim; }
            }
            canvas.width = Math.round(width);
            canvas.height = Math.round(height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            saveIconSetting(type, canvas.toDataURL('image/png'));
          };
          img.src = evt.target.result;
        };
        reader.readAsDataURL(file);
        e.target.value = '';
      });
    }

    if (btnClear){
      btnClear.addEventListener('click', () => clearIconSetting(type));
    }
  });

  // ---------------- Storage & Sync Helpers (Tags & SKUs) ----------------
  async function saveTagsToStorage(){
    try {
      await fetch(SQLITE_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.tags)
      });
    } catch(e) {}
  }

  async function loadTagsFromStorage(){
    try {
      const res = await fetch(SQLITE_API_URL);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) state.tags = data;
      }
    } catch(e) {}
  }

  async function saveSkusToStorage(){
    try {
      await fetch(SKU_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.skus)
      });
    } catch(e) {}
  }

  async function loadSkusFromStorage(){
    try {
      const res = await fetch(SKU_API_URL);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) state.skus = data;
      }
    } catch(e) {}
  }

  // ---------------- JSON Export & Import Logic ----------------
  function exportConfigJSON() {
    const backupObj = { tags: state.tags, skus: state.skus };
    const jsonStr = JSON.stringify(backupObj, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().slice(0, 10);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `smart_light_warehouse_backup_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function importConfigJSON(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target.result);
        if (Array.isArray(imported)) {
          state.tags = imported;
        } else if (typeof imported === 'object' && imported.tags) {
          state.tags = imported.tags || [];
          if (imported.skus) state.skus = imported.skus;
        } else {
          alert("Invalid file format.");
          return;
        }
        state.selectedUids.clear();
        state.selectedSkuNos.clear();
        saveTagsToStorage();
        saveSkusToStorage();
        renderTagListAnimated();
        if ($('tab-warehouse').classList.contains('active')) renderWarehouseConfigAnimated();
        if ($('tab-wh-db').classList.contains('active')) renderSkuTable();
        alert(`Configuration imported successfully!`);
      } catch(err) {
        alert("Error parsing JSON file: " + err.message);
      }
    };
    reader.readAsText(file);
  }

  $('exportJsonBtn').addEventListener('click', exportConfigJSON);
  $('importJsonBtn').addEventListener('click', () => $('importFileInput').click());
  $('importFileInput').addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      importConfigJSON(e.target.files[0]);
      e.target.value = '';
    }
  });

  // ---------------- EXCEL EXPORT & IMPORT UTILITIES ----------------
  function exportDataToExcel(data, fileName) {
    if (typeof XLSX === 'undefined') {
      alert("SheetJS library is loading. Please try again in a moment.");
      return;
    }
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    XLSX.writeFile(wb, `${fileName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  // ---------------- helpers ----------------
  function escapeHtml(s){
    return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function fmtData(d){
    if (d === undefined || d === null) return '';
    if (typeof d === 'string') return d;
    try { return JSON.stringify(d); } catch(e){ return String(d); }
  }

  function setApInfo(info){
    const map = { apId: info.ID ?? info.apId, apIp: info.IP ?? info.apIp, apMac: info.MAC ?? info.apMac, apFw: info.Firmware ?? info.firmware };
    Object.entries(map).forEach(([elId, val])=>{
      const el = $(elId);
      if (val !== undefined && val !== null && val !== ''){
        el.textContent = val; el.classList.remove('empty');
      }
    });
  }

  // Check socket handshake
  $('checkBtn').addEventListener('click', ()=>{
    const host = $('host').value.trim().replace(/^mqtts?:\/\//i, '').replace(/\/+$/, '');
    const port = $('port').value.trim();
    const path = $('wsPath').value.trim();
    const resEl = $('checkResult');
    resEl.className = 'check-result';
    resEl.textContent = 'Checking…';

    const url = `ws://${host}:${port}${path.startsWith('/') ? path : '/' + path}`;
    let settled = false;
    let sock;
    try { sock = new WebSocket(url); }
    catch(err){
      resEl.textContent = `Could not open socket: ${err.message}`;
      resEl.classList.add('bad');
      return;
    }
    const timer = setTimeout(()=>{
      if (settled) return;
      settled = true;
      resEl.textContent = `No response from ${url} within 3s (timed out).`;
      resEl.classList.add('bad');
      try{ sock.close(); }catch(e){}
    }, 3000);

    sock.onopen = ()=>{
      if (settled) return;
      settled = true; clearTimeout(timer);
      resEl.textContent = `${url} accepted WebSocket handshake — reachable.`;
      resEl.classList.add('ok');
      sock.close();
    };
    sock.onerror = ()=>{
      if (settled) return;
      settled = true; clearTimeout(timer);
      resEl.textContent = `${url} did not accept WebSocket handshake.`;
      resEl.classList.add('bad');
    };
  });

  // ---------------- publish debug message ----------------
  $('sendBtn').addEventListener('click', ()=>{
    const topic = $('pubTopic').value.trim();
    const raw = $('msgData').value.trim();
    let data = raw;
    if (raw){ try { data = JSON.parse(raw); } catch(e){} }

    if (!topic){ alert('Set a topic first.'); return; }
    publishMqttViaServer(topic, data);
    $('msgData').value = '';
  });

  // ---------------- Tab Switching Engine ----------------
  function switchTab(target){
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === target));
    document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
    const page = $('tab-' + target);
    if (page) page.classList.add('active');

    if (target === 'warehouse') renderWarehouseConfig();
    if (target === 'wh-stock') renderWarehouseStock();
    if (target === 'wh-inventory') loadInventoryData();
    if (target === 'wh-transactions') loadTransactionsData();
    if (target === 'wh-db') renderSkuTable();
    if (target === 'settings') updateSettingsPreviews();
    if (target === 'home') renderPicklists();

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  document.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      switchTab(btn.dataset.tab);
    });
  });

  $('brandHomeBtn')?.addEventListener('click', () => switchTab('home'));

  // Attach Settings Jump Buttons
  document.querySelectorAll('[data-goto-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.gotoTab);
    });
  });

  // ---------------- light group control ----------------
  const LIGHT_TOPIC = '/estation/7301A67/recv';

  function updateColorPreview(){
    const r = $('colorRed').checked, g = $('colorGreen').checked, b = $('colorBlue').checked;
    $('optRed').classList.toggle('checked', r);
    $('optGreen').classList.toggle('checked', g);
    $('optBlue').classList.toggle('checked', b);

    const color = (r?4:0) + (g?2:0) + (b?1:0);
    $('colorValue').textContent = color;

    const parts = [];
    if (r) parts.push('Red');
    if (g) parts.push('Green');
    if (b) parts.push('Blue');
    $('colorCombo').textContent = parts.length ? parts.join(' + ') : 'No color selected';

    const swatch = $('colorSwatchBig');
    if (color === 0){ swatch.style.background = '#3A4148'; }
    else {
      const rr = r ? 229 : 30, gg = g ? 201 : 30, bb = b ? 232 : 30;
      swatch.style.background = `rgb(${rr},${gg},${bb})`;
    }
    return color;
  }
  ['colorRed','colorGreen','colorBlue'].forEach(id => $(id).addEventListener('change', updateColorPreview));
  updateColorPreview();

  $('lightToggleBtn').addEventListener('click', ()=>{
    const color = updateColorPreview();
    const payload = {
      Time: 1,
      StartGroup: 0,
      EndGroup: 255,
      StartID: "000000000000",
      EndID: "FFFFFFFFFFFF",
      Flashing: $('flashToggle').checked,
      Beep: $('beepToggle').checked,
      Color: color,
      Sequence: 19,
      Code: 132,
      Token: ""
    };
    publishMqttViaServer(LIGHT_TOPIC, payload);
  });

  // ---------------- light strips management ----------------
  const TAG_TOPIC = '/estation/7301A67/recv';

  function tagSwatchColor(color){
    if (!color) return '#3A4148';
    const r = (color & 4) ? 229 : 30, g = (color & 2) ? 201 : 30, b = (color & 1) ? 232 : 30;
    return `rgb(${r},${g},${b})`;
  }

  function updateLsColorPreview(){
    const r = $('lsColorRed').checked, g = $('lsColorGreen').checked, b = $('lsColorBlue').checked;
    $('lsOptRed').classList.toggle('checked', r);
    $('lsOptGreen').classList.toggle('checked', g);
    $('lsOptBlue').classList.toggle('checked', b);
    const color = (r?4:0) + (g?2:0) + (b?1:0);
    $('lsColorValue').textContent = color;
    $('lsColorSwatch').style.background = tagSwatchColor(color);
    return color;
  }
  ['lsColorRed','lsColorGreen','lsColorBlue'].forEach(id => $(id).addEventListener('change', updateLsColorPreview));
  updateLsColorPreview();

  function toggleLsForm(show, editTag = null){
    const panel = $('lsFormPanel');
    const titleEl = $('lsFormTitle');
    const isCurrentlyOpen = panel.classList.contains('open');
    if (show === undefined) show = !isCurrentlyOpen;
    
    if (!show){
      panel.classList.remove('open');
      editingUid = null;
      titleEl.classList.remove('edit-mode-title');
      resetLsForm();
      return;
    }

    panel.classList.add('open');
    if (editTag){
      editingUid = editTag.uid;
      titleEl.textContent = 'Edit Light Strip (' + editTag.tagId + ')';
      titleEl.classList.add('edit-mode-title');
      $('lsAddBtn').textContent = 'SAVE CHANGES';
      
      $('lsTagType').value = editTag.tagType;
      $('lsTagID').value = editTag.tagId;
      $('lsTagRef').value = editTag.tagRef || '';
      $('lsAreaID').value = editTag.areaId || '';
      $('lsShopID').value = editTag.shopId || '';
      $('lsMaterialID').value = editTag.materialId || '';
      $('lsDescription').value = editTag.description || '';
      
      $('lsColorRed').checked = !!(editTag.defaultColor & 4);
      $('lsColorGreen').checked = !!(editTag.defaultColor & 2);
      $('lsColorBlue').checked = !!(editTag.defaultColor & 1);
      $('lsDefaultBeep').checked = editTag.defaultBeep;
      $('lsDefaultFlash').checked = editTag.defaultFlash;
    } else {
      editingUid = null;
      titleEl.textContent = 'Add Light Strip';
      titleEl.classList.remove('edit-mode-title');
      $('lsAddBtn').textContent = 'ADD LIGHT STRIP';
      resetLsForm();
    }
    updateLsColorPreview();
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function resetLsForm(){
    $('lsTagID').value = '';
    $('lsTagRef').value = '';
    $('lsAreaID').value = '';
    $('lsShopID').value = '';
    $('lsMaterialID').value = '';
    $('lsDescription').value = '';
    $('lsColorRed').checked = false;
    $('lsColorGreen').checked = false;
    $('lsColorBlue').checked = false;
    $('lsDefaultBeep').checked = false;
    $('lsDefaultFlash').checked = false;
    updateLsColorPreview();
  }

  $('toggleAddLsBtn').addEventListener('click', () => toggleLsForm(true));
  $('lsCancelBtn').addEventListener('click', () => toggleLsForm(false));
  $('lsClearBtn').addEventListener('click', resetLsForm);

  // Add / Edit Light Strip Save Handler
  $('lsAddBtn').addEventListener('click', () => {
    const tagId = $('lsTagID').value.trim();
    if (!tagId) {
      alert("Tag ID is required.");
      return;
    }

    const tagData = {
      uid: editingUid || ('tag_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)),
      tagType: $('lsTagType').value,
      tagId: tagId,
      tagRef: $('lsTagRef').value.trim(),
      areaId: $('lsAreaID').value.trim(),
      shopId: $('lsShopID').value.trim(),
      materialId: $('lsMaterialID').value.trim(),
      description: $('lsDescription').value.trim(),
      defaultColor: updateLsColorPreview(),
      defaultBeep: $('lsDefaultBeep').checked,
      defaultFlash: $('lsDefaultFlash').checked,
      parentTag: editingUid ? (state.tags.find(t => t.uid === editingUid)?.parentTag || '') : ''
    };

    if (editingUid) {
      const idx = state.tags.findIndex(t => t.uid === editingUid);
      if (idx >= 0) state.tags[idx] = tagData;
    } else {
      state.tags.push(tagData);
    }

    saveTagsToStorage();
    toggleLsForm(false);
    renderTagListAnimated();
  });

  // Clear Individual Form Input Fields via "X" Button
  document.querySelectorAll('[data-clear-field]').forEach(btn => {
    btn.addEventListener('click', () => {
      const fieldId = btn.dataset.clearField;
      if ($(fieldId)) {
        $(fieldId).value = '';
        if (fieldId === 'whModalSearch') renderAttachModalList();
        if (fieldId === 'searchInventory') renderInventoryTable();
        if (fieldId === 'searchTransactions') renderTransactionsTable();
        if (fieldId === 'searchWarehouseStock') renderWarehouseStock();
        if (fieldId === 'clOrderNo') updateClDirtyTracking();
      }
    });
  });

  // ---------------- CAMERA QR / BARCODE SCANNER LOGIC ----------------
  let scanVideoTrack = null;
  let currentScanTargetInput = null;
  let scanAnimFrameId = null;

  async function openScanner(targetInputId) {
    currentScanTargetInput = $(targetInputId);
    const modal = $('scannerModal');
    modal.classList.add('active');
    $('scannerStatus').textContent = 'Initializing camera...';
    $('manualScanInput').value = '';

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const video = $('scannerVideo');
      video.srcObject = stream;
      scanVideoTrack = stream.getVideoTracks()[0];
      video.play();
      $('scannerStatus').textContent = 'Point camera at QR code or Barcode';

      if ('BarcodeDetector' in window) {
        const detector = new BarcodeDetector();
        const detectLoop = async () => {
          if (!modal.classList.contains('active')) return;
          try {
            const barcodes = await detector.detect(video);
            if (barcodes.length > 0) {
              const rawValue = barcodes[0].rawValue;
              if (currentScanTargetInput) {
                currentScanTargetInput.value = rawValue;
                if (currentScanTargetInput.id === 'whModalSearch') renderAttachModalList();
                if (currentScanTargetInput.id === 'whSkuPickerSearch') renderWhSkuPickerTable();
                if (currentScanTargetInput.id === 'searchInventory') renderInventoryTable();
                if (currentScanTargetInput.id === 'searchTransactions') renderTransactionsTable();
                if (currentScanTargetInput.id === 'searchWarehouseStock') renderWarehouseStock();
                if (currentScanTargetInput.id === 'clOrderNo') updateClDirtyTracking();
              }
              closeScanner();
              return;
            }
          } catch(e){}
          scanAnimFrameId = requestAnimationFrame(detectLoop);
        };
        scanAnimFrameId = requestAnimationFrame(detectLoop);
      } else {
        $('scannerStatus').textContent = 'Camera active. (Use manual fallback below if needed)';
      }
    } catch(err) {
      $('scannerStatus').textContent = 'Camera error or permission denied: ' + err.message;
    }
  }

  function closeScanner() {
    if (scanAnimFrameId) cancelAnimationFrame(scanAnimFrameId);
    if (scanVideoTrack) {
      scanVideoTrack.stop();
      scanVideoTrack = null;
    }
    const video = $('scannerVideo');
    if (video) video.srcObject = null;
    $('scannerModal').classList.remove('active');
  }

  document.querySelectorAll('[data-scan-for]').forEach(btn => {
    btn.addEventListener('click', () => openScanner(btn.dataset.scanFor));
  });

  $('closeScannerBtn').addEventListener('click', closeScanner);

  $('confirmManualScanBtn').addEventListener('click', () => {
    const val = $('manualScanInput').value.trim();
    if (val && currentScanTargetInput) {
      currentScanTargetInput.value = val;
      if (currentScanTargetInput.id === 'whModalSearch') renderAttachModalList();
      if (currentScanTargetInput.id === 'whSkuPickerSearch') renderWhSkuPickerTable();
      if (currentScanTargetInput.id === 'searchInventory') renderInventoryTable();
      if (currentScanTargetInput.id === 'searchTransactions') renderTransactionsTable();
      if (currentScanTargetInput.id === 'searchWarehouseStock') renderWarehouseStock();
      if (currentScanTargetInput.id === 'clOrderNo') updateClDirtyTracking();
    }
    closeScanner();
  });

  // ---------------- Light Control Filtering & Tag List ----------------
  function getFilteredAndSortedTags(){
    let result = [...state.tags];
    if (state.filterType !== 'ALL') result = result.filter(t => t.tagType === state.filterType);

    const search = ($('searchLightStrips')?.value || '').trim().toLowerCase();
    if (search) {
      result = result.filter(t => {
        const tagId = (t.tagId || '').toLowerCase();
        const tagRef = (t.tagRef || '').toLowerCase();
        const matId = (t.materialId || '').toLowerCase();
        return tagId.includes(search) || tagRef.includes(search) || matId.includes(search);
      });
    }
    
    if (state.sortBy !== 'MANUAL'){
      const key = state.sortBy;
      result.sort((a, b) => {
        const valA = (a[key] || '').toString();
        const valB = (b[key] || '').toString();
        const cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
        return state.sortDir === 'ASC' ? cmp : -cmp;
      });
    }
    return result;
  }

  $('searchLightStrips').addEventListener('input', () => renderTagListAnimated());
  $('filterTagType').addEventListener('change', (e) => { state.filterType = e.target.value; renderTagListAnimated(); });
  $('sortBy').addEventListener('change', (e) => { state.sortBy = e.target.value; renderTagListAnimated(); });
  $('sortDirBtn').addEventListener('click', () => {
    state.sortDir = state.sortDir === 'ASC' ? 'DESC' : 'ASC';
    $('sortDirBtn').textContent = state.sortDir;
    renderTagListAnimated();
  });

  function renderTagListAnimated(){
    const container = $('lightStripList');
    const oldCards = Array.from(container.querySelectorAll('.strip-card'));
    const firstPositions = new Map();

    oldCards.forEach(card => {
      const uid = card.dataset.uid;
      if (uid) firstPositions.set(uid, card.getBoundingClientRect());
    });

    renderTagList();

    const newCards = Array.from(container.querySelectorAll('.strip-card'));
    newCards.forEach(card => {
      const uid = card.dataset.uid;
      const first = firstPositions.get(uid);
      if (first) {
        const last = card.getBoundingClientRect();
        const deltaX = first.left - last.left;
        const deltaY = first.top - last.top;

        if (deltaX !== 0 || deltaY !== 0) {
          card.style.transition = 'none';
          card.style.transform = `translate(${deltaX}px, ${deltaY}px)`;

          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              card.style.transition = 'transform 0.35s cubic-bezier(0.2, 0, 0, 1)';
              card.style.transform = '';
            });
          });
        }
      }
    });
  }

  function renderTagList(){
    const container = $('lightStripList');
    const displayTags = getFilteredAndSortedTags();

    if (!displayTags.length){
      container.innerHTML = '<div class="empty-strip-hint">No matching light strips found.</div>';
      updateSelectAllState();
      return;
    }

    container.innerHTML = displayTags.map(t => {
      const isSelected = state.selectedUids.has(t.uid);
      const iconMarkup = renderTagIcon(t.tagType);
      
      const customIconUrl = state.settings.icons[t.tagType];
      const iconBoxContent = customIconUrl
        ? `<img src="${escapeHtml(customIconUrl)}" alt="${escapeHtml(t.tagType)} Icon">`
        : `<div class="default-icon-wrap">${ICONS[t.tagType] || ''}</div>`;

      return `
        <div class="strip-card ${isSelected ? 'selected' : ''}" data-uid="${t.uid}" draggable="true">
          <div class="strip-head">
            <div class="strip-title">
              <input type="checkbox" class="strip-select-cb" data-uid="${t.uid}" ${isSelected ? 'checked' : ''}>
              <div class="strip-icon-box" title="${escapeHtml(t.tagType)} Icon">
                ${iconBoxContent}
              </div>
              <div style="min-width:0;">
                <div class="strip-tagid">${escapeHtml(t.tagId)}</div>
                ${t.tagRef ? `<div class="strip-tagref">${escapeHtml(t.tagRef)}</div>` : ''}
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
              <span class="strip-badge">${iconMarkup} ${escapeHtml(t.tagType)}</span>
              <span class="drag-handle" title="Drag to rearrange">⋮⋮</span>
            </div>
          </div>

          <div class="strip-kv">
            <div class="k">Parent</div><div class="v">${t.parentTag ? escapeHtml(t.parentTag) : '—'}</div>
            <div class="k">Area</div><div class="v">${t.areaId ? escapeHtml(t.areaId) : '—'}</div>
            <div class="k">Shop</div><div class="v">${t.shopId ? escapeHtml(t.shopId) : '—'}</div>
            <div class="k">Material</div><div class="v">${t.materialId ? escapeHtml(t.materialId) : '—'}</div>
            <div class="k">Desc</div><div class="v">${t.description ? escapeHtml(t.description) : '—'}</div>
          </div>
          <div class="strip-defaults">
            <span class="strip-swatch" style="background:${tagSwatchColor(t.defaultColor)};"></span>
            <span>Color ${t.defaultColor}</span>
            <span>${t.defaultBeep ? 'Beep ON' : 'Beep OFF'}</span>
            <span>${t.defaultFlash ? 'Flash ON' : 'Flash OFF'}</span>
          </div>
          <div class="strip-actions">
            <button class="btn-sm btn-accent" data-activate="${t.uid}" type="button">Activate</button>
            <button class="btn-sm btn-primary" data-test="${t.uid}" type="button">Test</button>
            <button class="btn-sm btn-danger" data-stop="${t.uid}" type="button">Stop</button>
            <button class="btn-sm btn-ghost" data-edit="${t.uid}" type="button">Edit</button>
            <button class="btn-sm btn-ghost" data-remove="${t.uid}" type="button" style="color:var(--red);">Delete</button>
          </div>
          <div class="strip-status" id="status-${t.uid}"></div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.strip-select-cb').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const uid = e.target.dataset.uid;
        if (e.target.checked) state.selectedUids.add(uid);
        else state.selectedUids.delete(uid);
        renderTagList();
      });
    });

    container.querySelectorAll('[data-activate]').forEach(btn=>{
      btn.addEventListener('click', ()=> publishTagActivate(btn.dataset.activate));
    });

    container.querySelectorAll('[data-edit]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const t = state.tags.find(x => x.uid === btn.dataset.edit);
        if (t) toggleLsForm(true, t);
      });
    });

    container.querySelectorAll('[data-remove]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const uid = btn.dataset.remove;
        confirmDialog("Delete Light Strip", "Are you sure you want to delete this light strip?", () => {
          const removedTag = state.tags.find(t => t.uid === uid);
          state.tags = state.tags.filter(t => t.uid !== uid);
          state.selectedUids.delete(uid);
          if (removedTag) {
            state.tags.forEach(t => { if (t.parentTag === removedTag.tagId) t.parentTag = ''; });
          }
          saveTagsToStorage();
          renderTagListAnimated();
        });
      });
    });

    container.querySelectorAll('[data-test]').forEach(btn=>{
      btn.addEventListener('click', ()=> publishTagTest(btn.dataset.test));
    });

    container.querySelectorAll('[data-stop]').forEach(btn=>{
      btn.addEventListener('click', ()=> publishTagStop(btn.dataset.stop));
    });

    updateSelectAllState();
  }

  function updateSelectAllState(){
    const visibleTags = getFilteredAndSortedTags();
    const allSelected = visibleTags.length > 0 && visibleTags.every(t => state.selectedUids.has(t.uid));
    $('selectAllCb').checked = allSelected;
  }

  $('batchDeleteBtn').addEventListener('click', () => {
    const count = state.selectedUids.size;
    if (count === 0){ alert('No tags selected for batch delete.'); return; }
    confirmDialog("Batch Delete Tags", `Are you sure you want to delete ${count} selected light strip(s)?`, () => {
      const deletedTagIds = new Set(
        state.tags.filter(t => state.selectedUids.has(t.uid)).map(t => t.tagId)
      );
      state.tags = state.tags.filter(t => !state.selectedUids.has(t.uid));
      state.selectedUids.clear();
      state.tags.forEach(t => {
        if (t.parentTag && deletedTagIds.has(t.parentTag)) t.parentTag = '';
      });
      saveTagsToStorage();
      renderTagListAnimated();
      updateSelectAllState();
    });
  });

  // ---------------- Tag Lineage & Bi-directional Cascading Activation ----------------
  function getCascadeActivationSet(startTag){
    const targetTags = new Set();
    if (!startTag) return [];

    let current = startTag;
    const visited = new Set();
    while (current && !visited.has(current.uid)) {
      visited.add(current.uid);
      targetTags.add(current);
      if (!current.parentTag) break;
      current = state.tags.find(t => t.tagId === current.parentTag);
    }

    if (startTag.tagType === 'AreaTag') {
      const childShelves = state.tags.filter(t => t.tagType === 'ShelfTag' && t.parentTag === startTag.tagId);
      childShelves.forEach(shelf => {
        targetTags.add(shelf);
        const childItems = state.tags.filter(t => t.tagType === 'ItemTag' && t.parentTag === shelf.tagId);
        childItems.forEach(item => targetTags.add(item));
      });
    } else if (startTag.tagType === 'ShelfTag') {
      const childItems = state.tags.filter(t => t.tagType === 'ItemTag' && t.parentTag === startTag.tagId);
      childItems.forEach(item => targetTags.add(item));
    }

    return Array.from(targetTags);
  }

  function publishTagActivate(uid){
    const t = state.tags.find(x => x.uid === uid);
    if (!t) return;

    const cascadeSet = getCascadeActivationSet(t);
    cascadeSet.forEach(node => {
      const payload = {
        Time: 5,
        Items: [{ TagID: node.tagId, Beep: node.defaultBeep, Color: node.defaultColor, Flashing: node.defaultFlash }],
        Sequence: 26,
        Code: 131,
        Token: ""
      };
      publishMqttViaServer(TAG_TOPIC, payload);
    });
  }

  function publishTagTest(uid){
    const t = state.tags.find(x => x.uid === uid);
    if (!t) return;
    const payload = {
      Time: 5,
      Items: [{ TagID: t.tagId, Beep: t.defaultBeep, Color: t.defaultColor, Flashing: t.defaultFlash }],
      Sequence: 26,
      Code: 131,
      Token: ""
    };
    publishMqttViaServer(TAG_TOPIC, payload);
  }

  function publishTagStop(uid){
    const t = state.tags.find(x => x.uid === uid);
    if (!t) return;
    const payload = {
      Time: 5,
      Items: [{ TagID: t.tagId, Beep: false, Color: 0, Flashing: false }],
      Sequence: 26,
      Code: 131,
      Token: ""
    };
    publishMqttViaServer(TAG_TOPIC, payload);
  }

  // ---------------- WAREHOUSE DATABASE (SKU MANAGEMENT) ----------------
  $('lockSkuDbBtn').addEventListener('click', () => {
    state.skuConfigLocked = !state.skuConfigLocked;
    const btn = $('lockSkuDbBtn');
    if (state.skuConfigLocked) {
      btn.textContent = ' SKU DB LOCKED';
      btn.classList.add('btn-danger');
      btn.classList.remove('btn-ghost');
      $('toggleAddSkuBtn').disabled = true;
    } else {
      btn.textContent = ' SKU DB UNLOCKED';
      btn.classList.remove('btn-danger');
      btn.classList.add('btn-ghost');
      $('toggleAddSkuBtn').disabled = false;
    }
    renderSkuTable();
  });

  // Export SKU Template Function
  $('btnExportSkuTemplate')?.addEventListener('click', () => {
    const templateData = [
      {
        "SKU No": "SKU-SAMPLE-101",
        "Item Label": "Sample Shampoo 500ml",
        "Description": "Organic Citrus Scented Hair Shampoo",
        "Supplier / Customer": "Acme Chemical Corp",
        "Tag Bind": "TAG1001"
      },
      {
        "SKU No": "SKU-SAMPLE-102",
        "Item Label": "Sample Body Wash 1000ml",
        "Description": "Moisturizing Body Soap with Vitamin E",
        "Supplier / Customer": "Global Logistics Hub",
        "Tag Bind": "TAG1002"
      }
    ];
    exportDataToExcel(templateData, "SKU_Import_Template");
  });

  // Import SKU Excel Function with Duplicate Alarm Validation
  $('btnImportSkuExcel')?.addEventListener('click', () => $('importSkuExcelInput').click());

  $('importSkuExcelInput')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (typeof XLSX === 'undefined') {
      alert("SheetJS library is loading. Please try again in a second.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonRows = XLSX.utils.sheet_to_json(worksheet);

        if (!jsonRows || jsonRows.length === 0) {
          alert("The uploaded Excel file appears to be empty.");
          return;
        }

        // Validate duplicates
        const fileSkuSet = new Set();
        const fileTagBindSet = new Set();
        const existingSkuSet = new Set(state.skus.map(s => (s.skuNo || '').trim().toLowerCase()));
        const existingTagBindSet = new Set(state.skus.map(s => (s.tagBind || '').trim().toLowerCase()).filter(Boolean));

        const alarms = [];
        const validNewSkus = [];

        jsonRows.forEach((row, idx) => {
          const rowNum = idx + 2; // Excel header is row 1
          const skuNo = (row["SKU No"] || row["skuNo"] || row["SKU"] || '').toString().trim();
          const itemLabel = (row["Item Label"] || row["itemLabel"] || row["Label"] || '').toString().trim();
          const description = (row["Description"] || row["description"] || '').toString().trim();
          const supplierCustomer = (row["Supplier / Customer"] || row["Supplier"] || row["supplierCustomer"] || '').toString().trim();
          const tagBind = (row["Tag Bind"] || row["tagBind"] || row["Tag"] || '').toString().trim();

          if (!skuNo || !itemLabel) {
            alarms.push(`Row ${rowNum}: Missing mandatory 'SKU No' or 'Item Label'.`);
            return;
          }

          const lowerSku = skuNo.toLowerCase();
          const lowerTag = tagBind.toLowerCase();

          // Internal file duplicates check
          if (fileSkuSet.has(lowerSku)) {
            alarms.push(`Row ${rowNum}: Duplicate SKU No '${skuNo}' found within the Excel file.`);
          } else {
            fileSkuSet.add(lowerSku);
          }

          if (tagBind && fileTagBindSet.has(lowerTag)) {
            alarms.push(`Row ${rowNum}: Duplicate Tag Bind '${tagBind}' found within the Excel file.`);
          } else if (tagBind) {
            fileTagBindSet.add(lowerTag);
          }

          // Existing Database duplicates check
          if (existingSkuSet.has(lowerSku)) {
            alarms.push(`Row ${rowNum}: SKU No '${skuNo}' already exists in Warehouse Database.`);
          }

          if (tagBind && existingTagBindSet.has(lowerTag)) {
            alarms.push(`Row ${rowNum}: Tag Bind '${tagBind}' is already bound to an existing SKU in Database.`);
          }

          validNewSkus.push({
            skuNo,
            itemLabel,
            description,
            supplierCustomer,
            tagBind,
            dateAdded: new Date().toISOString().slice(0, 10),
            productImage: ''
          });
        });

        if (alarms.length > 0) {
          const alarmMsg = `🚨 EXCEL IMPORT ALARM DETECTED 🚨\n\nFound ${alarms.length} issue(s):\n• ` + alarms.join('\n• ') + `\n\nImport cancelled. Please fix duplicate entries and try again.`;
          alert(alarmMsg);
          e.target.value = '';
          return;
        }

        // Batch Append valid SKUs
        state.skus = [...state.skus, ...validNewSkus];
        saveSkusToStorage();
        renderSkuTable();
        alert(`Successfully imported ${validNewSkus.length} SKU item(s) from Excel!`);

      } catch(err) {
        alert("Error reading Excel file: " + err.message);
      }
      e.target.value = '';
    };
    reader.readAsArrayBuffer(file);
  });

  function openSkuDetailModal(skuNo) {
    const sku = state.skus.find(s => s.skuNo === skuNo) || state.inventory.find(i => i.skuNo === skuNo);
    if (!sku) return;

    $('skuDetailModalTitle').textContent = `SKU Details · ${sku.skuNo}`;
    $('skuDetailNo').textContent = sku.skuNo;
    $('skuDetailLabel').textContent = sku.itemLabel || '—';
    $('skuDetailSupplier').textContent = sku.supplierCustomer || '—';
    $('skuDetailTagBind').textContent = sku.tagBind || '—';
    $('skuDetailDate').textContent = sku.dateAdded || '—';
    $('skuDetailDesc').textContent = sku.description || 'No extended description available.';

    const imgWrap = $('skuDetailImageWrap');
    if (sku.productImage) {
      imgWrap.innerHTML = `<img src="${escapeHtml(sku.productImage)}" style="max-width:100%; max-height:280px; object-fit:contain;">`;
    } else {
      imgWrap.innerHTML = `<div style="font-size:12px; color:var(--text-faint);">No Product Image Uploaded</div>`;
    }

    $('skuDetailModal').classList.add('active');
  }

  $('skuDetailCloseBtn').addEventListener('click', () => {
    $('skuDetailModal').classList.remove('active');
  });

  function toggleSkuForm(show, editSku = null){
    if (state.skuConfigLocked && show) return;
    const modal = $('skuFormModal');
    const titleEl = $('skuFormTitle');
    const isCurrentlyOpen = modal.classList.contains('active');
    if (show === undefined) show = !isCurrentlyOpen;

    if (!show){
      modal.classList.remove('active');
      editingSkuNo = null;
      currentSkuImageBase64 = '';
      resetSkuForm();
      return;
    }

    modal.classList.add('active');
    if (editSku){
      editingSkuNo = editSku.skuNo;
      titleEl.textContent = `Edit SKU Item (${editSku.skuNo})`;
      $('skuSaveBtn').textContent = 'SAVE SKU CHANGES';

      $('skuNo').value = editSku.skuNo;
      $('skuItemLabel').value = editSku.itemLabel || '';
      $('skuSupplierCustomer').value = editSku.supplierCustomer || '';
      $('skuTagBind').value = editSku.tagBind || '';
      $('skuDescription').value = editSku.description || '';
      currentSkuImageBase64 = editSku.productImage || '';
      updateSkuImgPreview();
    } else {
      editingSkuNo = null;
      titleEl.textContent = 'Add SKU Item';
      $('skuSaveBtn').textContent = 'SAVE SKU ITEM';
      resetSkuForm();
    }
  }

  function resetSkuForm(){
    $('skuNo').value = '';
    $('skuItemLabel').value = '';
    $('skuSupplierCustomer').value = '';
    $('skuTagBind').value = '';
    $('skuDescription').value = '';
    currentSkuImageBase64 = '';
    updateSkuImgPreview();
  }

  function updateSkuImgPreview(){
    const box = $('skuImgPreviewBox');
    if (currentSkuImageBase64) {
      box.innerHTML = `<img src="${escapeHtml(currentSkuImageBase64)}" style="width:100%;height:100%;object-fit:cover;">`;
    } else {
      box.innerHTML = 'No image';
    }
  }

  $('toggleAddSkuBtn').addEventListener('click', () => toggleSkuForm(true));
  $('skuModalCloseBtn').addEventListener('click', () => toggleSkuForm(false));
  $('skuCancelBtn').addEventListener('click', () => toggleSkuForm(false));
  $('skuClearBtn').addEventListener('click', resetSkuForm);

  $('btnUploadSkuImg').addEventListener('click', () => $('skuImageInput').click());
  $('skuImageInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 300;
        let width = img.width, height = img.height;
        if (width > height) {
          if (width > maxDim) { height *= maxDim / width; width = maxDim; }
        } else {
          if (height > maxDim) { width *= maxDim / height; height = maxDim; }
        }
        canvas.width = Math.round(width);
        canvas.height = Math.round(height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        currentSkuImageBase64 = canvas.toDataURL('image/jpeg', 0.85);
        updateSkuImgPreview();
      };
      img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });

  $('btnClearSkuImg').addEventListener('click', () => {
    currentSkuImageBase64 = '';
    updateSkuImgPreview();
  });

  // SKU Tag Picker Launcher
  $('btnPickTagForSku').addEventListener('click', () => {
    openAttachModal('skuPickTag', null);
  });

  $('skuSaveBtn').addEventListener('click', () => {
    if (state.skuConfigLocked) return;
    const skuNo = $('skuNo').value.trim();
    const itemLabel = $('skuItemLabel').value.trim();
    if (!skuNo || !itemLabel){
      alert("SKU No and Item Label are required fields.");
      return;
    }

    if (state.skus.some(s => s.skuNo === skuNo && s.skuNo !== editingSkuNo)){
      alert(`An item with SKU No: ${skuNo} already exists.`);
      return;
    }

    const skuData = {
      skuNo,
      itemLabel,
      supplierCustomer: $('skuSupplierCustomer').value.trim(),
      tagBind: $('skuTagBind').value.trim(),
      description: $('skuDescription').value.trim(),
      dateAdded: editingSkuNo ? (state.skus.find(s => s.skuNo === editingSkuNo)?.dateAdded || new Date().toISOString().slice(0,10)) : new Date().toISOString().slice(0,10),
      productImage: currentSkuImageBase64
    };

    if (editingSkuNo) {
      const idx = state.skus.findIndex(s => s.skuNo === editingSkuNo);
      if (idx >= 0) state.skus[idx] = skuData;
    } else {
      state.skus.push(skuData);
    }

    saveSkusToStorage();
    toggleSkuForm(false);
    renderSkuTable();
  });

  // Date Range & TagBind Filter Listeners
  $('filterSkuDateRange').addEventListener('change', () => renderSkuTable());
  $('filterSkuTagBindSelect').addEventListener('change', () => renderSkuTable());

  // Multi-Header Filter Listeners for SKU Table
  ['filterSkuNo','filterSkuLabel','filterSkuDesc','filterSkuSupplier','filterSkuTagBind','filterSkuDate'].forEach(id => {
    $(id).addEventListener('input', () => renderSkuTable());
  });

  function getFilteredSkus(){
    const fSkuNo = $('filterSkuNo').value.trim().toLowerCase();
    const fLabel = $('filterSkuLabel').value.trim().toLowerCase();
    const fDesc = $('filterSkuDesc').value.trim().toLowerCase();
    const fSupplier = $('filterSkuSupplier').value.trim().toLowerCase();
    const fTag = $('filterSkuTagBind').value.trim().toLowerCase();
    const fDate = $('filterSkuDate').value.trim().toLowerCase();

    const rangeMode = $('filterSkuDateRange').value;
    const tagBindMode = $('filterSkuTagBindSelect').value;

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    return state.skus.filter(s => {
      const mSku = !fSkuNo || (s.skuNo || '').toLowerCase().includes(fSkuNo);
      const mLabel = !fLabel || (s.itemLabel || '').toLowerCase().includes(fLabel);
      const mDesc = !fDesc || (s.description || '').toLowerCase().includes(fDesc);
      const mSupplier = !fSupplier || (s.supplierCustomer || '').toLowerCase().includes(fSupplier);
      const mTag = !fTag || (s.tagBind || '').toLowerCase().includes(fTag);
      const mDate = !fDate || (s.dateAdded || '').toLowerCase().includes(fDate);

      let mTagBindSelect = true;
      if (tagBindMode === 'BOUND') mTagBindSelect = !!s.tagBind;
      else if (tagBindMode === 'UNBOUND') mTagBindSelect = !s.tagBind;

      let mDateRange = true;
      if (s.dateAdded && rangeMode !== 'ALL') {
        const d = new Date(s.dateAdded);
        const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
        if (rangeMode === 'TODAY') mDateRange = (s.dateAdded === todayStr);
        else if (rangeMode === 'WEEK') mDateRange = (diffDays <= 7);
        else if (rangeMode === 'MONTH') mDateRange = (diffDays <= 30);
        else if (rangeMode === '30DAYS') mDateRange = (diffDays <= 30);
      }

      return mSku && mLabel && mDesc && mSupplier && mTag && mDate && mTagBindSelect && mDateRange;
    });
  }

  function updateSkuBatchBtnState(){
    const btn = $('batchDeleteSkusBtn');
    if (btn) btn.disabled = state.skuConfigLocked || state.selectedSkuNos.size === 0;
  }

  $('selectAllSkusCb').addEventListener('change', (e) => {
    const visibleSkus = getFilteredSkus();
    if (e.target.checked) visibleSkus.forEach(s => state.selectedSkuNos.add(s.skuNo));
    else visibleSkus.forEach(s => state.selectedSkuNos.delete(s.skuNo));
    renderSkuTable();
  });

  $('batchDeleteSkusBtn').addEventListener('click', () => {
    if (state.skuConfigLocked) return;
    const count = state.selectedSkuNos.size;
    if (count === 0) return;

    confirmDialog("Batch Delete SKUs", `Are you sure you want to delete ${count} selected SKU item(s)?`, () => {
      state.skus = state.skus.filter(s => !state.selectedSkuNos.has(s.skuNo));
      state.selectedSkuNos.clear();
      saveSkusToStorage();
      renderSkuTable();
    });
  });

  function renderSkuTable(){
    const tbody = $('skuTableBody');
    const filtered = getFilteredSkus();

    updateSkuBatchBtnState();

    if (!filtered.length){
      tbody.innerHTML = '<tr class="empty-row"><td colspan="9">No matching SKU items found.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(s => {
      const isSelected = state.selectedSkuNos.has(s.skuNo);
      const imgMarkup = s.productImage 
        ? `<img src="${escapeHtml(s.productImage)}" class="sku-thumb-btn" data-view-sku="${escapeHtml(s.skuNo)}" style="width:36px; height:36px; object-fit:cover; border-radius:4px; border:1px solid var(--line); cursor:pointer;" title="Click to view full size">`
        : `<div class="sku-thumb-btn" data-view-sku="${escapeHtml(s.skuNo)}" style="width:36px; height:36px; background:#0E1316; border:1px solid var(--line); border-radius:4px; display:flex; align-items:center; justify-content:center; color:var(--text-faint); font-size:9px; cursor:pointer;" title="Click to view details">No img</div>`;

      return `
        <tr data-sku-row="${escapeHtml(s.skuNo)}">
          <td style="text-align:center;"><input type="checkbox" class="sku-select-cb" data-skuno="${escapeHtml(s.skuNo)}" ${isSelected ? 'checked' : ''}></td>
          <td>${imgMarkup}</td>
          <td style="font-weight:700; color:var(--cyan);">${escapeHtml(s.skuNo)}</td>
          <td style="font-weight:600; color:var(--text);">${escapeHtml(s.itemLabel)}</td>
          <td style="color:var(--text-dim); line-height:1.4;">${s.description ? escapeHtml(s.description) : '—'}</td>
          <td style="color:var(--text-dim);">${s.supplierCustomer ? escapeHtml(s.supplierCustomer) : '—'}</td>
          <td style="font-weight:600; color:var(--amber);">${s.tagBind ? escapeHtml(s.tagBind) : '—'}</td>
          <td style="color:var(--text-faint); font-size:11px;">${escapeHtml(s.dateAdded)}</td>
          <td style="text-align:right; white-space:nowrap;">
            <button class="btn-sm btn-view-more" data-view-sku="${escapeHtml(s.skuNo)}" type="button" title="View Full Details">View More</button>
            ${!state.skuConfigLocked ? `
              <button class="btn-sm btn-ghost" data-edit-sku="${escapeHtml(s.skuNo)}" type="button">Edit</button>
              <button class="btn-sm btn-ghost" data-delete-sku="${escapeHtml(s.skuNo)}" type="button" style="color:var(--red);">Delete</button>
            ` : ''}
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.sku-select-cb').forEach(cb => {
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        const skuNo = e.target.dataset.skuno;
        if (e.target.checked) state.selectedSkuNos.add(skuNo);
        else state.selectedSkuNos.delete(skuNo);
        updateSkuBatchBtnState();
      });
    });

    tbody.querySelectorAll('[data-view-sku]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openSkuDetailModal(btn.dataset.viewSku);
      });
    });

    tbody.querySelectorAll('tr[data-sku-row]').forEach(tr => {
      tr.addEventListener('click', (e) => {
        if (window.innerWidth <= 768) {
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
          openSkuDetailModal(tr.dataset.skuRow);
        }
      });
    });

    tbody.querySelectorAll('[data-edit-sku]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.skuConfigLocked) return;
        const skuNo = btn.dataset.editSku;
        const sku = state.skus.find(s => s.skuNo === skuNo);
        if (sku) toggleSkuForm(true, sku);
      });
    });

    tbody.querySelectorAll('[data-delete-sku]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.skuConfigLocked) return;
        const skuNo = btn.dataset.deleteSku;
        confirmDialog("Delete SKU Item", `Are you sure you want to delete SKU Item: ${skuNo}?`, () => {
          state.skus = state.skus.filter(s => s.skuNo !== skuNo);
          state.selectedSkuNos.delete(skuNo);
          saveSkusToStorage();
          renderSkuTable();
        });
      });
    });
  }

  // ---------------- INVENTORY LOGIC ----------------
  async function loadInventoryData() {
    try {
      const res = await fetch('/api/inventory');
      if (res.ok) {
        state.inventory = await res.json();
        renderInventoryTable();
      }
    } catch(e) {
      console.error("Error loading inventory:", e);
    }
  }

  // Column Sort Event Handler for Inventory Table
  document.querySelectorAll('[data-inv-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.invSort;
      if (state.invSortCol === col) {
        state.invSortDir = state.invSortDir === 'ASC' ? 'DESC' : 'ASC';
      } else {
        state.invSortCol = col;
        state.invSortDir = 'ASC';
      }
      renderInventoryTable();
    });
  });

  // Export Inventory to Excel
  $('exportInventoryExcelBtn')?.addEventListener('click', () => {
    const formatted = state.inventory.map(item => ({
      "SKU No": item.skuNo,
      "Item Label": item.itemLabel,
      "Description": item.description,
      "Supplier / Customer": item.supplierCustomer,
      "Current Stock (pcs)": item.stock,
      "Last Updated": item.lastUpdated
    }));
    exportDataToExcel(formatted, "Inventory_Stock_Export");
  });

  // Batch Modify Stock Toolbar Event Listeners
  $('btnToggleBatchModifyStock')?.addEventListener('click', () => {
    state.isBatchEditingStock = true;
    state.batchAdjustments = {};
    updateBatchInventoryToolbarUI();
    renderInventoryTable();
  });

  $('btnCancelBatchModifyStock')?.addEventListener('click', () => {
    state.isBatchEditingStock = false;
    state.batchAdjustments = {};
    updateBatchInventoryToolbarUI();
    renderInventoryTable();
  });

  function updateBatchInventoryToolbarUI() {
    const btnToggle = $('btnToggleBatchModifyStock');
    const btnConfirm = $('btnConfirmBatchModifyStock');
    const btnCancel = $('btnCancelBatchModifyStock');

    if (state.isBatchEditingStock) {
      if (btnToggle) btnToggle.style.display = 'none';
      if (btnConfirm) btnConfirm.style.display = '';
      if (btnCancel) btnCancel.style.display = '';
    } else {
      if (btnToggle) btnToggle.style.display = '';
      if (btnConfirm) btnConfirm.style.display = 'none';
      if (btnCancel) btnCancel.style.display = 'none';
    }
  }

  $('btnConfirmBatchModifyStock')?.addEventListener('click', () => {
    const itemsToAdjust = Object.entries(state.batchAdjustments)
      .map(([skuNo, quantityDelta]) => ({ skuNo, quantityDelta: parseInt(quantityDelta, 10) || 0 }))
      .filter(i => i.quantityDelta !== 0);

    if (itemsToAdjust.length === 0) {
      alert("No stock changes were made.");
      state.isBatchEditingStock = false;
      updateBatchInventoryToolbarUI();
      renderInventoryTable();
      return;
    }

    confirmDialog(
      "Confirm Batch Stock Modification",
      `Are you sure you want to modify stock for ${itemsToAdjust.length} item(s)?`,
      async () => {
        try {
          const res = await fetch('/api/inventory/batch-adjust', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: itemsToAdjust })
          });

          const contentType = res.headers.get("content-type");
          if (!contentType || !contentType.includes("application/json")) {
            throw new Error(`Server returned status ${res.status} (non-JSON). Ensure server.js is restarted.`);
          }

          const result = await res.json();

          if (res.ok) {
            state.isBatchEditingStock = false;
            state.batchAdjustments = {};
            updateBatchInventoryToolbarUI();
            await loadInventoryData();
            await loadTransactionsData();
            alert(`Batch stock update complete! Logged under Order No: ${result.orderNo}, PickList No: ${result.picklistNo}`);
          } else {
            alert("Failed batch modification: " + (result.error || "Server error"));
          }
        } catch(e) {
          alert("Error submitting batch modification: " + e.message);
        }
      }
    );
  });

  function renderInventoryTable() {
    const tbody = $('inventoryTableBody');
    if (!tbody) return;

    // Update Header Sort Indicators
    document.querySelectorAll('[data-inv-sort]').forEach(th => {
      const col = th.dataset.invSort;
      const ind = th.querySelector('.sort-indicator');
      if (ind) {
        if (state.invSortCol === col) ind.textContent = state.invSortDir === 'ASC' ? '▲' : '▼';
        else ind.textContent = '';
      }
    });

    const search = ($('searchInventory')?.value || '').trim().toLowerCase();

    let filtered = state.inventory.filter(item => {
      if (!search) return true;
      const sku = (item.skuNo || '').toLowerCase();
      const label = (item.itemLabel || '').toLowerCase();
      return sku.includes(search) || label.includes(search);
    });

    // Sorting Logic
    filtered.sort((a, b) => {
      let valA = a[state.invSortCol] ?? '';
      let valB = b[state.invSortCol] ?? '';
      if (typeof valA === 'number' && typeof valB === 'number') {
        return state.invSortDir === 'ASC' ? valA - valB : valB - valA;
      }
      const cmp = String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' });
      return state.invSortDir === 'ASC' ? cmp : -cmp;
    });

    if (!filtered.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No matching inventory items found.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(item => {
      const imgMarkup = item.productImage 
        ? `<img src="${escapeHtml(item.productImage)}" class="sku-thumb-btn" data-view-sku="${escapeHtml(item.skuNo)}" style="width:36px; height:36px; object-fit:cover; border-radius:4px; border:1px solid var(--line); cursor:pointer;">`
        : `<div class="sku-thumb-btn" data-view-sku="${escapeHtml(item.skuNo)}" style="width:36px; height:36px; background:#0E1316; border:1px solid var(--line); border-radius:4px; display:flex; align-items:center; justify-content:center; color:var(--text-faint); font-size:9px; cursor:pointer;">No img</div>`;

      const currentStock = item.stock;
      const stockIsNegativeOrZero = currentStock <= 0;
      const currentStockClass = stockIsNegativeOrZero ? 'stock-qty-badge bad-stock' : 'stock-qty-badge';

      let stockDisplayCell = '';

      if (state.isBatchEditingStock) {
        const currentDelta = state.batchAdjustments[item.skuNo] !== undefined ? state.batchAdjustments[item.skuNo] : 0;
        const newTotal = currentStock + currentDelta;
        const newTotalIsBad = newTotal <= 0;

        stockDisplayCell = `
          <div style="display:flex; flex-direction:column; align-items:center; gap:4px;">
            <div style="font-size:11px; color:var(--text-dim);">Current: <span class="${currentStockClass}">${currentStock} pcs</span></div>
            <div style="display:flex; align-items:center; justify-content:center; gap:4px;">
              <button class="btn-sm btn-ghost batch-btn-minus" data-skuno="${escapeHtml(item.skuNo)}" type="button" style="padding:2px 8px; font-weight:bold; font-size:13px;">-</button>
              <input type="number" class="batch-adj-input" data-skuno="${escapeHtml(item.skuNo)}" value="${currentDelta}" style="width:60px; text-align:center; padding:3px 4px; font-size:11.5px;">
              <button class="btn-sm btn-ghost batch-btn-plus" data-skuno="${escapeHtml(item.skuNo)}" type="button" style="padding:2px 8px; font-weight:bold; font-size:13px;">+</button>
            </div>
            <div style="font-size:11px; font-weight:700; color:${newTotalIsBad ? 'var(--red)' : 'var(--green)'};">
              Target: ${newTotal} pcs
            </div>
          </div>
        `;
      } else {
        stockDisplayCell = `<span class="${currentStockClass}" style="font-size:12px; padding:4px 8px;">${currentStock} pcs</span>`;
      }

      return `
        <tr data-inv-row="${escapeHtml(item.skuNo)}">
          <td>${imgMarkup}</td>
          <td style="font-weight:700; color:var(--cyan);">${escapeHtml(item.skuNo)}</td>
          <td style="font-weight:600; color:var(--text);">${escapeHtml(item.itemLabel)}</td>
          <td style="color:var(--text-dim); line-height:1.4;">${item.description ? escapeHtml(item.description) : '—'}</td>
          <td style="color:var(--text-dim);">${item.supplierCustomer ? escapeHtml(item.supplierCustomer) : '—'}</td>
          <td style="text-align:center;">${stockDisplayCell}</td>
          <td style="text-align:right; white-space:nowrap;">
            <button class="btn-sm btn-view-more" data-view-sku="${escapeHtml(item.skuNo)}" type="button">View More</button>
            ${!state.isBatchEditingStock ? `<button class="btn-sm btn-primary" data-edit-stock="${escapeHtml(item.skuNo)}" type="button">Edit Stock</button>` : ''}
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('[data-view-sku]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openSkuDetailModal(btn.dataset.viewSku);
      });
    });

    tbody.querySelectorAll('tr[data-inv-row]').forEach(tr => {
      tr.addEventListener('click', (e) => {
        if (window.innerWidth <= 768) {
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
          openSkuDetailModal(tr.dataset.invRow);
        }
      });
    });

    tbody.querySelectorAll('[data-edit-stock]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditStockModal(btn.dataset.editStock);
      });
    });

    if (state.isBatchEditingStock) {
      tbody.querySelectorAll('.batch-btn-minus').forEach(btn => {
        btn.addEventListener('click', () => {
          const skuNo = btn.dataset.skuno;
          const prevVal = state.batchAdjustments[skuNo] !== undefined ? state.batchAdjustments[skuNo] : 0;
          state.batchAdjustments[skuNo] = prevVal - 1;
          renderInventoryTable();
        });
      });

      tbody.querySelectorAll('.batch-btn-plus').forEach(btn => {
        btn.addEventListener('click', () => {
          const skuNo = btn.dataset.skuno;
          const prevVal = state.batchAdjustments[skuNo] !== undefined ? state.batchAdjustments[skuNo] : 0;
          state.batchAdjustments[skuNo] = prevVal + 1;
          renderInventoryTable();
        });
      });

      tbody.querySelectorAll('.batch-adj-input').forEach(input => {
        input.addEventListener('input', (e) => {
          const skuNo = input.dataset.skuno;
          const val = parseInt(e.target.value, 10);
          state.batchAdjustments[skuNo] = isNaN(val) ? 0 : val;
          renderInventoryTable();
        });
      });
    }
  }

  $('searchInventory')?.addEventListener('input', renderInventoryTable);

  function updateSingleStockModalPreview() {
    if (!currentEditingStockSku) return;
    const curr = currentEditingStockSku.stock || 0;
    const delta = parseInt($('stockQtyInput').value, 10) || 0;
    const proj = curr + delta;
    const projEl = $('editStockProjectedQty');
    projEl.textContent = proj;
    if (proj <= 0) {
      projEl.style.color = 'var(--red)';
    } else {
      projEl.style.color = 'var(--green)';
    }
  }

  $('btnStockQtyMinus')?.addEventListener('click', () => {
    const val = parseInt($('stockQtyInput').value, 10) || 0;
    $('stockQtyInput').value = val - 1;
    updateSingleStockModalPreview();
  });

  $('btnStockQtyPlus')?.addEventListener('click', () => {
    const val = parseInt($('stockQtyInput').value, 10) || 0;
    $('stockQtyInput').value = val + 1;
    updateSingleStockModalPreview();
  });

  $('stockQtyInput')?.addEventListener('input', updateSingleStockModalPreview);

  function openEditStockModal(skuNo) {
    const item = state.inventory.find(i => i.skuNo === skuNo);
    if (!item) return;

    currentEditingStockSku = item;
    $('editStockSkuNo').textContent = item.skuNo;
    $('editStockLabel').textContent = item.itemLabel;
    
    const currQtyEl = $('editStockCurrentQty');
    currQtyEl.textContent = item.stock;
    if (item.stock <= 0) {
      currQtyEl.style.color = 'var(--red)';
    } else {
      currQtyEl.style.color = 'var(--green)';
    }

    $('stockQtyInput').value = 0;

    const imgBox = $('editStockImgBox');
    if (item.productImage) {
      imgBox.innerHTML = `<img src="${escapeHtml(item.productImage)}" style="width:100%; height:100%; object-fit:cover;">`;
    } else {
      imgBox.innerHTML = `No img`;
    }

    updateSingleStockModalPreview();
    $('editStockModal').classList.add('active');
  }

  function closeEditStockModal() {
    $('editStockModal').classList.remove('active');
    currentEditingStockSku = null;
  }

  $('editStockModalCloseBtn')?.addEventListener('click', closeEditStockModal);
  $('editStockCancelBtn')?.addEventListener('click', closeEditStockModal);

  $('editStockConfirmBtn')?.addEventListener('click', () => {
    if (!currentEditingStockSku) return;

    const delta = parseInt($('stockQtyInput').value, 10);
    if (isNaN(delta) || delta === 0) {
      alert("Please enter a non-zero adjustment quantity.");
      return;
    }

    const actionWord = delta > 0 ? `add ${delta}` : `subtract ${Math.abs(delta)}`;

    confirmDialog(
      "Confirm Stock Adjustment",
      `Are you sure you want to ${actionWord} unit(s) for SKU: ${currentEditingStockSku.skuNo}?`,
      async () => {
        try {
          const res = await fetch('/api/inventory/adjust', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skuNo: currentEditingStockSku.skuNo, quantityDelta: delta })
          });

          if (res.ok) {
            const result = await res.json();
            closeEditStockModal();
            await loadInventoryData();
            await loadTransactionsData();
            alert(`Stock updated! Logged transaction under Order No: ${result.orderNo}, PickList No: ${result.picklistNo}`);
          } else {
            const err = await res.json();
            alert("Failed to adjust stock: " + (err.error || "Server error"));
          }
        } catch(e) {
          alert("Error submitting stock adjustment: " + e.message);
        }
      }
    );
  });

  // ---------------- STOCK TRANSACTION HISTORY LOGIC ----------------
  async function loadTransactionsData() {
    try {
      const res = await fetch('/api/transactions');
      if (res.ok) {
        state.transactions = await res.json();
        renderTransactionsTable();
      }
    } catch(e) {
      console.error("Error loading transactions:", e);
    }
  }

  // Column Sort Event Handler for Transactions Table
  document.querySelectorAll('[data-tx-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.txSort;
      state.txClusterPicklist = false;
      $('btnClusterPicklist').className = 'btn-sm btn-ghost';

      if (state.txSortCol === col) {
        state.txSortDir = state.txSortDir === 'ASC' ? 'DESC' : 'ASC';
      } else {
        state.txSortCol = col;
        state.txSortDir = 'ASC';
      }
      renderTransactionsTable();
    });
  });

  // Cluster by PickList button
  $('btnClusterPicklist')?.addEventListener('click', () => {
    state.txClusterPicklist = !state.txClusterPicklist;
    const btn = $('btnClusterPicklist');
    if (state.txClusterPicklist) {
      btn.className = 'btn-sm btn-accent';
      state.txSortCol = 'picklistNo';
      state.txSortDir = 'ASC';
    } else {
      btn.className = 'btn-sm btn-ghost';
      state.txSortCol = 'timestamp';
      state.txSortDir = 'DESC';
    }
    renderTransactionsTable();
  });

  // Export Stock Transactions to Excel
  $('exportTransactionsExcelBtn')?.addEventListener('click', () => {
    const formatted = state.transactions.map(tx => ({
      "Timestamp": tx.timestamp,
      "Order No": tx.orderNo,
      "PickList No": tx.picklistNo,
      "SKU Number": tx.skuNo,
      "Item Label": tx.itemLabel,
      "Description": tx.description,
      "Supplier / Customer": tx.supplierCustomer,
      "Quantity": tx.quantity
    }));
    exportDataToExcel(formatted, "Stock_Transactions_History");
  });

  function renderTransactionsTable() {
    const tbody = $('transactionsTableBody');
    if (!tbody) return;

    // Update Header Sort Indicators
    document.querySelectorAll('[data-tx-sort]').forEach(th => {
      const col = th.dataset.txSort;
      const ind = th.querySelector('.sort-indicator');
      if (ind) {
        if (state.txSortCol === col) ind.textContent = state.txSortDir === 'ASC' ? '▲' : '▼';
        else ind.textContent = '';
      }
    });

    const search = ($('searchTransactions')?.value || '').trim().toLowerCase();
    const rangeMode = $('filterTxDateRange')?.value || 'ALL';

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    let filtered = state.transactions.filter(tx => {
      let matchesSearch = true;
      if (search) {
        const order = (tx.orderNo || '').toLowerCase();
        const pick = (tx.picklistNo || '').toLowerCase();
        const sku = (tx.skuNo || '').toLowerCase();
        const label = (tx.itemLabel || '').toLowerCase();
        matchesSearch = order.includes(search) || pick.includes(search) || sku.includes(search) || label.includes(search);
      }

      let matchesDate = true;
      if (tx.timestamp && rangeMode !== 'ALL') {
        const txDate = new Date(tx.timestamp);
        const diffDays = Math.floor((now - txDate) / (1000 * 60 * 60 * 24));
        if (rangeMode === 'TODAY') matchesDate = tx.timestamp.startsWith(todayStr);
        else if (rangeMode === 'WEEK') matchesDate = (diffDays <= 7);
        else if (rangeMode === 'MONTH') matchesDate = (diffDays <= 30);
        else if (rangeMode === '30DAYS') matchesDate = (diffDays <= 30);
      }

      return matchesSearch && matchesDate;
    });

    // Sort or Cluster by PickList
    filtered.sort((a, b) => {
      if (state.txClusterPicklist) {
        const pCmp = (a.picklistNo || '').localeCompare(b.picklistNo || '', undefined, { numeric: true });
        if (pCmp !== 0) return pCmp;
        return (b.timestamp || '').localeCompare(a.timestamp || '');
      }

      let valA = a[state.txSortCol] ?? '';
      let valB = b[state.txSortCol] ?? '';
      if (typeof valA === 'number' && typeof valB === 'number') {
        return state.txSortDir === 'ASC' ? valA - valB : valB - valA;
      }
      const cmp = String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' });
      return state.txSortDir === 'ASC' ? cmp : -cmp;
    });

    if (!filtered.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="8">No matching transaction logs found.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(tx => {
      const isAdd = tx.quantity > 0;
      const qtyFormatted = isAdd ? `+${tx.quantity}` : `${tx.quantity}`;
      const qtyClass = isAdd ? 'add' : 'sub';

      const imgMarkup = tx.productImage 
        ? `<img src="${escapeHtml(tx.productImage)}" class="sku-thumb-btn" data-view-sku="${escapeHtml(tx.skuNo)}" style="width:32px; height:32px; object-fit:cover; border-radius:4px; border:1px solid var(--line); cursor:pointer;">`
        : `<div class="sku-thumb-btn" data-view-sku="${escapeHtml(tx.skuNo)}" style="width:32px; height:32px; background:#0E1316; border:1px solid var(--line); border-radius:4px; display:flex; align-items:center; justify-content:center; color:var(--text-faint); font-size:8.5px; cursor:pointer;">No img</div>`;

      // 2-Line Compressed Timestamp for Mobile
      const [txDate, txTime] = (tx.timestamp || '').split(' ');
      const timestampMarkup = txTime 
        ? `<div class="tx-timestamp"><span>${escapeHtml(txDate)}</span><span style="color:var(--text-faint); font-size:10px;">${escapeHtml(txTime)}</span></div>`
        : escapeHtml(tx.timestamp);

      return `
        <tr>
          <td style="color:var(--text-faint); font-size:11px;">${timestampMarkup}</td>
          <td style="font-weight:700; color:var(--amber);">
            <div>${escapeHtml(tx.orderNo)}</div>
            <div class="mobile-stacked-pkl">${escapeHtml(tx.picklistNo)}</div>
          </td>
          <td style="font-weight:600; color:var(--cyan-dim);">${escapeHtml(tx.picklistNo)}</td>
          <td>${imgMarkup}</td>
          <td style="font-weight:700; color:var(--cyan);">${escapeHtml(tx.skuNo)}</td>
          <td style="font-weight:600; color:var(--text);">${escapeHtml(tx.itemLabel)}</td>
          <td style="color:var(--text-dim); line-height:1.4;">${tx.description ? escapeHtml(tx.description) : '—'}</td>
          <td style="text-align:right;">
            <span class="qty-pill ${qtyClass}">${qtyFormatted} pcs</span>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('[data-view-sku]').forEach(btn => {
      btn.addEventListener('click', () => openSkuDetailModal(btn.dataset.viewSku));
    });
  }

  $('searchTransactions')?.addEventListener('input', renderTransactionsTable);
  $('filterTxDateRange')?.addEventListener('change', renderTransactionsTable);

  // ---------------- WAREHOUSE STOCK ----------------
  // Does an Area/Shelf/Item tag match the Warehouse Stock search box?
  // Matches against: Tag Reference, Tag ID, and (if a SKU is bound to the tag) SKU No / Item Label.
  function stockTagMatchesSearch(tag, search) {
    if (!search) return true;
    const tagId = (tag.tagId || '').toLowerCase();
    const tagRef = (tag.tagRef || '').toLowerCase();
    if (tagId.includes(search) || tagRef.includes(search)) return true;
    const bound = state.skus.find(s => s.tagBind === tag.tagId);
    if (bound) {
      const skuNo = (bound.skuNo || '').toLowerCase();
      const itemLabel = (bound.itemLabel || '').toLowerCase();
      if (skuNo.includes(search) || itemLabel.includes(search)) return true;
    }
    return false;
  }

  function renderWarehouseStock(){
    const container = $('warehouseStockHierarchyList');
    const areaTags = state.tags.filter(t => t.tagType === 'AreaTag');
    const allShelves = state.tags.filter(t => t.tagType === 'ShelfTag');
    const allItems = state.tags.filter(t => t.tagType === 'ItemTag');

    if (!areaTags.length){
      container.innerHTML = '<div class="empty-strip-hint">No Area Tags created yet.</div>';
      return;
    }

    const search = ($('searchWarehouseStock')?.value || '').trim().toLowerCase();

    const renderedAreas = areaTags.map(area => {
      const assignedShelves = allShelves.filter(s => s.parentTag === area.tagId);
      const areaSelfMatches = stockTagMatchesSearch(area, search);

      // While searching, only keep shelves that themselves match, or that contain a matching item
      let visibleShelves = assignedShelves;
      if (search) {
        visibleShelves = assignedShelves.filter(shelf => {
          const items = allItems.filter(i => i.parentTag === shelf.tagId);
          return stockTagMatchesSearch(shelf, search) || items.some(i => stockTagMatchesSearch(i, search));
        });
        if (!areaSelfMatches && !visibleShelves.length) return '';
      }

      // Force-expand matching areas/shelves while a search is active; otherwise respect saved collapse state
      const isAreaCollapsed = !search && state.stockCollapsedAreas.has(area.uid);
      const areaTitle = area.tagRef ? `${escapeHtml(area.tagRef)} <span class="tag-ref">(${escapeHtml(area.tagId)})</span>` : escapeHtml(area.tagId);

      return `
        <div class="wh-area-card" data-area-uid="${area.uid}">
          <div class="wh-area-header">
            <div class="wh-area-title" data-toggle-stock-area="${area.uid}" style="cursor:pointer; user-select:none;">
              <span style="display:inline-flex; align-items:center; justify-content:center; width:18px; font-size:11px; font-weight:700; color:var(--cyan);">${isAreaCollapsed ? '▶' : '▼'}</span>
              ${renderTagIcon('AreaTag')}
              <span>${areaTitle}</span>
            </div>
            <div class="wh-action-btns">
              <button class="btn-sm btn-accent" data-activate="${area.uid}">Activate Area</button>
              <button class="btn-sm btn-primary" data-test="${area.uid}">Test</button>
              <button class="btn-sm btn-danger" data-stop="${area.uid}">Stop</button>
            </div>
          </div>

          ${isAreaCollapsed ? '' : `
          <div class="wh-shelf-list">
            ${!visibleShelves.length ? `<div class="hint" style="font-style:italic;">${search ? 'No matching Shelf Tags or Items in this Area.' : 'No Shelf Tags attached to this Area.'}</div>` : ''}
            ${visibleShelves.map(shelf => {
              const shelfSelfMatches = stockTagMatchesSearch(shelf, search);
              let assignedItems = allItems.filter(i => i.parentTag === shelf.tagId);
              if (search && !shelfSelfMatches) assignedItems = assignedItems.filter(i => stockTagMatchesSearch(i, search));

              const shelfMainLabel = shelf.tagRef ? escapeHtml(shelf.tagRef) : escapeHtml(shelf.tagId);
              const boundSkuForShelf = state.skus.find(s => s.tagBind === shelf.tagId);
              const shelfInv = state.inventory.find(i => i.skuNo === (boundSkuForShelf ? boundSkuForShelf.skuNo : ''));
              const shelfStock = shelfInv ? shelfInv.stock : 0;
              const shelfStockIsBad = shelfStock <= 0;
              const isShelfCollapsed = !search && state.stockCollapsedShelves.has(shelf.uid);

              return `
                <div class="wh-shelf-row">
                  <div class="wh-box-card wh-shelf-box">
                    <div>
                      <div class="wh-box-head" data-toggle-stock-shelf="${shelf.uid}" style="margin-bottom:6px; cursor:pointer; user-select:none;">
                        <span class="wh-shelf-badge">SHELF</span>
                        <span style="font-size:11px; font-weight:700; color:var(--cyan);">${isShelfCollapsed ? '▶' : '▼'}</span>
                      </div>
                      <div class="wh-tag-label">
                        ${renderTagIcon('ShelfTag')}
                        <span class="wh-box-tagid">${shelfMainLabel}</span>
                      </div>
                      ${boundSkuForShelf ? `
                        <div class="stock-sku-label" style="margin-top:4px;">${escapeHtml(boundSkuForShelf.itemLabel)}</div>
                        <div style="font-size:10px; color:var(--text-faint);">${escapeHtml(boundSkuForShelf.skuNo)}</div>
                      ` : ''}
                    </div>

                    <div style="margin:4px 0;">
                      <div class="stock-qty-badge ${shelfStockIsBad ? 'bad-stock' : ''}">Qty: ${shelfStock} pcs</div>
                    </div>

                    <div class="wh-box-actions">
                      <button class="btn-sm btn-accent" data-activate="${shelf.uid}">Act</button>
                      <button class="btn-sm btn-primary" data-test="${shelf.uid}">Test</button>
                      <button class="btn-sm btn-danger" data-stop="${shelf.uid}">Stop</button>
                    </div>
                  </div>

                  <div class="wh-shelf-divider"></div>

                  ${isShelfCollapsed ? '' : `
                  <div class="wh-items-horizontal">
                    ${!assignedItems.length ? `<div class="hint" style="font-style:italic; padding:6px 2px;">${search ? 'No matching Items on this Shelf.' : 'No Item Tags attached.'}</div>` : ''}
                    ${assignedItems.map(item => {
                      const itemMainLabel = item.tagRef ? escapeHtml(item.tagRef) : escapeHtml(item.tagId);
                      const boundSku = state.skus.find(s => s.tagBind === item.tagId);
                      const itemInv = state.inventory.find(i => i.skuNo === (boundSku ? boundSku.skuNo : ''));
                      const itemStock = itemInv ? itemInv.stock : 0;
                      const itemStockIsBad = itemStock <= 0;

                      return `
                        <div class="wh-box-card">
                          <div class="wh-box-head">
                            <div class="wh-tag-label">
                              ${renderTagIcon('ItemTag')}
                              <span class="wh-box-tagid">${itemMainLabel}</span>
                            </div>
                          </div>

                          ${boundSku ? `
                            <div style="display:flex; flex-direction:column; gap:2px; margin-top:2px;">
                              <div class="stock-sku-label">${escapeHtml(boundSku.itemLabel)}</div>
                              <div style="font-size:9.5px; color:var(--text-faint);">${escapeHtml(boundSku.skuNo)}</div>
                            </div>
                            <div class="wh-img-placeholder" data-view-sku="${escapeHtml(boundSku.skuNo)}" title="Click to view large picture">
                              ${boundSku.productImage ? `<img src="${escapeHtml(boundSku.productImage)}">` : `<span>No Image</span>`}
                            </div>
                          ` : `
                            <div style="font-size:10px; color:var(--amber); font-style:italic;">No SKU Bound</div>
                            <div class="wh-img-placeholder"><span>No Image</span></div>
                          `}

                          <div class="stock-qty-badge ${itemStockIsBad ? 'bad-stock' : ''}">Qty: ${itemStock} pcs</div>

                          <div class="wh-box-actions">
                            <button class="btn-sm btn-accent" data-activate="${item.uid}">Act</button>
                            <button class="btn-sm btn-primary" data-test="${item.uid}">Test</button>
                            <button class="btn-sm btn-danger" data-stop="${item.uid}">Stop</button>
                          </div>
                        </div>
                      `;
                    }).join('')}
                  </div>
                  `}

                </div>
              `;
            }).join('')}
          </div>
          `}
        </div>
      `;
    }).filter(Boolean);

    if (search && !renderedAreas.length) {
      container.innerHTML = '<div class="empty-strip-hint">No matching Tag Reference, Tag ID, SKU No, or Item Label found.</div>';
      return;
    }

    container.innerHTML = renderedAreas.join('');

    container.querySelectorAll('[data-toggle-stock-area]').forEach(el => {
      el.addEventListener('click', () => {
        const uid = el.dataset.toggleStockArea;
        if (state.stockCollapsedAreas.has(uid)) state.stockCollapsedAreas.delete(uid);
        else state.stockCollapsedAreas.add(uid);
        renderWarehouseStock();
      });
    });

    container.querySelectorAll('[data-toggle-stock-shelf]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = el.dataset.toggleStockShelf;
        if (state.stockCollapsedShelves.has(uid)) state.stockCollapsedShelves.delete(uid);
        else state.stockCollapsedShelves.add(uid);
        renderWarehouseStock();
      });
    });

    container.querySelectorAll('[data-view-sku]').forEach(box => {
      box.addEventListener('click', (e) => {
        e.stopPropagation();
        const skuNo = box.dataset.viewSku;
        if (skuNo) openSkuDetailModal(skuNo);
      });
    });

    container.querySelectorAll('[data-activate]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); publishTagActivate(btn.dataset.activate); });
    });
    container.querySelectorAll('[data-test]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); publishTagTest(btn.dataset.test); });
    });
    container.querySelectorAll('[data-stop]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); publishTagStop(btn.dataset.stop); });
    });
  }

  $('searchWarehouseStock')?.addEventListener('input', renderWarehouseStock);

  // ================================================================
  // ---------------- PICKLIST / PUTAWAY LIST ENGINE ----------------
  // ================================================================

  // Persistence
  async function savePicklistsToStorage(){
    try {
      await fetch('/api/picklists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.picklists)
      });
    } catch(e){}
  }

  async function loadPicklistsFromStorage(){
    try {
      const res = await fetch('/api/picklists');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) state.picklists = data;
      }
    } catch(e){}
    // Re-lock any colors still assigned to lists that were left ACTIVE across a reload
    state.picklists.forEach(l => {
      if (l.status === 'ACTIVE' && l.color) colorLocks[l.color] = 'inuse';
    });
  }

  // ---------------- Indicator Color Allocation (no duplicate colors among active lists, 30s min reuse cooldown) ----------------
  const LIST_COLOR_POOL = [1, 2, 3, 4, 5, 6, 7]; // RGB bit combos, 0 = off
  const LIST_COLOR_COOLDOWN_MS = 30000;
  const colorLocks = {}; // colorValue -> 'inuse' | freedAtTimestampMs

  function colorSwatchStyle(color){
    const r = (color & 4) ? 255 : 30, g = (color & 2) ? 255 : 30, b = (color & 1) ? 255 : 30;
    return `background: rgb(${r},${g},${b});`;
  }

  function allocateListColor(){
    const now = Date.now();
    const available = LIST_COLOR_POOL.filter(c => {
      const lock = colorLocks[c];
      if (!lock) return true;
      if (lock === 'inuse') return false;
      return (now - lock) >= LIST_COLOR_COOLDOWN_MS;
    });
    if (!available.length) return null;
    const chosen = available[Math.floor(Math.random() * available.length)];
    colorLocks[chosen] = 'inuse';
    return chosen;
  }

  function releaseListColor(color){
    if (color === undefined || color === null) return;
    colorLocks[color] = Date.now();
  }

  // ---------------- Location Lookup (Area/Shelf/Item chain for a bound Tag ID) ----------------
  function computeTagLocationLabel(tagBindId){
    if (!tagBindId) return '—';
    const tag = state.tags.find(t => t.tagId === tagBindId);
    if (!tag) return '—';
    const lbl = t => escapeHtml(t.tagRef ? t.tagRef : t.tagId);

    if (tag.tagType === 'ItemTag') {
      const shelf = state.tags.find(t => t.tagType === 'ShelfTag' && t.tagId === tag.parentTag);
      const area = shelf ? state.tags.find(t => t.tagType === 'AreaTag' && t.tagId === shelf.parentTag) : null;
      return [area, shelf, tag].filter(Boolean).map(lbl).join(' / ');
    } else if (tag.tagType === 'ShelfTag') {
      const area = state.tags.find(t => t.tagType === 'AreaTag' && t.tagId === tag.parentTag);
      return [area, tag].filter(Boolean).map(lbl).join(' / ');
    } else if (tag.tagType === 'AreaTag') {
      return lbl(tag);
    }
    return '—';
  }

  // ---------------- Create Picklist / Putaway Modal ----------------
  let clDraft = { type: 'PICKLIST', orderNo: '', listNo: '', items: [] };
  let clDirty = false;

  function updateClDirtyTracking(){
    clDirty = clDraft.items.length > 0 || (($('clOrderNo')?.value || '').trim() !== '');
  }

  function populateClSkuSelect(){
    const sel = $('clSkuSelect');
    if (!sel) return;
    const opts = ['<option value="">Select SKU...</option>'];
    state.skus.forEach(s => {
      opts.push(`<option value="${escapeHtml(s.skuNo)}">${escapeHtml(s.skuNo)} — ${escapeHtml(s.itemLabel || '')}</option>`);
    });
    sel.innerHTML = opts.join('');
  }

  function renderClItemPreview(){
    const box = $('clItemPreview');
    const skuNo = $('clSkuSelect')?.value;
    if (!box) return;
    if (!skuNo) { box.textContent = ''; return; }
    const sku = state.skus.find(s => s.skuNo === skuNo);
    if (!sku) { box.textContent = ''; return; }
    const loc = computeTagLocationLabel(sku.tagBind);
    box.innerHTML = `<span style="color:var(--text);">${escapeHtml(sku.itemLabel || '')}</span> — ${sku.description ? escapeHtml(sku.description) : 'No description'} <span style="color:var(--cyan-dim);">· Location: ${loc}</span>`;
  }

  $('clSkuSelect')?.addEventListener('change', renderClItemPreview);

  function renderClItemsTable(){
    const tbody = $('clItemsTableBody');
    if (!tbody) return;
    if (!clDraft.items.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No items added yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = clDraft.items.map((it, idx) => `
      <tr>
        <td style="font-weight:700; color:var(--cyan);">${escapeHtml(it.skuNo)}</td>
        <td style="font-weight:600;">${escapeHtml(it.itemLabel || '')}</td>
        <td style="color:var(--text-dim);">${it.description ? escapeHtml(it.description) : '—'}</td>
        <td style="color:var(--text-faint); font-size:10.5px;">${it.location}</td>
        <td style="text-align:center; font-weight:700;">${it.quantity}</td>
        <td style="text-align:center;"><button class="btn-sm btn-danger" data-cl-remove="${idx}" type="button" style="padding:2px 7px;">✕</button></td>
      </tr>
    `).join('');
    tbody.querySelectorAll('[data-cl-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        clDraft.items.splice(parseInt(btn.dataset.clRemove, 10), 1);
        renderClItemsTable();
        updateClDirtyTracking();
      });
    });
  }

  $('clQtyMinus')?.addEventListener('click', () => {
    const inp = $('clQtyInput');
    inp.value = Math.max(1, (parseInt(inp.value, 10) || 1) - 1);
  });
  $('clQtyPlus')?.addEventListener('click', () => {
    const inp = $('clQtyInput');
    inp.value = (parseInt(inp.value, 10) || 1) + 1;
  });

  $('clAddItemBtn')?.addEventListener('click', () => {
    const skuNo = $('clSkuSelect')?.value;
    const qty = Math.max(1, parseInt($('clQtyInput')?.value, 10) || 1);
    if (!skuNo) { alert('Select an item SKU to add.'); return; }
    const sku = state.skus.find(s => s.skuNo === skuNo);
    if (!sku) return;

    const existing = clDraft.items.find(i => i.skuNo === skuNo);
    if (existing) {
      existing.quantity += qty;
    } else {
      clDraft.items.push({
        skuNo: sku.skuNo,
        itemLabel: sku.itemLabel || '',
        description: sku.description || '',
        location: computeTagLocationLabel(sku.tagBind),
        tagBind: sku.tagBind || '',
        quantity: qty
      });
    }
    $('clQtyInput').value = 1;
    renderClItemsTable();
    updateClDirtyTracking();
  });

  async function openCreateListModal(type){
    clDraft = { type, orderNo: '', listNo: '', items: [] };
    clDirty = false;

    $('clModalTitle').textContent = type === 'PUTAWAY' ? 'Create Putaway List' : 'Create Picklist';
    $('clListNoLabel').textContent = type === 'PUTAWAY' ? 'Putaway No (GRN)' : 'Picklist Number';
    $('clOrderNo').value = '';
    $('clListNo').value = 'Loading…';
    $('clSkuSelect').value = '';
    $('clQtyInput').value = 1;
    $('clItemPreview').textContent = '';
    populateClSkuSelect();
    renderClItemsTable();

    $('createListModal').classList.add('active');

    try {
      const res = await fetch(`/api/running-numbers/next?listType=${type}`);
      if (res.ok) {
        const data = await res.json();
        clDraft.orderNo = data.orderNo;
        clDraft.listNo = data.listNo;
        $('clOrderNo').placeholder = `Auto: ${data.orderNo}`;
        $('clListNo').value = data.listNo;
      } else {
        $('clListNo').value = '(server error)';
      }
    } catch(e) {
      $('clListNo').value = '(offline)';
    }
  }

  function closeCreateListModalForce(){
    $('createListModal').classList.remove('active');
    clDirty = false;
  }

  function attemptCloseCreateListModal(){
    updateClDirtyTracking();
    if (clDirty) {
      confirmDialog('Confirm to Leave Menu?', 'You have unsaved Order Number or Item entries. Leaving now will discard them.', () => {
        closeCreateListModalForce();
      });
    } else {
      closeCreateListModalForce();
    }
  }

  $('btnOpenCreatePicklist')?.addEventListener('click', () => openCreateListModal('PICKLIST'));
  $('btnOpenCreatePutaway')?.addEventListener('click', () => openCreateListModal('PUTAWAY'));
  $('clCloseBtn')?.addEventListener('click', attemptCloseCreateListModal);
  $('clCancelBtn')?.addEventListener('click', attemptCloseCreateListModal);

  $('clOrderNo')?.addEventListener('input', updateClDirtyTracking);

  $('clSaveBtn')?.addEventListener('click', () => {
    if (!clDraft.items.length) { alert('Add at least one item before saving.'); return; }

    const orderNoOverride = ($('clOrderNo')?.value || '').trim();
    const newList = {
      uid: 'list_' + Date.now() + '_' + Math.random().toString(16).slice(2, 8),
      type: clDraft.type,
      orderNo: orderNoOverride || clDraft.orderNo,
      listNo: clDraft.listNo,
      status: 'PENDING',
      items: clDraft.items.map(i => ({ ...i })),
      color: null,
      createdAt: new Date().toISOString(),
      activatedAt: null,
      completedAt: null,
      tagIds: []
    };

    state.picklists.unshift(newList);
    savePicklistsToStorage();
    closeCreateListModalForce();
    renderPicklists();
  });

  // ---------------- Render Picklist / Putaway List Log ----------------
  function renderPicklists(){
    const container = $('listsContainer');
    if (!container) return;

    const btnCompletedToggle = $('btnToggleCompletedToday');

    // Update toggle button UI on Today subpage
    if (btnCompletedToggle) {
      if (state.homeSubtab === 'TODAY') {
        btnCompletedToggle.style.display = 'inline-block';
        if (state.showCompletedToday) {
          btnCompletedToggle.textContent = 'Hide Completed/Cancelled';
          btnCompletedToggle.className = 'btn-sm btn-accent';
        } else {
          btnCompletedToggle.textContent = 'Show Completed/Cancelled';
          btnCompletedToggle.className = 'btn-sm btn-ghost';
        }
      } else {
        // Hide button when viewing History subpage
        btnCompletedToggle.style.display = 'none';
      }
    }

    // Filter lists based on subpage (Today vs History)
    const todayStr = new Date().toISOString().slice(0, 10);
    let displayLists = state.picklists;

    if (state.homeSubtab === 'TODAY') {
      displayLists = state.picklists.filter(l => {
        const listDate = (l.createdAt || '').slice(0, 10);
        return listDate === todayStr;
      });

      // If toggle is OFF, only show Pending and Active tasks
      if (!state.showCompletedToday) {
        displayLists = displayLists.filter(l => l.status === 'PENDING' || l.status === 'ACTIVE');
      }
    } else if (state.homeSubtab === 'HISTORY') {
      if (state.historySelectedDate) {
        displayLists = state.picklists.filter(l => (l.createdAt || '').slice(0, 10) === state.historySelectedDate);
      } else {
        // Show all history (lists not created today)
        displayLists = state.picklists.filter(l => (l.createdAt || '').slice(0, 10) !== todayStr);
      }
    }

    if (!displayLists.length) {
      let msg = "";
      if (state.homeSubtab === 'TODAY') {
        msg = state.showCompletedToday 
          ? "No Picklists or Putaway Lists created today." 
          : "No active or pending tasks for today. Click 'Show Completed/Cancelled' to view finished tasks.";
      } else {
        msg = "No historical Picklists or Putaway Lists found for the selected date.";
      }
      container.innerHTML = `<div class="empty-strip-hint">${msg}</div>`;
      return;
    }
    container.innerHTML = displayLists.map(list => {
      const statusLower = list.status.toLowerCase();
      const totalQty = list.items.reduce((sum, i) => sum + (i.quantity || 0), 0);
      const isExpanded = !!list.__expanded;

      let actionsHtml = '';
      if (list.status === 'PENDING') {
        actionsHtml = `<button class="btn-sm btn-accent" data-list-activate="${list.uid}" type="button">Activate ${list.type === 'PUTAWAY' ? 'Putaway' : 'Picklist'}</button>`;
      } else if (list.status === 'ACTIVE') {
        actionsHtml = `
          <button class="btn-sm btn-primary" data-list-complete="${list.uid}" type="button">Completed</button>
          <button class="btn-sm btn-danger" data-list-cancel="${list.uid}" type="button">Cancelled</button>
        `;
      }

      return `
        <div class="list-card status-${statusLower}" data-list-uid="${list.uid}">
          <div class="list-card-head" data-list-toggle="${list.uid}">
            <span class="list-card-chevron">${isExpanded ? '▼' : '▶'}</span>
            <span class="list-type-badge ${list.type}">${list.type === 'PUTAWAY' ? 'Putaway' : 'Picklist'}</span>
            ${list.status === 'ACTIVE' && list.color ? `<span class="list-color-swatch" style="${colorSwatchStyle(list.color)}" title="Assigned indicator color"></span>` : ''}
            <div class="list-card-ids">
              <span class="listno">${escapeHtml(list.listNo)}</span>
              <span class="orderno">${escapeHtml(list.orderNo)}</span>
            </div>
            <span class="list-status-badge ${list.status}">${list.status}</span>
            <span class="hint" style="margin:0;">${list.items.length} SKU${list.items.length === 1 ? '' : 's'} · ${totalQty} pcs</span>
            <div class="list-card-actions">${actionsHtml}</div>
          </div>
          ${isExpanded ? `
          <div class="list-card-body">
            <!-- Timestamps Banner -->
            <div style="display:flex; flex-wrap:wrap; gap:16px; padding:6px 0 10px; border-bottom:1px solid var(--line-soft); font-size:11px; color:var(--text-dim); font-family:var(--mono);">
              <div><span style="color:var(--text-faint);">Date Added:</span> <strong style="color:var(--text);">${formatDateTime(list.createdAt)}</strong></div>
              ${list.activatedAt ? `<div><span style="color:var(--text-faint);">Activated:</span> <strong style="color:var(--amber);">${formatDateTime(list.activatedAt)}</strong></div>` : ''}
              <div><span style="color:var(--text-faint);">Completed/Cancelled:</span> <strong style="color:var(--cyan);">${formatDateTime(list.completedAt)}</strong></div>
            </div>
            ${list.items.map(it => `
              <div class="list-item-row">
                <div class="list-item-meta">
                  <span class="sku">${escapeHtml(it.skuNo)}</span>
                  <span class="loc">${it.location}</span>
                </div>
                <div class="list-item-meta">
                  <span class="label">${escapeHtml(it.itemLabel || '')}</span>
                  <span class="desc">${it.description ? escapeHtml(it.description) : '—'}</span>
                </div>
                <span class="list-item-qty">${it.quantity} pcs</span>
              </div>
            `).join('')}
          </div>
          ` : ''}
        </div>
      `;
    }).join('');

    container.querySelectorAll('[data-list-toggle]').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.list-card-actions')) return;
        const uid = el.dataset.listToggle;
        const list = state.picklists.find(l => l.uid === uid);
        if (list) list.__expanded = !list.__expanded;
        renderPicklists();
      });
    });

    container.querySelectorAll('[data-list-activate]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); activateList(btn.dataset.listActivate); });
    });
    container.querySelectorAll('[data-list-complete]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); finishList(btn.dataset.listComplete, true); });
    });
    container.querySelectorAll('[data-list-cancel]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); finishList(btn.dataset.listCancel, false); });
    });
  }

  // ---------------- Home Subpage & Export Listeners ----------------
  $('btnSubtabToday')?.addEventListener('click', () => {
    state.homeSubtab = 'TODAY';
    $('btnSubtabToday').className = 'btn-sm btn-accent';
    $('btnSubtabHistory').className = 'btn-sm btn-ghost';
    $('historyDateFilterWrap').style.display = 'none';
    renderPicklists();
  });

  $('btnToggleCompletedToday')?.addEventListener('click', () => {
    state.showCompletedToday = !state.showCompletedToday;
    renderPicklists();
  });

  $('btnSubtabHistory')?.addEventListener('click', () => {
    state.homeSubtab = 'HISTORY';
    $('btnSubtabToday').className = 'btn-sm btn-ghost';
    $('btnSubtabHistory').className = 'btn-sm btn-accent';
    $('historyDateFilterWrap').style.display = 'flex';
    renderPicklists();
  });

  $('historyDateInput')?.addEventListener('change', (e) => {
    state.historySelectedDate = e.target.value;
    renderPicklists();
  });

  $('btnResetHistoryDate')?.addEventListener('click', () => {
    state.historySelectedDate = '';
    $('historyDateInput').value = '';
    renderPicklists();
  });

  // Export Picklists/Putaway Lists by Start-End Date Range to Excel
  $('btnExportPicklistsExcel')?.addEventListener('click', () => {
    const startVal = $('exportStartDate')?.value;
    const endVal = $('exportEndDate')?.value;

    if (!startVal || !endVal) {
      alert("Please select both Start Date and End Date for export.");
      return;
    }

    const start = new Date(startVal + 'T00:00:00');
    const end = new Date(endVal + 'T23:59:59');

    const filteredLists = state.picklists.filter(list => {
      const created = new Date(list.createdAt);
      return created >= start && created <= end;
    });

    if (!filteredLists.length) {
      alert(`No picklists or putaway lists found between ${startVal} and ${endVal}.`);
      return;
    }

    const exportRows = [];
    filteredLists.forEach(list => {
      list.items.forEach(item => {
        exportRows.push({
          "List Number": list.listNo,
          "Order Number": list.orderNo,
          "Type": list.type,
          "Status": list.status,
          "Date Added": formatDateTime(list.createdAt),
          "Date Activated": formatDateTime(list.activatedAt),
          "Date Completed/Cancelled": formatDateTime(list.completedAt),
          "SKU No": item.skuNo,
          "Item Label": item.itemLabel,
          "Description": item.description,
          "Location": item.location,
          "Quantity": item.quantity
        });
      });
    });

    exportDataToExcel(exportRows, `Picklists_Export_${startVal}_to_${endVal}`);
  });

// ---------------- Activate: light up every Tag bound to the SKUs in the list AND their parent hierarchy (Shelf/Area) ----------------
  async function activateList(uid){
    const list = state.picklists.find(l => l.uid === uid);
    if (!list || list.status !== 'PENDING') return;

    // 1. Get direct tag bindings from SKUs in list
    const directTagIds = [...new Set(list.items.map(i => i.tagBind).filter(Boolean))];
    if (!directTagIds.length) {
      alert('None of the items in this list have a Tag bound to their SKU — nothing to activate.');
      return;
    }

    // 2. Resolve parent hierarchy (ShelfTags & AreaTags) for each bound Tag
    const targetTagsMap = new Map(); // tagId -> tag object
    directTagIds.forEach(tagId => {
      const startTag = state.tags.find(t => t.tagId === tagId);
      if (startTag) {
        // Traverses up ItemTag -> ShelfTag -> AreaTag
        const cascadeNodes = getCascadeActivationSet(startTag);
        cascadeNodes.forEach(node => {
          targetTagsMap.set(node.tagId, node);
        });
      } else {
        // Fallback if tagId is not registered in state.tags array
        targetTagsMap.set(tagId, { tagId: tagId, defaultBeep: true, defaultFlash: true });
      }
    });

    const allTagIds = Array.from(targetTagsMap.keys());

    // 3. Allocate active indicator color
    const color = allocateListColor();
    if (color === null) {
      alert('All indicator colors are currently in use by other active lists. Please try again in a few seconds.');
      return;
    }

    // 4. Construct payload for all Item, Shelf, and Area tags
    const items = Array.from(targetTagsMap.values()).map(tag => {
      return { 
        TagID: tag.tagId, 
        Beep: tag.defaultBeep !== undefined ? tag.defaultBeep : true, 
        Color: color, 
        Flashing: tag.defaultFlash !== undefined ? tag.defaultFlash : true 
      };
    });

    const ok = await publishMqttViaServer(TAG_TOPIC, { Time: 5, Items: items, Sequence: 26, Code: 131, Token: "" });
    if (!ok) { releaseListColor(color); return; }

    // 5. Save all activated tag IDs (including parent Shelf/Area tags) to list state
    list.status = 'ACTIVE';
    list.color = color;
    list.tagIds = allTagIds; // Stored so finishList can cleanly turn off all related lights
    list.activatedAt = new Date().toISOString();

    savePicklistsToStorage();
    renderPicklists();
  }

  // ---------------- Complete (adjust stock + log transactions) or Cancel (stop only, no stock change) ----------------
  async function finishList(uid, completed){
    const list = state.picklists.find(l => l.uid === uid);
    if (!list || list.status !== 'ACTIVE') return;

    const tagIds = list.tagIds && list.tagIds.length ? list.tagIds : [...new Set(list.items.map(i => i.tagBind).filter(Boolean))];
    if (tagIds.length) {
      const stopItems = tagIds.map(tagId => ({ TagID: tagId, Beep: false, Color: 0, Flashing: false }));
      await publishMqttViaServer(TAG_TOPIC, { Time: 5, Items: stopItems, Sequence: 26, Code: 131, Token: "" });
    }

    releaseListColor(list.color);

    if (completed) {
      const sign = list.type === 'PUTAWAY' ? 1 : -1;
      const payload = {
        orderNo: list.orderNo,
        listNo: list.listNo,
        items: list.items.map(i => ({ skuNo: i.skuNo, quantityDelta: sign * i.quantity }))
      };
      try {
        await fetch('/api/inventory/commit-list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch(e){}
      await loadInventoryData();
      await loadTransactionsData();
    }

    list.status = completed ? 'COMPLETED' : 'CANCELLED';
    list.completedAt = new Date().toISOString();

    savePicklistsToStorage();
    renderPicklists();
  }

  // ---------------- WAREHOUSE CONFIGURATION PAGE ----------------
  let attachModalContext = { type: null, parentUid: null, parentId: null, sortDir: 'ASC' };

  $('lockConfigBtn').addEventListener('click', () => {
    state.configLocked = !state.configLocked;
    const btn = $('lockConfigBtn');
    if (state.configLocked) {
      btn.textContent = '🔒 CONFIG LOCKED';
      btn.classList.add('btn-danger');
      btn.classList.remove('btn-ghost');
    } else {
      btn.textContent = '🔓 LOCK CONFIG';
      btn.classList.remove('btn-danger');
      btn.classList.add('btn-ghost');
    }
    renderWarehouseConfigAnimated();
  });

  function openAttachModal(type, parentUid) {
    attachModalContext.type = type;
    attachModalContext.parentUid = parentUid;

    if (type === 'skuPickTag') {
      $('whModalTitle').textContent = `Select Tag to Bind to SKU`;
    } else {
      const parentTag = state.tags.find(t => t.uid === parentUid);
      if (!parentTag) return;
      attachModalContext.parentId = parentTag.tagId;
      const parentDisplay = parentTag.tagRef ? `${parentTag.tagRef} (${parentTag.tagId})` : parentTag.tagId;
      $('whModalTitle').textContent = type === 'shelf' 
        ? `Add Shelf Tag to Area: ${parentDisplay}` 
        : `Add Item Tag to Shelf: ${parentDisplay}`;
    }
    
    $('whModalSearch').value = '';
    $('whAttachModal').classList.add('active');
    renderAttachModalList();
  }

  function closeAttachModal() {
    $('whAttachModal').classList.remove('active');
  }

  function renderAttachModalList() {
    const container = $('whModalListContainer');
    const search = $('whModalSearch').value.trim().toLowerCase();
    const sortBy = $('whModalSortBy').value;
    const sortDir = attachModalContext.sortDir;

    let candidates = [];
    if (attachModalContext.type === 'skuPickTag') {
      candidates = state.tags.filter(t => t.tagType === 'ItemTag' || t.tagType === 'ShelfTag');
    } else if (attachModalContext.type === 'shelf') {
      const areaTags = state.tags.filter(t => t.tagType === 'AreaTag');
      const validAreaIds = new Set(areaTags.map(a => a.tagId));
      candidates = state.tags.filter(t => t.tagType === 'ShelfTag' && (!t.parentTag || !validAreaIds.has(t.parentTag)));
    } else {
      const allShelves = state.tags.filter(t => t.tagType === 'ShelfTag');
      const activeShelfIds = new Set(allShelves.filter(s => s.parentTag).map(s => s.tagId));
      candidates = state.tags.filter(t => t.tagType === 'ItemTag' && (!t.parentTag || !activeShelfIds.has(t.parentTag)));
    }

    if (search) {
      candidates = candidates.filter(t => 
        (t.tagId && t.tagId.toLowerCase().includes(search)) ||
        (t.tagRef && t.tagRef.toLowerCase().includes(search)) ||
        (t.description && t.description.toLowerCase().includes(search))
      );
    }

    candidates.sort((a, b) => {
      const valA = (a[sortBy] || '').toString();
      const valB = (b[sortBy] || '').toString();
      const cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
      return sortDir === 'ASC' ? cmp : -cmp;
    });

    if (!candidates.length) {
      container.innerHTML = `<div class="empty-strip-hint" style="padding:20px;">No matching tags available.</div>`;
      return;
    }

    container.innerHTML = candidates.map(t => {
      const titleDisplay = t.tagRef ? `${escapeHtml(t.tagRef)} <span style="color:var(--cyan-dim); font-weight:normal;">(${escapeHtml(t.tagId)})</span>` : escapeHtml(t.tagId);
      return `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; background:#0E1316; border:1px solid var(--line); border-radius:6px;">
          <div>
            <div style="font-family:var(--mono); font-weight:700; color:var(--text); font-size:12.5px;">
              ${titleDisplay}
            </div>
            <div style="font-size:11px; color:var(--text-faint); margin-top:2px;">
              Tag Type: ${escapeHtml(t.tagType)} | ${t.description ? escapeHtml(t.description) : 'No description'}
            </div>
          </div>
          <button class="btn-sm btn-primary" data-attach-candidate-uid="${t.uid}" data-candidate-tagid="${escapeHtml(t.tagId)}">Select</button>
        </div>
      `;
    }).join('');

    container.querySelectorAll('[data-attach-candidate-uid]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tagId = btn.dataset.candidateTagid;
        if (attachModalContext.type === 'skuPickTag') {
          $('skuTagBind').value = tagId;
          closeAttachModal();
        } else {
          const candidateTag = state.tags.find(t => t.uid === btn.dataset.attachCandidateUid);
          if (candidateTag) {
            candidateTag.parentTag = attachModalContext.parentId;
            saveTagsToStorage();
            closeAttachModal();
            renderWarehouseConfigAnimated();
          }
        }
      });
    });
  }

  $('whModalCloseBtn').addEventListener('click', closeAttachModal);
  $('whModalSearch').addEventListener('input', renderAttachModalList);
  $('whModalSortBy').addEventListener('change', renderAttachModalList);
  $('whModalSortDirBtn').addEventListener('click', () => {
    attachModalContext.sortDir = attachModalContext.sortDir === 'ASC' ? 'DESC' : 'ASC';
    $('whModalSortDirBtn').textContent = attachModalContext.sortDir;
    renderAttachModalList();
  });

  function renderWarehouseConfigAnimated() {
    const container = $('warehouseHierarchyList');
    if (!container) { renderWarehouseConfig(); return; }

    const firstPositions = new Map();
    const oldElements = container.querySelectorAll('.wh-shelf-row[data-shelf-uid], .wh-box-card[data-item-uid]');
    oldElements.forEach(el => {
      const uid = el.dataset.shelfUid || el.dataset.itemUid;
      if (uid) firstPositions.set(uid, el.getBoundingClientRect());
    });

    renderWarehouseConfig();

    const newElements = container.querySelectorAll('.wh-shelf-row[data-shelf-uid], .wh-box-card[data-item-uid]');
    newElements.forEach(el => {
      const uid = el.dataset.shelfUid || el.dataset.itemUid;
      const first = firstPositions.get(uid);
      if (first) {
        const last = el.getBoundingClientRect();
        const deltaX = first.left - last.left;
        const deltaY = first.top - last.top;

        if (deltaX !== 0 || deltaY !== 0) {
          el.style.transition = 'none';
          el.style.transform = `translate(${deltaX}px, ${deltaY}px)`;

          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              el.style.transition = 'transform 0.35s cubic-bezier(0.2, 0, 0, 1)';
              el.style.transform = '';
            });
          });
        }
      }
    });
  }

// ---------------- WAREHOUSE CONFIG SKU BINDING SUBWINDOW ----------------
  let targetBindTagId = null;

  function openWhSkuPickerModal(tagId) {
    targetBindTagId = tagId;
    const tag = state.tags.find(t => t.tagId === tagId);
    const tagDisplay = tag && tag.tagRef ? `${tag.tagRef} (${tag.tagId})` : tagId;

    $('whSkuPickerTitle').textContent = `Bind SKU to Tag: ${tagDisplay}`;
    $('whSkuPickerSearch').value = '';
    $('whSkuPickerModal').classList.add('active');
    renderWhSkuPickerTable();
  }

  function closeWhSkuPickerModal() {
    $('whSkuPickerModal').classList.remove('active');
    targetBindTagId = null;
  }

  $('whSkuPickerCloseBtn')?.addEventListener('click', closeWhSkuPickerModal);
  $('whSkuPickerSearch')?.addEventListener('input', () => renderWhSkuPickerTable());

  function renderWhSkuPickerTable() {
    const tbody = $('whSkuPickerTableBody');
    if (!tbody) return;

    const search = ($('whSkuPickerSearch')?.value || '').trim().toLowerCase();

    let filtered = state.skus.filter(s => {
      if (!search) return true;
      const skuNo = (s.skuNo || '').toLowerCase();
      const label = (s.itemLabel || '').toLowerCase();
      return skuNo.includes(search) || label.includes(search);
    });

    if (!filtered.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="5">No matching SKUs found.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(s => {
      const isAlreadyBoundToThis = s.tagBind === targetBindTagId;
      const isBoundToOther = s.tagBind && s.tagBind !== targetBindTagId;

      const imgMarkup = s.productImage 
        ? `<img src="${escapeHtml(s.productImage)}" style="width:32px; height:32px; object-fit:cover; border-radius:4px; border:1px solid var(--line);">`
        : `<div style="width:32px; height:32px; background:#0E1316; border:1px solid var(--line); border-radius:4px; display:flex; align-items:center; justify-content:center; color:var(--text-faint); font-size:8.5px;">No img</div>`;

      let bindBtnHtml = '';
      if (isAlreadyBoundToThis) {
        bindBtnHtml = `<span style="font-size:10px; font-weight:700; color:var(--green);">✓ Bound</span>`;
      } else {
        bindBtnHtml = `<button class="btn-sm btn-primary" data-select-bind-sku="${escapeHtml(s.skuNo)}" type="button">Bind SKU</button>`;
      }

      return `
        <tr>
          <td>${imgMarkup}</td>
          <td style="font-weight:700; color:var(--cyan);">${escapeHtml(s.skuNo)}</td>
          <td style="font-weight:600; color:var(--text);">${escapeHtml(s.itemLabel)}</td>
          <td style="font-size:11px; color:var(--text-faint);">
            ${isAlreadyBoundToThis ? `<span style="color:var(--green); font-weight:600;">Bound to this Tag</span>` : (isBoundToOther ? `<span style="color:var(--amber);">Bound to ${escapeHtml(s.tagBind)}</span>` : `Unbound`)}
          </td>
          <td style="text-align:right;">${bindBtnHtml}</td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('[data-select-bind-sku]').forEach(btn => {
      btn.addEventListener('click', () => {
        const skuNo = btn.dataset.selectBindSku;
        const targetSku = state.skus.find(s => s.skuNo === skuNo);

        if (targetSku) {
          // If any other SKU was previously bound to this tag, clear its binding
          state.skus.forEach(s => {
            if (s.tagBind === targetBindTagId) s.tagBind = '';
          });

          // Bind selected SKU to tag
          targetSku.tagBind = targetBindTagId;
          saveSkusToStorage();
          closeWhSkuPickerModal();
          renderWarehouseConfigAnimated();
        }
      });
    });
  }

  function renderWarehouseConfig(){
    const container = $('warehouseHierarchyList');
    const areaTags = state.tags.filter(t => t.tagType === 'AreaTag');
    const allShelves = state.tags.filter(t => t.tagType === 'ShelfTag');
    const allItems = state.tags.filter(t => t.tagType === 'ItemTag');

    if (!areaTags.length){
      container.innerHTML = '<div class="empty-strip-hint">No Area Tags created yet. Add an Area Tag in Light Control to start configuring your warehouse.</div>';
      return;
    }

    container.innerHTML = areaTags.map(area => {
      const assignedShelves = allShelves.filter(s => s.parentTag === area.tagId);
      const areaTitle = area.tagRef ? `${escapeHtml(area.tagRef)} <span class="tag-ref">(${escapeHtml(area.tagId)})</span>` : escapeHtml(area.tagId);
      const isAreaCollapsed = state.collapsedAreas.has(area.uid);

      return `
        <div class="wh-area-card" data-area-uid="${area.uid}">
          <div class="wh-area-header">
            <div class="wh-area-title">
              <button class="btn-sm btn-ghost btn-toggle-area" data-toggle-area="${area.uid}" type="button" style="padding:2px 6px; font-size:11px;">${isAreaCollapsed ? '▶' : '▼'}</button>
              ${renderTagIcon('AreaTag')}
              <span>${areaTitle}</span>
            </div>
            <div class="wh-attach-row">
              ${!state.configLocked ? `<button class="btn-sm btn-primary" data-open-shelf-modal="${area.uid}">+ Add Shelf Tag</button>` : ''}
              <div class="wh-action-btns" style="margin-left:8px;">
                <button class="btn-sm btn-accent" data-activate="${area.uid}">Activate Area</button>
                <button class="btn-sm btn-primary" data-test="${area.uid}">Test</button>
                <button class="btn-sm btn-danger" data-stop="${area.uid}">Stop</button>
              </div>
            </div>
          </div>

          <div class="wh-shelf-list" style="${isAreaCollapsed ? 'display:none;' : ''}">
            ${!assignedShelves.length ? '<div class="hint" style="font-style:italic;">No Shelf Tags attached to this Area.</div>' : ''}
            ${assignedShelves.map(shelf => {
              const assignedItems = allItems.filter(i => i.parentTag === shelf.tagId);
              const shelfMainLabel = shelf.tagRef ? escapeHtml(shelf.tagRef) : escapeHtml(shelf.tagId);
              const shelfSubLabel = shelf.tagRef ? `(${escapeHtml(shelf.tagId)})` : '';
              const isShelfCollapsed = state.collapsedShelves.has(shelf.uid);

              const boundSkuForShelf = state.skus.find(s => s.tagBind === shelf.tagId);

              return `
                <div class="wh-shelf-row" data-shelf-uid="${shelf.uid}" draggable="${!state.configLocked}">
                  <div class="wh-box-card wh-shelf-box">
                    <div>
                      <div class="wh-box-head" style="margin-bottom:6px;">
                        <div style="display:flex; align-items:center; gap:4px;">
                          <button class="btn-sm btn-ghost btn-toggle-shelf mobile-only-toggle" data-toggle-shelf="${shelf.uid}" type="button" style="padding:1px 4px; font-size:9px;">${isShelfCollapsed ? '▶' : '▼'}</button>
                          <span class="wh-shelf-badge">SHELF</span>
                        </div>
                        ${!state.configLocked ? `<button class="btn-sm btn-danger" data-unassign-shelf="${shelf.uid}" style="padding:2px 6px; font-size:10px; font-weight:700;">Delete</button>` : ''}
                      </div>
                      <div class="wh-tag-label" style="gap:6px;">
                        ${renderTagIcon('ShelfTag')}
                        <span class="wh-box-tagid">${shelfMainLabel}</span>
                      </div>
                      ${shelfSubLabel ? `<div class="wh-box-ref" style="margin-top:4px;">${shelfSubLabel}</div>` : ''}
                      
                      <!-- Bound SKU Info or Bind SKU Button -->
                      <div style="margin-top:6px; padding-top:4px; border-top:1px dashed var(--cyan-dim);">
                        ${boundSkuForShelf ? `
                          <div style="font-size:10.5px; font-weight:700; color:var(--cyan); word-break:break-all;">${escapeHtml(boundSkuForShelf.itemLabel)}</div>
                          <div style="font-size:9.5px; color:var(--text-faint);">${escapeHtml(boundSkuForShelf.skuNo)}</div>
                          ${!state.configLocked ? `<button class="btn-sm btn-ghost" data-unbind-sku="${escapeHtml(boundSkuForShelf.skuNo)}" type="button" style="padding:1px 4px; font-size:9px; color:var(--red); margin-top:3px;">Unbind SKU</button>` : ''}
                        ` : `
                          ${!state.configLocked ? `<button class="btn-sm btn-accent" data-bind-sku-tagid="${escapeHtml(shelf.tagId)}" type="button" style="width:100%; padding:3px 4px; font-size:9.5px; margin-top:2px;">+ Bind SKU</button>` : `<div style="font-size:9.5px; color:var(--text-faint); font-style:italic;">No SKU Bound</div>`}
                        `}
                      </div>
                    </div>

                    <div class="wh-box-actions">
                      <button class="btn-sm btn-accent" data-activate="${shelf.uid}">Act</button>
                      <button class="btn-sm btn-primary" data-test="${shelf.uid}">Test</button>
                      <button class="btn-sm btn-danger" data-stop="${shelf.uid}">Stop</button>
                    </div>
                  </div>

                  <div class="wh-shelf-controls-right">
                    <button class="btn-toggle-shelf-desktop" data-toggle-shelf="${shelf.uid}" type="button">
                      ${isShelfCollapsed ? '▶' : '◀'}
                    </button>
                    <div class="wh-shelf-divider"></div>
                  </div>

                  <div class="wh-items-horizontal" data-shelf-items-uid="${shelf.uid}" style="${isShelfCollapsed ? 'display:none;' : ''}">
                    ${assignedItems.map(item => {
                      const itemMainLabel = item.tagRef ? escapeHtml(item.tagRef) : escapeHtml(item.tagId);
                      const itemSubLabel = item.tagRef ? `(${escapeHtml(item.tagId)})` : '';
                      const boundSku = state.skus.find(s => s.tagBind === item.tagId);

                      return `
                        <div class="wh-box-card" data-item-uid="${item.uid}" draggable="${!state.configLocked}">
                          <div class="wh-box-head">
                            <div class="wh-tag-label">
                              ${renderTagIcon('ItemTag')}
                              <span class="wh-box-tagid">${itemMainLabel}</span>
                            </div>
                            ${!state.configLocked ? `<button class="btn-sm btn-danger" data-unassign-item="${item.uid}" style="padding:1px 5px; font-size:9.5px; font-weight:700;">Delete</button>` : ''}
                          </div>
                          ${itemSubLabel ? `<div class="wh-box-ref">${itemSubLabel}</div>` : ''}

                          <!-- Bound SKU Details & Image -->
                          ${boundSku ? `
                            <div style="display:flex; flex-direction:column; gap:1px; margin-top:2px;">
                              <div style="font-size:10.5px; font-weight:700; color:var(--cyan); word-break:break-all; line-height:1.2;">${escapeHtml(boundSku.itemLabel)}</div>
                              <div style="font-size:9px; color:var(--text-faint);">${escapeHtml(boundSku.skuNo)}</div>
                            </div>
                            <div class="wh-img-placeholder" data-view-sku="${escapeHtml(boundSku.skuNo)}" title="Click to view full details">
                              ${boundSku.productImage ? `<img src="${escapeHtml(boundSku.productImage)}">` : `<span>No Image</span>`}
                            </div>
                            ${!state.configLocked ? `<button class="btn-sm btn-ghost" data-unbind-sku="${escapeHtml(boundSku.skuNo)}" type="button" style="padding:1px 4px; font-size:9px; color:var(--red); text-align:center;">Unbind SKU</button>` : ''}
                          ` : `
                            <div class="wh-img-placeholder">
                              <span>No Image</span>
                            </div>
                            ${!state.configLocked ? `<button class="btn-sm btn-accent" data-bind-sku-tagid="${escapeHtml(item.tagId)}" type="button" style="padding:3px 4px; font-size:9.5px; width:100%;">+ Bind SKU</button>` : `<div style="font-size:9px; color:var(--text-faint); text-align:center; font-style:italic;">No SKU Bound</div>`}
                          `}

                          <div class="wh-box-actions">
                            <button class="btn-sm btn-accent" data-activate="${item.uid}">Act</button>
                            <button class="btn-sm btn-primary" data-test="${item.uid}">Test</button>
                            <button class="btn-sm btn-danger" data-stop="${item.uid}">Stop</button>
                          </div>
                        </div>
                      `;
                    }).join('')}

                    ${!state.configLocked ? `
                      <div class="wh-box-card wh-attach-box">
                        <div style="font-weight:600; font-size:11px; color:var(--text-dim); text-align:center;">+ Add Item Tag</div>
                        <button class="btn-sm btn-primary btn-block" data-open-item-modal="${shelf.uid}">+ Select Item</button>
                      </div>
                    ` : ''}
                  </div>

                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('[data-toggle-area]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = btn.dataset.toggleArea;
        if (state.collapsedAreas.has(uid)) state.collapsedAreas.delete(uid);
        else state.collapsedAreas.add(uid);
        renderWarehouseConfigAnimated();
      });
    });

    container.querySelectorAll('[data-toggle-shelf]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = btn.dataset.toggleShelf;
        if (state.collapsedShelves.has(uid)) state.collapsedShelves.delete(uid);
        else state.collapsedShelves.add(uid);
        renderWarehouseConfigAnimated();
      });
    });

    container.querySelectorAll('[data-open-shelf-modal]').forEach(btn => {
      btn.addEventListener('click', () => openAttachModal('shelf', btn.dataset.openShelfModal));
    });

    container.querySelectorAll('[data-open-item-modal]').forEach(btn => {
      btn.addEventListener('click', () => openAttachModal('item', btn.dataset.openItemModal));
    });

    container.querySelectorAll('[data-unassign-shelf]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (state.configLocked) return;
        confirmDialog("Detach Shelf Tag", "Are you sure you want to detach this Shelf Tag from the Area?", () => {
          const shelfTag = state.tags.find(t => t.uid === btn.dataset.unassignShelf);
          if (shelfTag) {
            shelfTag.parentTag = '';
            saveTagsToStorage();
            renderWarehouseConfigAnimated();
          }
        });
      });
    });

    container.querySelectorAll('[data-unassign-item]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (state.configLocked) return;
        confirmDialog("Detach Item Tag", "Are you sure you want to detach this Item Tag from the Shelf?", () => {
          const itemTag = state.tags.find(t => t.uid === btn.dataset.unassignItem);
          if (itemTag) {
            itemTag.parentTag = '';
            saveTagsToStorage();
            renderWarehouseConfigAnimated();
          }
        });
      });
    });

    container.querySelectorAll('[data-activate]').forEach(btn => {
      btn.addEventListener('click', () => publishTagActivate(btn.dataset.activate));
    });
    container.querySelectorAll('[data-test]').forEach(btn => {
      btn.addEventListener('click', () => publishTagTest(btn.dataset.test));
    });
    container.querySelectorAll('[data-bind-sku-tagid]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openWhSkuPickerModal(btn.dataset.bindSkuTagid);
      });
    });

    container.querySelectorAll('[data-unbind-sku]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const skuNo = btn.dataset.unbindSku;
        confirmDialog("Unbind SKU", `Are you sure you want to unbind SKU (${skuNo}) from this tag?`, () => {
          const sku = state.skus.find(s => s.skuNo === skuNo);
          if (sku) {
            sku.tagBind = '';
            saveSkusToStorage();
            renderWarehouseConfigAnimated();
          }
        });
      });
    });

    if (!state.configLocked) attachWarehouseDragAndDrop(container);
  }

  // ---------------- WAREHOUSE DRAG & DROP ENGINE ----------------
  function attachWarehouseDragAndDrop(container) {
    container.querySelectorAll('.wh-shelf-row').forEach(shelfRow => {
      shelfRow.addEventListener('dragstart', (e) => {
        if (state.configLocked) return;
        e.stopPropagation();
        draggedWhObject = { type: 'shelf', uid: shelfRow.dataset.shelfUid };
        shelfRow.classList.add('dragging');
      });

      shelfRow.addEventListener('dragend', (e) => {
        e.stopPropagation();
        shelfRow.classList.remove('dragging');
        container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        draggedWhObject = null;
      });

      shelfRow.addEventListener('dragover', (e) => {
        if (!draggedWhObject || state.configLocked) return;
        e.preventDefault(); e.stopPropagation();
        if (draggedWhObject.type === 'shelf') shelfRow.classList.add('drag-over');
      });

      shelfRow.addEventListener('dragleave', (e) => { e.stopPropagation(); shelfRow.classList.remove('drag-over'); });

      shelfRow.addEventListener('drop', (e) => {
        if (!draggedWhObject || state.configLocked) return;
        e.preventDefault(); e.stopPropagation();
        shelfRow.classList.remove('drag-over');

        const targetShelfUid = shelfRow.dataset.shelfUid;
        const targetShelf = state.tags.find(t => t.uid === targetShelfUid);

        if (draggedWhObject.type === 'shelf' && targetShelf && draggedWhObject.uid !== targetShelfUid) {
          const draggedShelf = state.tags.find(t => t.uid === draggedWhObject.uid);
          if (draggedShelf) {
            draggedShelf.parentTag = targetShelf.parentTag;
            const fromIdx = state.tags.findIndex(t => t.uid === draggedWhObject.uid);
            const toIdx = state.tags.findIndex(t => t.uid === targetShelfUid);
            if (fromIdx >= 0 && toIdx >= 0) {
              const [moved] = state.tags.splice(fromIdx, 1);
              state.tags.splice(toIdx, 0, moved);
            }
            saveTagsToStorage();
            renderWarehouseConfigAnimated();
          }
        }
      });
    });

    container.querySelectorAll('.wh-area-card').forEach(areaCard => {
      areaCard.addEventListener('dragover', (e) => {
        if (!draggedWhObject || draggedWhObject.type !== 'shelf' || state.configLocked) return;
        e.preventDefault(); areaCard.classList.add('drag-over');
      });

      areaCard.addEventListener('dragleave', () => areaCard.classList.remove('drag-over'));

      areaCard.addEventListener('drop', (e) => {
        if (!draggedWhObject || draggedWhObject.type !== 'shelf' || state.configLocked) return;
        e.preventDefault(); areaCard.classList.remove('drag-over');

        const targetArea = state.tags.find(t => t.uid === areaCard.dataset.areaUid);
        const draggedShelf = state.tags.find(t => t.uid === draggedWhObject.uid);

        if (targetArea && draggedShelf) {
          draggedShelf.parentTag = targetArea.tagId;
          saveTagsToStorage();
          renderWarehouseConfigAnimated();
        }
      });
    });

    container.querySelectorAll('.wh-box-card[data-item-uid]').forEach(itemCard => {
      itemCard.addEventListener('dragstart', (e) => {
        if (state.configLocked) return;
        e.stopPropagation();
        draggedWhObject = { type: 'item', uid: itemCard.dataset.itemUid };
        itemCard.classList.add('dragging');
      });

      itemCard.addEventListener('dragend', (e) => {
        e.stopPropagation();
        itemCard.classList.remove('dragging');
        container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        draggedWhObject = null;
      });

      itemCard.addEventListener('dragover', (e) => {
        if (!draggedWhObject || state.configLocked) return;
        e.preventDefault(); e.stopPropagation();
        if (draggedWhObject.type === 'item') itemCard.classList.add('drag-over');
      });

      itemCard.addEventListener('dragleave', (e) => { e.stopPropagation(); itemCard.classList.remove('drag-over'); });

      itemCard.addEventListener('drop', (e) => {
        if (!draggedWhObject || state.configLocked) return;
        e.preventDefault(); e.stopPropagation();
        itemCard.classList.remove('drag-over');

        const targetItemUid = itemCard.dataset.itemUid;
        const targetItem = state.tags.find(t => t.uid === targetItemUid);

        if (draggedWhObject.type === 'item' && targetItem && draggedWhObject.uid !== targetItemUid) {
          const draggedItem = state.tags.find(t => t.uid === draggedWhObject.uid);
          if (draggedItem) {
            draggedItem.parentTag = targetItem.parentTag;
            const fromIdx = state.tags.findIndex(t => t.uid === draggedWhObject.uid);
            const toIdx = state.tags.findIndex(t => t.uid === targetItemUid);
            if (fromIdx >= 0 && toIdx >= 0) {
              const [moved] = state.tags.splice(fromIdx, 1);
              state.tags.splice(toIdx, 0, moved);
            }
            saveTagsToStorage();
            renderWarehouseConfigAnimated();
          }
        }
      });
    });

    container.querySelectorAll('.wh-items-horizontal').forEach(itemsRow => {
      itemsRow.addEventListener('dragover', (e) => {
        if (!draggedWhObject || draggedWhObject.type !== 'item' || state.configLocked) return;
        e.preventDefault(); e.stopPropagation();
        itemsRow.classList.add('drag-over');
      });

      itemsRow.addEventListener('dragleave', (e) => { e.stopPropagation(); itemsRow.classList.remove('drag-over'); });

      itemsRow.addEventListener('drop', (e) => {
        if (!draggedWhObject || draggedWhObject.type !== 'item' || state.configLocked) return;
        e.preventDefault(); e.stopPropagation();
        itemsRow.classList.remove('drag-over');

        const targetShelf = state.tags.find(t => t.uid === itemsRow.dataset.shelfItemsUid);
        const draggedItem = state.tags.find(t => t.uid === draggedWhObject.uid);

        if (targetShelf && draggedItem) {
          draggedItem.parentTag = targetShelf.tagId;
          saveTagsToStorage();
          renderWarehouseConfigAnimated();
        }
      });
    });
  }

  // Initial load
  Promise.all([loadTagsFromStorage(), loadSkusFromStorage(), loadSettings(), loadInventoryData(), loadTransactionsData(), loadPicklistsFromStorage()]).then(() => {
    renderTagList();
    renderPicklists();
    checkServerMqttStatus();
  });

})();