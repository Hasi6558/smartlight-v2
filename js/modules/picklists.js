import { $, state, escapeHtml, formatDateTime } from '../state.js';
import { publishMqttViaServer, savePicklistsToStorage, saveTemplatesToStorage, loadInventoryData, loadTransactionsData } from '../api.js';
import { getCascadeActivationSet } from './Lightcontrol.js';
import { confirmDialog } from '../UI/modals.js';

const TAG_TOPIC = '/estation/7301A67/recv';
const LIST_COLOR_POOL = [1, 2, 3, 4, 5, 6, 7];
const colorLocks = {};
let clDraft = { type: 'PICKLIST', orderNo: '', listNo: '', items: [] };
let clScannedSku = null;
const collapsedLists = new Set();
let editingListUid = null;
let editingTemplateUid = null;

export function allocateListColor() {
  const now = Date.now();
  const available = LIST_COLOR_POOL.filter(c => !colorLocks[c] || (colorLocks[c] !== 'inuse' && (now - colorLocks[c]) >= 30000));
  if (!available.length) return null;
  const chosen = available[Math.floor(Math.random() * available.length)];
  colorLocks[chosen] = 'inuse';
  return chosen;
}

export function releaseListColor(color) { if (color) colorLocks[color] = Date.now(); }

export function renderPicklists() {
  const container = $('listsContainer');
  if (!container) return;
  const today = new Date().toISOString().slice(0, 10);
  let lists = state.picklists;
  if (state.homeSubtab === 'TODAY') {
    lists = lists.filter(list => (list.createdAt || '').slice(0, 10) === today);
    if (!state.showCompletedToday) {
      lists = lists.filter(list => list.status === 'PENDING' || list.status === 'ACTIVE');
    }
  } else if (state.historySelectedDate) {
    lists = lists.filter(list => (list.createdAt || '').slice(0, 10) === state.historySelectedDate);
  } else {
    lists = lists.filter(list => (list.createdAt || '').slice(0, 10) !== today);
  }

  const completedToggle = $('btnToggleCompletedToday');
  if (completedToggle) {
    completedToggle.style.display = state.homeSubtab === 'TODAY' ? 'inline-block' : 'none';
    completedToggle.textContent = state.showCompletedToday ? 'Hide Completed/Cancelled' : 'Show Completed/Cancelled';
    completedToggle.className = state.showCompletedToday ? 'btn-sm btn-accent' : 'btn-sm btn-ghost';
  }
  if (!lists.length) {
    const message = state.homeSubtab === 'TODAY'
      ? (state.showCompletedToday ? 'No Picklists or Putaway Lists created today.' : "No active or pending tasks for today. Click 'Show Completed/Cancelled' to view finished tasks.")
      : 'No historical Picklists or Putaway Lists found for the selected date.';
    container.innerHTML = `<div class="empty-strip-hint">${message}</div>`;
    return;
  }

  container.innerHTML = lists.map(list => `
    <div class="list-card status-${list.status.toLowerCase()}">
      <div class="list-card-head" data-list-toggle="${list.uid}">
        <span class="list-card-chevron">${collapsedLists.has(list.uid) ? '›' : '⌄'}</span>
        <span class="list-type-badge ${list.type}">${list.type}</span>
        <div class="list-card-ids"><strong>${escapeHtml(list.listNo)}</strong> (${escapeHtml(list.orderNo)})</div>
        <span class="list-status-badge ${list.status}">${list.status}</span>
        <div class="list-card-actions">
          <button class="btn-sm btn-view-more" data-list-view="${list.uid}" type="button">View More</button>
          ${list.status === 'PENDING' ? `<button class="btn-sm btn-accent" data-list-activate="${list.uid}">Activate</button>` : ''}
          ${list.status === 'ACTIVE' ? `<button class="btn-sm btn-primary" data-list-complete="${list.uid}">Complete</button>` : ''}
          <button class="btn-sm btn-danger" data-list-delete="${list.uid}" type="button">Delete</button>
        </div>
      </div>
      <div class="list-card-body expandable-panel ${collapsedLists.has(list.uid) ? '' : 'open'}">
        <div class="expandable-inner">
        ${list.items.map(item => `<div class="list-item-row"><div class="list-item-meta"><span class="sku">${escapeHtml(item.skuNo)}</span><span class="label">${escapeHtml(item.itemLabel)}</span></div><span class="list-item-meta"><span class="desc">${escapeHtml(item.description || '—')}</span><span class="loc">${escapeHtml(item.location || '—')}</span></span><span class="list-item-qty">${item.quantity}</span></div>`).join('')}
        </div>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('[data-list-activate]').forEach(b => b.addEventListener('click', () => activateList(b.dataset.listActivate)));
  container.querySelectorAll('[data-list-complete]').forEach(b => b.addEventListener('click', () => finishList(b.dataset.listComplete, true)));
  container.querySelectorAll('[data-list-view]').forEach(b => b.addEventListener('click', event => {
    event.stopPropagation();
    openListViewModal(state.picklists.find(list => list.uid === b.dataset.listView));
  }));
  container.querySelectorAll('[data-list-delete]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const uid = button.dataset.listDelete;
    const list = state.picklists.find(item => item.uid === uid);
    if (!list) return;
    confirmDialog('Delete List', `Are you sure you want to delete ${list.listNo}?`, () => {
      state.picklists = state.picklists.filter(item => item.uid !== uid);
      savePicklistsToStorage();
      renderPicklists();
    });
  }));
  container.querySelectorAll('[data-list-toggle]').forEach(head => head.addEventListener('click', event => {
    if (event.target.closest('button')) return;
    const uid = head.dataset.listToggle;
    const body = head.nextElementSibling;
    const collapsed = collapsedLists.has(uid);
    if (collapsed) {
      collapsedLists.delete(uid);
      body?.classList.add('open');
    } else {
      collapsedLists.add(uid);
      body?.classList.remove('open');
    }
    const chevron = head.querySelector('.list-card-chevron');
    if (chevron) chevron.textContent = collapsed ? '⌄' : '›';
  }));
}

export function renderTemplates() {
  const container = $('templatesContainer');
  if (!container) return;
  if (!state.templates.length) {
    container.innerHTML = '<div class="empty-strip-hint">No templates saved yet.</div>';
    return;
  }
  container.innerHTML = state.templates.map((template, index) => `
    <div class="template-card">
      <button class="template-card-head" type="button" data-template-index="${index}" aria-expanded="false">
        <span class="list-card-chevron">›</span>
        <span class="list-type-badge ${template.type}">${template.type}</span>
        <span>${escapeHtml(template.name)}</span>
      </button>
      <div class="template-card-body" hidden>
        <div class="template-card-actions">
          <button class="btn-sm btn-primary" data-template-add="${index}" type="button">Add to Today's List</button>
          <button class="btn-sm btn-ghost" data-template-view="${index}" type="button">View More</button>
          <button class="btn-sm btn-ghost" data-template-edit="${index}" type="button">Edit</button>
          <button class="btn-sm btn-danger" data-template-delete="${index}" type="button">Delete</button>
        </div>
        ${template.items.map(item => `<div class="list-item-row"><div class="list-item-meta"><span class="sku">${escapeHtml(item.skuNo)}</span><span class="label">${escapeHtml(item.itemLabel)}</span></div><span class="list-item-meta"><span class="desc">${escapeHtml(item.description || '—')}</span></span><span class="list-item-qty">${item.quantity}</span></div>`).join('')}
      </div>
    </div>
  `).join('');
  container.querySelectorAll('[data-template-index]').forEach(button => button.addEventListener('click', () => {
    const body = button.nextElementSibling;
    const expanded = !body.hidden;
    body.hidden = expanded;
    button.setAttribute('aria-expanded', String(!expanded));
    button.querySelector('.list-card-chevron').textContent = expanded ? '›' : '⌄';
  }));
  container.querySelectorAll('[data-template-add]').forEach(button => button.addEventListener('click', () => addTemplateToToday(state.templates[button.dataset.templateAdd])));
  container.querySelectorAll('[data-template-view]').forEach(button => button.addEventListener('click', () => openListViewModal(state.templates[button.dataset.templateView])));
  container.querySelectorAll('[data-template-edit]').forEach(button => button.addEventListener('click', () => openCreateListModal(state.templates[button.dataset.templateEdit].type, state.templates[button.dataset.templateEdit])));
  container.querySelectorAll('[data-template-delete]').forEach(button => button.addEventListener('click', () => {
    const index = Number(button.dataset.templateDelete);
    const template = state.templates[index];
    confirmDialog('Delete Template', `Are you sure you want to delete ${template.name}?`, async () => {
      state.templates.splice(index, 1);
      await saveTemplatesToStorage();
      renderTemplates();
    });
  }));
}

export async function openCreateListModal(type, editSource = null) {
  editingListUid = editSource?.uid || null;
  editingTemplateUid = editSource && state.templates.some(template => template.uid === editSource.uid) ? editSource.uid : null;
  clDraft = editSource ? { type, orderNo: editSource.orderNo || '', listNo: editSource.listNo || editSource.name || '', items: editSource.items.map(item => ({ ...item })) } : { type, orderNo: '', listNo: '', items: [] };
  if ($('clModalTitle')) $('clModalTitle').textContent = editingListUid ? (type === 'PUTAWAY' ? 'Edit Putaway List' : 'Edit Picklist') : (type === 'PUTAWAY' ? 'Create Putaway List' : 'Create Picklist');
  if ($('clOrderNo')) $('clOrderNo').value = '';
  if ($('clListNo')) $('clListNo').value = clDraft.listNo || 'Loading…';
  
  clScannedSku = null;
  if ($('clSkuInput')) $('clSkuInput').value = '';
  if ($('clItemSearch')) $('clItemSearch').value = '';
  if ($('clSkuSelect')) populateClSkuSelect('');
  if ($('clItemPreview')) $('clItemPreview').textContent = 'The item details will appear after a valid scan.';
  renderClItemsTable();
  $('createListModal')?.classList.add('active');
  focusScanInput();

  if (editingListUid) {
    $('clListNo').value = clDraft.listNo;
    focusScanInput();
    return;
  }
  try {
    const res = await fetch(`/api/running-numbers/next?listType=${type}`);
    if (res.ok) {
      const data = await res.json();
      clDraft.orderNo = data.orderNo;
      clDraft.listNo = data.listNo;
      if ($('clListNo')) $('clListNo').value = data.listNo;
    }

  } catch (e) {}
  focusScanInput();
}

function focusScanInput() {
  setTimeout(() => $('clSkuInput')?.focus(), 50);
}

function populateClSkuSelect(filter = '') {
  const select = $('clSkuSelect');
  if (!select) return;
  const query = filter.toLowerCase();
  const matches = state.skus.filter(s => `${s.skuNo} ${s.itemLabel || ''}`.toLowerCase().includes(query));
  select.innerHTML = '<option value="">Select a matching item...</option>' + matches.map(s => `<option value="${escapeHtml(s.skuNo)}">${escapeHtml(s.skuNo)} — ${escapeHtml(s.itemLabel || '')}</option>`).join('');
}

function renderClItemsTable() {
  const tbody = $('clItemsTableBody');
  if (!tbody) return;
  if (!clDraft.items.length) { tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No items added yet.</td></tr>`; return; }

  tbody.innerHTML = clDraft.items.map((it, idx) => `
    <tr>
      <td style="font-weight:700; color:var(--cyan);">${escapeHtml(it.skuNo)}</td>
      <td>${escapeHtml(it.itemLabel)}</td>
      <td>${escapeHtml(it.description || '—')}</td>
      <td>${escapeHtml(it.location || '—')}</td>
      <td style="text-align:center;"><input class="cl-existing-qty" data-cl-qty="${idx}" type="number" min="1" inputmode="numeric" value="${it.quantity}" style="width:58px; text-align:center;"></td>
      <td style="text-align:center;"><button class="btn-sm btn-danger" data-cl-remove="${idx}">✕</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-cl-remove]').forEach(b => b.addEventListener('click', () => {
    clDraft.items.splice(parseInt(b.dataset.clRemove, 10), 1);
    renderClItemsTable();
  }));
  tbody.querySelectorAll('[data-cl-qty]').forEach(input => input.addEventListener('change', () => {
    clDraft.items[Number(input.dataset.clQty)].quantity = Math.max(1, parseInt(input.value, 10) || 1);
  }));
}

function openListViewModal(list) {
  if (!list) return;
  const items = list.items || [];
  if ($('clListViewTitle')) $('clListViewTitle').textContent = `${list.type === 'PUTAWAY' ? 'Putaway List' : 'Picklist'} · ${list.listNo || list.name}`;
  if ($('clListViewDetails')) $('clListViewDetails').innerHTML = `<div class="hint" style="margin-bottom:12px;">${escapeHtml(list.orderNo ? `Order: ${list.orderNo}` : '')}</div>${items.map(item => {
    const sku = state.skus.find(s => s.skuNo === item.skuNo);
    const image = item.productImage || sku?.productImage;
    return `<div class="list-view-item">${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(item.itemLabel || item.skuNo)}">` : '<div class="list-view-no-image">No image</div>'}<div class="list-item-meta"><span class="sku">${escapeHtml(item.skuNo)}</span><span class="label">${escapeHtml(item.itemLabel || sku?.itemLabel || '')}</span></div><strong class="list-item-qty">${item.quantity}</strong></div>`;
  }).join('')}`;
  $('clListViewModal')?.classList.add('active');
}

async function addTemplateToToday(template) {
  const res = await fetch(`/api/running-numbers/next?listType=${template.type}`);
  if (!res.ok) { alert('Unable to generate list numbers.'); return; }
  const numbers = await res.json();
  state.picklists.unshift({ uid: 'list_' + Date.now(), type: template.type, orderNo: numbers.orderNo, listNo: numbers.listNo, status: 'PENDING', items: template.items.map(item => ({ ...item })), createdAt: new Date().toISOString() });
  await savePicklistsToStorage();
  renderPicklists();
}

export async function activateList(uid) {
  const list = state.picklists.find(l => l.uid === uid);
  if (!list || list.status !== 'PENDING') return;

  const directTagIds = [...new Set(list.items.map(i => i.tagBind).filter(Boolean))];
  if (!directTagIds.length) { alert('No tags bound to items in this list.'); return; }

  const color = allocateListColor();
  if (color === null) { alert('All colors currently in use.'); return; }

  const targetTagsMap = new Map();
  directTagIds.forEach(tagId => {
    const startTag = state.tags.find(t => t.tagId === tagId);
    if (startTag) getCascadeActivationSet(startTag).forEach(node => targetTagsMap.set(node.tagId, node));
  });

  const items = Array.from(targetTagsMap.values()).map(tag => ({ TagID: tag.tagId, Beep: true, Color: color, Flashing: true }));
  const ok = await publishMqttViaServer(TAG_TOPIC, { Time: 5, Items: items, Sequence: 26, Code: 131, Token: "" });
  if (!ok) { releaseListColor(color); return; }

  list.status = 'ACTIVE';
  list.color = color;
  list.tagIds = Array.from(targetTagsMap.keys());
  savePicklistsToStorage();
  renderPicklists();
}

export async function finishList(uid, completed) {
  const list = state.picklists.find(l => l.uid === uid);
  if (!list || list.status !== 'ACTIVE') return;

  if (list.tagIds?.length) {
    const stopItems = list.tagIds.map(tagId => ({ TagID: tagId, Beep: false, Color: 0, Flashing: false }));
    await publishMqttViaServer(TAG_TOPIC, { Time: 5, Items: stopItems, Sequence: 26, Code: 131, Token: "" });
  }

  releaseListColor(list.color);

  if (completed) {
    const sign = list.type === 'PUTAWAY' ? 1 : -1;
    try {
      await fetch('/api/inventory/commit-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNo: list.orderNo, listNo: list.listNo, items: list.items.map(i => ({ skuNo: i.skuNo, quantityDelta: sign * i.quantity })) })
      });
      await loadInventoryData();
      await loadTransactionsData();
    } catch(e) {}
  }

  list.status = completed ? 'COMPLETED' : 'CANCELLED';
  list.completedAt = new Date().toISOString();
  savePicklistsToStorage();
  renderPicklists();
}

export function checkPicklistTimeouts() {
  const timeoutMs = (state.settings.taskTimeoutMinutes || 10) * 60 * 1000;
  const now = Date.now();
  state.picklists.forEach(l => {
    if (l.status === 'ACTIVE' && l.activatedAt && (now - new Date(l.activatedAt).getTime() >= timeoutMs)) {
      finishList(l.uid, false);
    }
  });
}

export function initPicklistListeners() {
  $('btnOpenCreatePicklist')?.addEventListener('click', () => openCreateListModal('PICKLIST'));
  $('btnOpenCreatePutaway')?.addEventListener('click', () => openCreateListModal('PUTAWAY'));
  $('clCloseBtn')?.addEventListener('click', () => $('createListModal')?.classList.remove('active'));
  $('clCancelBtn')?.addEventListener('click', () => $('createListModal')?.classList.remove('active'));

  $('btnSubtabToday')?.addEventListener('click', () => {
    state.homeSubtab = 'TODAY';
    state.historySelectedDate = '';
    $('btnSubtabToday').className = 'btn-sm btn-accent';
    $('btnSubtabHistory').className = 'btn-sm btn-ghost';
    $('historyDateFilterWrap').style.display = 'none';
    renderPicklists();
  });
  $('btnSubtabHistory')?.addEventListener('click', () => {
    state.homeSubtab = 'HISTORY';
    $('btnSubtabToday').className = 'btn-sm btn-ghost';
    $('btnSubtabHistory').className = 'btn-sm btn-accent';
    $('historyDateFilterWrap').style.display = 'flex';
    renderPicklists();
  });
  $('btnToggleCompletedToday')?.addEventListener('click', () => {
    state.showCompletedToday = !state.showCompletedToday;
    renderPicklists();
  });
  $('historyDateInput')?.addEventListener('change', event => {
    state.historySelectedDate = event.target.value;
    renderPicklists();
  });
  $('btnResetHistoryDate')?.addEventListener('click', () => {
    state.historySelectedDate = '';
    $('historyDateInput').value = '';
    renderPicklists();
  });

  $('clQtyMinus')?.addEventListener('click', () => { if ($('clQtyInput')) $('clQtyInput').value = Math.max(1, (parseInt($('clQtyInput').value, 10) || 1) - 1); });
  $('clQtyPlus')?.addEventListener('click', () => { if ($('clQtyInput')) $('clQtyInput').value = (parseInt($('clQtyInput').value, 10) || 1) + 1; });

  const scanSku = () => {
    const skuNo = $('clSkuInput')?.value.trim();
    const sku = state.skus.find(s => s.skuNo === skuNo);
    if (!sku) {
      if ($('clItemPreview')) $('clItemPreview').textContent = 'No matching SKU found in the database.';
      return;
    }
    clScannedSku = sku;
    if ($('clItemConfirmDetails')) $('clItemConfirmDetails').innerHTML = `${sku.productImage ? `<img src="${escapeHtml(sku.productImage)}" alt="${escapeHtml(sku.itemLabel || sku.skuNo)}" style="width:100%; max-height:150px; object-fit:contain; background:#0E1316; border:1px solid var(--line); border-radius:6px; margin-bottom:10px;">` : '<div class="hint" style="margin-bottom:10px;">No image available.</div>'}<strong style="color:var(--cyan);">${escapeHtml(sku.skuNo)}</strong><div style="font-weight:600; margin-top:6px;">${escapeHtml(sku.itemLabel)}</div><div class="hint" style="margin-top:4px;">${escapeHtml(sku.description || 'No description')}</div>`;
    if ($('clQtyInput')) $('clQtyInput').value = 1;
    $('clItemModal')?.classList.add('active');
    setTimeout(() => $('clQtyInput')?.focus(), 50);
  };
  $('clSkuInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); scanSku(); }
  });
  $('clSkuInput')?.addEventListener('change', scanSku);
  $('clItemSearch')?.addEventListener('input', event => populateClSkuSelect(event.target.value));
  $('clSkuSelect')?.addEventListener('change', event => {
    const sku = state.skus.find(item => item.skuNo === event.target.value);
    if (!sku) return;
    if ($('clSkuInput')) $('clSkuInput').value = sku.skuNo;
    scanSku();
  });
  $('clItemCloseBtn')?.addEventListener('click', () => $('clItemModal')?.classList.remove('active'));
  $('clAddItemBtn')?.addEventListener('click', () => {
    if (!clScannedSku) return;
    const qty = Math.max(1, parseInt($('clQtyInput')?.value, 10) || 1);
    const existing = clDraft.items.find(item => item.skuNo === clScannedSku.skuNo);
    if (existing) existing.quantity += qty;
    else clDraft.items.push({ skuNo: clScannedSku.skuNo, itemLabel: clScannedSku.itemLabel, description: clScannedSku.description, tagBind: clScannedSku.tagBind, productImage: clScannedSku.productImage || '', quantity: qty });
    renderClItemsTable();
    $('clItemModal')?.classList.remove('active');
    if ($('clSkuInput')) { $('clSkuInput').value = ''; focusScanInput(); }
    if ($('clItemSearch')) $('clItemSearch').value = '';
    populateClSkuSelect('');
    if ($('clItemPreview')) $('clItemPreview').textContent = 'Ready for the next scan.';
    clScannedSku = null;
  });

  $('clSkuInput')?.addEventListener('paste', () => setTimeout(scanSku, 0));
  $('clTemplateBtn')?.addEventListener('click', () => {
    if (!clDraft.items.length) { alert('Add at least one item.'); return; }
    if ($('clTemplateNameInput')) $('clTemplateNameInput').value = '';
    $('clTemplateNameModal')?.classList.add('active');
  });
  $('clTemplateNameCloseBtn')?.addEventListener('click', () => $('clTemplateNameModal')?.classList.remove('active'));
  $('clTemplateNameCancelBtn')?.addEventListener('click', () => $('clTemplateNameModal')?.classList.remove('active'));
  $('clTemplateNameConfirmBtn')?.addEventListener('click', async () => {
    const enteredName = $('clTemplateNameInput')?.value || '';
    state.templates.unshift({ uid: 'template_' + Date.now(), name: enteredName.trim() || clDraft.listNo, type: clDraft.type, items: [...clDraft.items], createdAt: new Date().toISOString() });
    try {
      await saveTemplatesToStorage();
      renderTemplates();
      $('clTemplateNameModal')?.classList.remove('active');
      alert('List template saved.');
    } catch (error) {
      state.templates.shift();
      alert(`Unable to save list template: ${error.message}`);
    }
  });
  $('clSaveBtn')?.addEventListener('click', () => {
    if (!clDraft.items.length) { alert('Add at least one item.'); return; }

    const orderNo = $('clOrderNo')?.value.trim() || clDraft.orderNo;
    if (editingTemplateUid) {
      const template = state.templates.find(item => item.uid === editingTemplateUid);
      if (template) Object.assign(template, { type: clDraft.type, items: [...clDraft.items] });
      saveTemplatesToStorage();
      renderTemplates();
    } else if (editingListUid) {
      const existing = state.picklists.find(list => list.uid === editingListUid);
      if (existing) Object.assign(existing, { type: clDraft.type, orderNo, listNo: clDraft.listNo, items: [...clDraft.items] });
    } else {
      state.picklists.unshift({
        uid: 'list_' + Date.now(), type: clDraft.type, orderNo, listNo: clDraft.listNo,
        status: 'PENDING', items: [...clDraft.items], createdAt: new Date().toISOString()
      });
    }

    savePicklistsToStorage();
    editingListUid = null;
    editingTemplateUid = null;
    $('createListModal')?.classList.remove('active');
    renderPicklists();
  });
  $('clListViewCloseBtn')?.addEventListener('click', () => $('clListViewModal')?.classList.remove('active'));
  $('btnToggleTemplates')?.addEventListener('click', () => {
    const drawer = $('templateDrawer');
    const open = drawer?.classList.toggle('active');
    $('btnToggleTemplates')?.setAttribute('aria-expanded', String(!!open));
    drawer?.setAttribute('aria-hidden', String(!open));
  });
  $('btnCloseTemplates')?.addEventListener('click', () => {
    $('templateDrawer')?.classList.remove('active');
    $('btnToggleTemplates')?.setAttribute('aria-expanded', 'false');
    $('templateDrawer')?.setAttribute('aria-hidden', 'true');
  });
}