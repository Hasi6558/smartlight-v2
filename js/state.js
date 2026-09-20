export const $ = (id) => document.getElementById(id);

export function formatDateTime(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString([], {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

export function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtData(d) {
  if (d === undefined || d === null) return '';
  if (typeof d === 'string') return d;
  try { return JSON.stringify(d); } catch (e) { return String(d); }
}

export const STORAGE_KEY = 'ap_console_tags_v1';
export const SKU_STORAGE_KEY = 'ap_console_skus_v1';
export const SQLITE_API_URL = '/api/tags';
export const SKU_API_URL = '/api/skus';
export const SETTINGS_API_URL = '/api/settings';

export const ICONS = {
  AreaTag: `<svg class="tag-icon-svg" viewBox="0 0 24 24"><path d="M3 3v18M21 3v18M3 7h18M3 14h18" stroke-width="2" stroke-linecap="round"/><rect x="5" y="9" width="4" height="4" rx="1" stroke-width="1.8"/><rect x="11" y="9" width="4" height="4" rx="1" stroke-width="1.8"/><rect x="15" y="16" width="4" height="4" rx="1" stroke-width="1.8"/></svg>`,
  ShelfTag: `<svg class="tag-icon-svg" viewBox="0 0 24 24"><rect x="2" y="9" width="5" height="6" rx="1" stroke-width="1.8"/><rect x="9" y="9" width="5" height="6" rx="1" stroke-width="1.8"/><rect x="16" y="9" width="5" height="6" rx="1" stroke-width="1.8"/><path d="M2 17h20" stroke-width="2" stroke-linecap="round"/></svg>`,
  ItemTag: `<svg class="tag-icon-svg" viewBox="0 0 24 24"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" stroke-width="1.8"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12" stroke-width="1.8"/></svg>`
};

export function renderTagIcon(tagType) {
  if (state.settings.icons[tagType]) {
    return `<img src="${escapeHtml(state.settings.icons[tagType])}" class="tag-icon-svg" alt="${tagType}">`;
  }
  return ICONS[tagType] || '';
}

export const state = {
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
  batchAdjustments: {},
  invSortCol: 'skuNo',
  invSortDir: 'ASC',
  txSortCol: 'timestamp',
  txSortDir: 'DESC',
  txClusterPicklist: false,
  picklists: [],
  templates: [],
  homeSubtab: 'TODAY',
  historySelectedDate: '',
  showCompletedToday: false,
  settings: {
    icons: { AreaTag: null, ShelfTag: null, ItemTag: null },
    taskTimeoutMinutes: 10
  }
};