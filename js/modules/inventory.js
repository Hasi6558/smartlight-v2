import { $, state, escapeHtml } from '../state.js';
import { confirmDialog, openAttachModal } from '../UI/modals.js';
import { saveSkusToStorage, loadInventoryData, loadTransactionsData } from '../api.js';

let editingSkuNo = null;
let currentSkuImageBase64 = '';
let currentEditingStockSku = null;

export function exportDataToExcel(data, fileName) {
  if (typeof XLSX === 'undefined') { alert("SheetJS library is loading. Please try again."); return; }
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, `${fileName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function openSkuDetailModal(skuNo) {
  const sku = state.skus.find(s => s.skuNo === skuNo) || state.inventory.find(i => i.skuNo === skuNo);
  if (!sku) return;

  if ($('skuDetailModalTitle')) $('skuDetailModalTitle').textContent = `SKU Details · ${sku.skuNo}`;
  if ($('skuDetailNo')) $('skuDetailNo').textContent = sku.skuNo;
  if ($('skuDetailLabel')) $('skuDetailLabel').textContent = sku.itemLabel || '—';
  if ($('skuDetailSupplier')) $('skuDetailSupplier').textContent = sku.supplierCustomer || '—';
  if ($('skuDetailTagBind')) $('skuDetailTagBind').textContent = sku.tagBind || '—';
  if ($('skuDetailDate')) $('skuDetailDate').textContent = sku.dateAdded || '—';
  if ($('skuDetailDesc')) $('skuDetailDesc').textContent = sku.description || 'No extended description available.';

  const imgWrap = $('skuDetailImageWrap');
  if (imgWrap) {
    if (sku.productImage) {
      imgWrap.innerHTML = `<img src="${escapeHtml(sku.productImage)}" style="max-width:100%; max-height:280px; object-fit:contain;">`;
    } else {
      imgWrap.innerHTML = `<div style="font-size:12px; color:var(--text-faint);">No Product Image Uploaded</div>`;
    }
  }

  $('skuDetailModal')?.classList.add('active');
}

export function toggleSkuForm(show, editSku = null) {
  if (state.skuConfigLocked && show) return;
  const modal = $('skuFormModal');
  if (!modal) return;
  const isCurrentlyOpen = modal.classList.contains('active');
  if (show === undefined) show = !isCurrentlyOpen;

  if (!show) {
    modal.classList.remove('active');
    editingSkuNo = null;
    currentSkuImageBase64 = '';
    resetSkuForm();
    return;
  }

  modal.classList.add('active');
  if (editSku) {
    editingSkuNo = editSku.skuNo;
    if ($('skuFormTitle')) $('skuFormTitle').textContent = `Edit SKU Item (${editSku.skuNo})`;
    if ($('skuSaveBtn')) $('skuSaveBtn').textContent = 'SAVE SKU CHANGES';

    if ($('skuNo')) $('skuNo').value = editSku.skuNo;
    if ($('skuItemLabel')) $('skuItemLabel').value = editSku.itemLabel || '';
    if ($('skuSupplierCustomer')) $('skuSupplierCustomer').value = editSku.supplierCustomer || '';
    if ($('skuTagBind')) $('skuTagBind').value = editSku.tagBind || '';
    if ($('skuDescription')) $('skuDescription').value = editSku.description || '';
    currentSkuImageBase64 = editSku.productImage || '';
    updateSkuImgPreview();
  } else {
    editingSkuNo = null;
    if ($('skuFormTitle')) $('skuFormTitle').textContent = 'Add SKU Item';
    if ($('skuSaveBtn')) $('skuSaveBtn').textContent = 'SAVE SKU ITEM';
    resetSkuForm();
  }
}

function resetSkuForm() {
  if ($('skuNo')) $('skuNo').value = '';
  if ($('skuItemLabel')) $('skuItemLabel').value = '';
  if ($('skuSupplierCustomer')) $('skuSupplierCustomer').value = '';
  if ($('skuTagBind')) $('skuTagBind').value = '';
  if ($('skuDescription')) $('skuDescription').value = '';
  currentSkuImageBase64 = '';
  updateSkuImgPreview();
}

function updateSkuImgPreview() {
  const box = $('skuImgPreviewBox');
  if (box) {
    if (currentSkuImageBase64) {
      box.innerHTML = `<img src="${escapeHtml(currentSkuImageBase64)}" style="width:100%;height:100%;object-fit:cover;">`;
    } else {
      box.innerHTML = 'No image';
    }
  }
}

function getFilteredSkus() {
  const fSkuNo = $('filterSkuNo')?.value.trim().toLowerCase() || '';
  const fLabel = $('filterSkuLabel')?.value.trim().toLowerCase() || '';
  const fDesc = $('filterSkuDesc')?.value.trim().toLowerCase() || '';
  const fSupplier = $('filterSkuSupplier')?.value.trim().toLowerCase() || '';
  const fTag = $('filterSkuTagBind')?.value.trim().toLowerCase() || '';
  const fDate = $('filterSkuDate')?.value.trim().toLowerCase() || '';

  const rangeMode = $('filterSkuDateRange')?.value || 'ALL';
  const tagBindMode = $('filterSkuTagBindSelect')?.value || 'ALL';

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

function updateSkuBatchBtnState() {
  const btn = $('batchDeleteSkusBtn');
  if (btn) btn.disabled = state.skuConfigLocked || state.selectedSkuNos.size === 0;
}

export function renderSkuTable() {
  const tbody = $('skuTableBody');
  if (!tbody) return;
  const filtered = getFilteredSkus();

  updateSkuBatchBtnState();

  if (!filtered.length) { tbody.innerHTML = '<tr class="empty-row"><td colspan="9">No matching SKU items found.</td></tr>'; return; }

  tbody.innerHTML = filtered.map(s => {
    const isSelected = state.selectedSkuNos.has(s.skuNo);
    return `
      <tr>
        <td style="text-align:center;"><input type="checkbox" class="sku-select-cb" data-skuno="${escapeHtml(s.skuNo)}" ${isSelected ? 'checked' : ''}></td>
        <td>${s.productImage ? `<img src="${escapeHtml(s.productImage)}" class="sku-thumb-btn" data-view-sku="${escapeHtml(s.skuNo)}" style="width:36px; height:36px; object-fit:cover; border-radius:4px; cursor:pointer;">` : 'No img'}</td>
        <td style="font-weight:700; color:var(--cyan);">${escapeHtml(s.skuNo)}</td>
        <td style="font-weight:600;">${escapeHtml(s.itemLabel)}</td>
        <td style="color:var(--text-dim);">${escapeHtml(s.description || '—')}</td>
        <td style="color:var(--text-dim);">${escapeHtml(s.supplierCustomer || '—')}</td>
        <td style="font-weight:600; color:var(--amber);">${escapeHtml(s.tagBind || '—')}</td>
        <td style="color:var(--text-faint); font-size:11px;">${escapeHtml(s.dateAdded)}</td>
        <td style="text-align:right;">
          <button class="btn-sm btn-view-more" data-view-sku="${escapeHtml(s.skuNo)}" type="button">View More</button>
          ${!state.skuConfigLocked ? `<button class="btn-sm btn-ghost" data-edit-sku="${escapeHtml(s.skuNo)}">Edit</button><button class="btn-sm btn-ghost" data-delete-sku="${escapeHtml(s.skuNo)}" style="color:var(--red);">Delete</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.sku-select-cb').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const skuNo = e.target.dataset.skuno;
      if (e.target.checked) state.selectedSkuNos.add(skuNo);
      else state.selectedSkuNos.delete(skuNo);
      updateSkuBatchBtnState();
    });
  });

  tbody.querySelectorAll('[data-view-sku]').forEach(btn => btn.addEventListener('click', () => openSkuDetailModal(btn.dataset.viewSku)));
  tbody.querySelectorAll('[data-edit-sku]').forEach(btn => btn.addEventListener('click', () => {
    const sku = state.skus.find(s => s.skuNo === btn.dataset.editSku);
    if (sku) toggleSkuForm(true, sku);
  }));
  tbody.querySelectorAll('[data-delete-sku]').forEach(btn => btn.addEventListener('click', () => {
    confirmDialog("Delete SKU Item", `Are you sure you want to delete SKU Item: ${btn.dataset.deleteSku}?`, () => {
      state.skus = state.skus.filter(s => s.skuNo !== btn.dataset.deleteSku);
      state.selectedSkuNos.delete(btn.dataset.deleteSku);
      saveSkusToStorage();
      renderSkuTable();
    });
  }));
}

export function renderInventoryTable() {
  const tbody = $('inventoryTableBody');
  if (!tbody) return;
  if (!state.inventory.length) { tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No matching inventory items found.</td></tr>`; return; }

  tbody.innerHTML = state.inventory.map(item => `
    <tr>
      <td>${item.productImage ? `<img src="${escapeHtml(item.productImage)}" class="sku-thumb-btn" data-view-sku="${escapeHtml(item.skuNo)}" style="width:36px; height:36px; object-fit:cover; cursor:pointer;">` : 'No img'}</td>
      <td style="font-weight:700; color:var(--cyan);">${escapeHtml(item.skuNo)}</td>
      <td style="font-weight:600;">${escapeHtml(item.itemLabel)}</td>
      <td style="color:var(--text-dim);">${escapeHtml(item.description || '—')}</td>
      <td style="color:var(--text-dim);">${escapeHtml(item.supplierCustomer || '—')}</td>
      <td style="text-align:center;">${state.isBatchEditingStock ? `
        <div style="display:flex; flex-direction:column; align-items:center; gap:4px;">
          <div style="font-size:11px; color:var(--text-dim);">Current: <span class="stock-qty-badge">${item.stock} pcs</span></div>
          <div style="display:flex; align-items:center; justify-content:center; gap:4px;">
            <button class="btn-sm btn-ghost batch-btn-minus" data-skuno="${escapeHtml(item.skuNo)}" type="button" style="padding:2px 8px; font-weight:bold; font-size:13px;">-</button>
            <input type="number" class="batch-adj-input" data-skuno="${escapeHtml(item.skuNo)}" value="${state.batchAdjustments[item.skuNo] || 0}" style="width:60px; text-align:center; padding:3px 4px; font-size:11.5px;">
            <button class="btn-sm btn-ghost batch-btn-plus" data-skuno="${escapeHtml(item.skuNo)}" type="button" style="padding:2px 8px; font-weight:bold; font-size:13px;">+</button>
          </div>
          <div style="font-size:11px; font-weight:700; color:${Number(item.stock) + (state.batchAdjustments[item.skuNo] || 0) <= 0 ? 'var(--red)' : 'var(--green)'};">
          Target: ${Number(item.stock) + (state.batchAdjustments[item.skuNo] || 0)} pcs
          </div>
        </div>
      ` : `<span class="stock-qty-badge">${item.stock} pcs</span>`}</td>
      <td style="text-align:right;">
        <button class="btn-sm btn-view-more" data-view-sku="${escapeHtml(item.skuNo)}">View More</button>
        ${!state.isBatchEditingStock ? `<button class="btn-sm btn-primary" data-edit-stock="${escapeHtml(item.skuNo)}">Edit Stock</button>` : ''}
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-view-sku]').forEach(btn => btn.addEventListener('click', () => openSkuDetailModal(btn.dataset.viewSku)));
  tbody.querySelectorAll('[data-edit-stock]').forEach(btn => btn.addEventListener('click', () => openEditStockModal(btn.dataset.editStock)));
  tbody.querySelectorAll('.batch-btn-minus').forEach(btn => btn.addEventListener('click', () => {
    const skuNo = btn.dataset.skuno;
    state.batchAdjustments[skuNo] = (state.batchAdjustments[skuNo] || 0) - 1;
    renderInventoryTable();
  }));
  tbody.querySelectorAll('.batch-btn-plus').forEach(btn => btn.addEventListener('click', () => {
    const skuNo = btn.dataset.skuno;
    state.batchAdjustments[skuNo] = (state.batchAdjustments[skuNo] || 0) + 1;
    renderInventoryTable();
  }));
  tbody.querySelectorAll('.batch-adj-input').forEach(input => input.addEventListener('input', () => {
    const skuNo = input.dataset.skuno;
    const value = parseInt(input.value, 10);
    state.batchAdjustments[skuNo] = Number.isNaN(value) ? 0 : value;
  }));
}

export function renderTransactionsTable() {
  const tbody = $('transactionsTableBody');
  if (!tbody) return;
  if (!state.transactions.length) { tbody.innerHTML = `<tr class="empty-row"><td colspan="8">No recorded stock transactions found.</td></tr>`; return; }

  tbody.innerHTML = state.transactions.map(tx => `
    <tr>
      <td style="color:var(--text-faint); font-size:11px;">${escapeHtml(tx.timestamp)}</td>
      <td style="font-weight:700; color:var(--amber);">${escapeHtml(tx.orderNo)}</td>
      <td style="font-weight:600; color:var(--cyan-dim);">${escapeHtml(tx.picklistNo)}</td>
      <td>${tx.productImage ? `<img src="${escapeHtml(tx.productImage)}" class="sku-thumb-btn" data-view-sku="${escapeHtml(tx.skuNo)}" style="width:32px; height:32px; cursor:pointer;">` : 'No img'}</td>
      <td style="font-weight:700; color:var(--cyan);">${escapeHtml(tx.skuNo)}</td>
      <td style="font-weight:600;">${escapeHtml(tx.itemLabel)}</td>
      <td style="color:var(--text-dim);">${escapeHtml(tx.description || '—')}</td>
      <td style="text-align:right;"><span class="qty-pill ${tx.quantity > 0 ? 'add' : 'sub'}">${tx.quantity > 0 ? '+' : ''}${tx.quantity} pcs</span></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-view-sku]').forEach(btn => btn.addEventListener('click', () => openSkuDetailModal(btn.dataset.viewSku)));
}

function openEditStockModal(skuNo) {
  const item = state.inventory.find(i => i.skuNo === skuNo);
  if (!item) return;

  currentEditingStockSku = item;
  if ($('editStockSkuNo')) $('editStockSkuNo').textContent = item.skuNo;
  if ($('editStockLabel')) $('editStockLabel').textContent = item.itemLabel;
  if ($('editStockCurrentQty')) $('editStockCurrentQty').textContent = item.stock;
  if ($('stockQtyInput')) $('stockQtyInput').value = 0;

  updateSingleStockModalPreview();
  $('editStockModal')?.classList.add('active');
}

function updateSingleStockModalPreview() {
  if (!currentEditingStockSku) return;
  const curr = currentEditingStockSku.stock || 0;
  const delta = parseInt($('stockQtyInput')?.value, 10) || 0;
  const proj = curr + delta;
  const projEl = $('editStockProjectedQty');
  if (projEl) {
    projEl.textContent = proj;
    projEl.style.color = proj <= 0 ? 'var(--red)' : 'var(--green)';
  }
}

export function initInventoryListeners() {
  const updateBatchInventoryToolbarUI = () => {
    const isEditing = state.isBatchEditingStock;
    if ($('btnToggleBatchModifyStock')) $('btnToggleBatchModifyStock').style.display = isEditing ? 'none' : '';
    if ($('btnConfirmBatchModifyStock')) $('btnConfirmBatchModifyStock').style.display = isEditing ? '' : 'none';
    if ($('btnCancelBatchModifyStock')) $('btnCancelBatchModifyStock').style.display = isEditing ? '' : 'none';
  };

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

  $('btnConfirmBatchModifyStock')?.addEventListener('click', () => {
    const itemsToAdjust = Object.entries(state.batchAdjustments)
      .map(([skuNo, quantityDelta]) => ({ skuNo, quantityDelta: parseInt(quantityDelta, 10) || 0 }))
      .filter(item => item.quantityDelta !== 0);

    if (!itemsToAdjust.length) {
      alert('No stock changes were made.');
      state.isBatchEditingStock = false;
      state.batchAdjustments = {};
      updateBatchInventoryToolbarUI();
      renderInventoryTable();
      return;
    }

    confirmDialog('Confirm Batch Stock Modification', `Are you sure you want to modify stock for ${itemsToAdjust.length} item(s)?`, async () => {
      try {
        const res = await fetch('/api/inventory/batch-adjust', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: itemsToAdjust })
        });
        if (!res.ok) {
          alert(`Failed batch modification: ${await res.text()}`);
          return;
        }
        state.isBatchEditingStock = false;
        state.batchAdjustments = {};
        updateBatchInventoryToolbarUI();
        await loadInventoryData();
        await loadTransactionsData();
      } catch (error) {
        alert(`Error submitting batch modification: ${error.message}`);
      }
    });
  });
  updateBatchInventoryToolbarUI();

  // Lock SKU Database Button
  $('lockSkuDbBtn')?.addEventListener('click', () => {
    state.skuConfigLocked = !state.skuConfigLocked;
    const btn = $('lockSkuDbBtn');
    if (btn) {
      btn.textContent = state.skuConfigLocked ? ' SKU DB LOCKED' : ' SKU DB UNLOCKED';
      btn.className = state.skuConfigLocked ? 'btn-sm btn-danger' : 'btn-sm btn-ghost';
    }
    if ($('toggleAddSkuBtn')) $('toggleAddSkuBtn').disabled = state.skuConfigLocked;
    renderSkuTable();
  });

  // Export SKU Excel Template
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

  // Import SKU Excel
  $('btnImportSkuExcel')?.addEventListener('click', () => $('importSkuExcelInput')?.click());

  $('importSkuExcelInput')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (typeof XLSX === 'undefined') {
      alert("SheetJS library is loading. Please try again in a moment.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonRows = XLSX.utils.sheet_to_json(worksheet);

        if (!jsonRows || jsonRows.length === 0) {
          alert("The uploaded Excel file appears to be empty.");
          return;
        }

        const fileSkuSet = new Set();
        const fileTagBindSet = new Set();
        const existingSkuSet = new Set(state.skus.map(s => (s.skuNo || '').trim().toLowerCase()));
        const existingTagBindSet = new Set(state.skus.map(s => (s.tagBind || '').trim().toLowerCase()).filter(Boolean));

        const alarms = [];
        const validNewSkus = [];

        jsonRows.forEach((row, idx) => {
          const rowNum = idx + 2;
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

          if (existingSkuSet.has(lowerSku)) {
            alarms.push(`Row ${rowNum}: SKU No '${skuNo}' already exists in Warehouse Database.`);
          }

          if (tagBind && existingTagBindSet.has(lowerTag)) {
            alarms.push(`Row ${rowNum}: Tag Bind '${tagBind}' is already bound to an existing SKU in Database.`);
          }

          validNewSkus.push({
            skuNo, itemLabel, description, supplierCustomer, tagBind,
            dateAdded: new Date().toISOString().slice(0, 10),
            productImage: ''
          });
        });

        if (alarms.length > 0) {
          alert(`🚨 EXCEL IMPORT ALARM DETECTED 🚨\n\nFound ${alarms.length} issue(s):\n• ` + alarms.join('\n• ') + `\n\nImport cancelled.`);
          e.target.value = '';
          return;
        }

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

  // SKU Filters
  ['filterSkuNo', 'filterSkuLabel', 'filterSkuDesc', 'filterSkuSupplier', 'filterSkuTagBind', 'filterSkuDate'].forEach(id => {
    $(id)?.addEventListener('input', () => renderSkuTable());
  });
  $('filterSkuDateRange')?.addEventListener('change', () => renderSkuTable());
  $('filterSkuTagBindSelect')?.addEventListener('change', () => renderSkuTable());

  // Batch Select & Delete SKUs
  $('selectAllSkusCb')?.addEventListener('change', (e) => {
    const visibleSkus = getFilteredSkus();
    if (e.target.checked) visibleSkus.forEach(s => state.selectedSkuNos.add(s.skuNo));
    else visibleSkus.forEach(s => state.selectedSkuNos.delete(s.skuNo));
    renderSkuTable();
  });

  $('batchDeleteSkusBtn')?.addEventListener('click', () => {
    if (state.skuConfigLocked) return;
    const count = state.selectedSkuNos.size;
    if (!count) return;

    confirmDialog("Batch Delete SKUs", `Are you sure you want to delete ${count} selected SKU item(s)?`, () => {
      state.skus = state.skus.filter(s => !state.selectedSkuNos.has(s.skuNo));
      state.selectedSkuNos.clear();
      saveSkusToStorage();
      renderSkuTable();
    });
  });

  // SKU Form Handlers
  $('toggleAddSkuBtn')?.addEventListener('click', () => toggleSkuForm(true));
  $('skuModalCloseBtn')?.addEventListener('click', () => toggleSkuForm(false));
  $('skuCancelBtn')?.addEventListener('click', () => toggleSkuForm(false));
  $('skuClearBtn')?.addEventListener('click', resetSkuForm);

  $('btnUploadSkuImg')?.addEventListener('click', () => $('skuImageInput')?.click());
  $('skuImageInput')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      currentSkuImageBase64 = evt.target.result;
      updateSkuImgPreview();
    };
    reader.readAsDataURL(file);
  });
  $('btnClearSkuImg')?.addEventListener('click', () => { currentSkuImageBase64 = ''; updateSkuImgPreview(); });
  $('btnPickTagForSku')?.addEventListener('click', () => openAttachModal('skuPickTag', null));

  $('skuSaveBtn')?.addEventListener('click', () => {
    const skuNo = $('skuNo')?.value.trim();
    const itemLabel = $('skuItemLabel')?.value.trim();
    if (!skuNo || !itemLabel) { alert("SKU No and Item Label are required."); return; }

    const skuData = {
      skuNo, itemLabel,
      supplierCustomer: $('skuSupplierCustomer')?.value.trim(),
      tagBind: $('skuTagBind')?.value.trim(),
      description: $('skuDescription')?.value.trim(),
      dateAdded: new Date().toISOString().slice(0, 10),
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

  // Stock Adjustment Handlers
  $('editStockModalCloseBtn')?.addEventListener('click', () => $('editStockModal')?.classList.remove('active'));
  $('editStockCancelBtn')?.addEventListener('click', () => $('editStockModal')?.classList.remove('active'));
  $('btnStockQtyMinus')?.addEventListener('click', () => {
    if ($('stockQtyInput')) $('stockQtyInput').value = (parseInt($('stockQtyInput').value, 10) || 0) - 1;
    updateSingleStockModalPreview();
  });
  $('btnStockQtyPlus')?.addEventListener('click', () => {
    if ($('stockQtyInput')) $('stockQtyInput').value = (parseInt($('stockQtyInput').value, 10) || 0) + 1;
    updateSingleStockModalPreview();
  });

  $('editStockConfirmBtn')?.addEventListener('click', async () => {
    if (!currentEditingStockSku) return;
    const delta = parseInt($('stockQtyInput')?.value, 10);
    if (!delta) return;

    confirmDialog("Confirm Stock Adjustment", `Adjust stock by ${delta} pcs?`, async () => {
      try {
        const res = await fetch('/api/inventory/adjust', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skuNo: currentEditingStockSku.skuNo, quantityDelta: delta })
        });
        if (res.ok) {
          $('editStockModal')?.classList.remove('active');
          await loadInventoryData();
          await loadTransactionsData();
        }
      } catch (e) {}
    });
  });

  $('exportInventoryExcelBtn')?.addEventListener('click', () => exportDataToExcel(state.inventory, 'Inventory_Export'));
  $('exportTransactionsExcelBtn')?.addEventListener('click', () => exportDataToExcel(state.transactions, 'Transactions_Export'));
}