import { $, SETTINGS_API_URL } from '../state.js';
import { renderWarehouseConfig, renderWarehouseStock } from '../modules/warehouse.js';
import { renderSkuTable, renderInventoryTable, renderTransactionsTable } from '../modules/inventory.js';
import { renderPicklists } from '../modules/picklists.js';

export function switchTab(target) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === target));
  document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
  const page = $('tab-' + target);
  if (page) page.classList.add('active');

  if (target === 'warehouse') renderWarehouseConfig();
  if (target === 'wh-stock') renderWarehouseStock();
  if (target === 'wh-inventory') renderInventoryTable();
  if (target === 'wh-transactions') renderTransactionsTable();
  if (target === 'wh-db') renderSkuTable();
  if (target === 'home') renderPicklists();

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function applySubpageVisibility(tabKey, show) {
  const map = { light: 'lightTabBtn', 'wh-db': 'whDbTabBtn', warehouse: 'whConfigTabBtn', debug: 'debugTabBtn' };
  const btn = $(map[tabKey]);
  if (btn) btn.style.display = show ? '' : 'none';
  if (!show && $('tab-' + tabKey)?.classList.contains('active')) switchTab('wh-stock');
}

export function initTabListeners() {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  $('brandHomeBtn')?.addEventListener('click', () => switchTab('home'));
  document.querySelectorAll('[data-goto-tab]').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.gotoTab)));

  const checkboxes = [
    { id: 'showLightControlCb', key: 'light', apiKey: 'show_light_control' },
    { id: 'showWhDbCb', key: 'wh-db', apiKey: 'show_wh_db' },
    { id: 'showDebugConsoleCb', key: 'debug', apiKey: 'show_debug_console' },
    { id: 'showWhConfigCb', key: 'warehouse', apiKey: 'show_wh_config' }
  ];

  checkboxes.forEach(({ id, key, apiKey }) => {
    $(id)?.addEventListener('change', (e) => {
      applySubpageVisibility(key, e.target.checked);
      fetch(SETTINGS_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: apiKey, value: e.target.checked ? 'true' : 'false' })
      }).catch(() => {});
    });
  });
}