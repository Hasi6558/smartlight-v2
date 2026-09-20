import { $, state } from './state.js';
import { 
  loadTagsFromStorage, loadSkusFromStorage, loadSettings, 
  loadInventoryData, loadTransactionsData, loadPicklistsFromStorage, loadTemplatesFromStorage,
  checkServerMqttStatus, triggerServerConnect, triggerServerDisconnect,
  initApiListeners 
} from './api.js';
import { initTabListeners } from './UI/tabs.js';
import { initModalListeners } from './UI/modals.js';
import { renderTagList, initLightControlListeners } from './modules/Lightcontrol.js';
import { renderPicklists, renderTemplates, checkPicklistTimeouts, initPicklistListeners } from './modules/picklists.js';
import { initInventoryListeners } from './modules/inventory.js';
import { initWarehouseListeners } from './modules/warehouse.js';

const initializeApp = () => {
  // Initialize all DOM event listeners
  initTabListeners();
  initModalListeners();
  initApiListeners();
  initLightControlListeners();
  initInventoryListeners();
  initPicklistListeners();
  initWarehouseListeners();

  // Mqtt Connection topbar & settings button handlers
  $('topbarConnectBtn')?.addEventListener('click', () => {
    if (state.serverConnected || state.serverConnecting) triggerServerDisconnect();
    else triggerServerConnect();
  });

  $('startBtn')?.addEventListener('click', () => {
    if (state.serverConnected || state.serverConnecting) triggerServerDisconnect();
    else triggerServerConnect();
  });

  // Background polling loop
  setInterval(() => {
    checkServerMqttStatus();
    checkPicklistTimeouts();
  }, 2500);

  // Render Home as soon as its own database request completes. The
  // transactions dataset can be large and must not block the Home page.
  renderPicklists();
  loadPicklistsFromStorage().then(() => renderPicklists());

  Promise.all([
    loadTagsFromStorage(),
    loadSkusFromStorage(),
    loadSettings(),
    loadInventoryData(),
    loadTransactionsData(),
    loadTemplatesFromStorage()
  ]).then(() => {
    renderTagList();
    renderTemplates();
    checkServerMqttStatus();
  });
};

// Partial HTML is loaded before this module. Support both parser-time and
// dynamically imported execution so initialization always runs exactly once.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp, { once: true });
} else {
  initializeApp();
}