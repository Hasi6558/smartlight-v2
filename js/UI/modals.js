import { $, state, escapeHtml } from '../state.js';
import { saveTagsToStorage, saveSkusToStorage } from '../api.js';

let confirmCallback = null;
let attachModalContext = { type: null, parentUid: null, parentId: null, sortDir: 'ASC' };
let targetBindTagId = null;
let scanVideoTrack = null;
let currentScanTargetInput = null;
let scanAnimFrameId = null;

export function confirmDialog(title, message, onConfirm) {
  if ($('confirmModalTitle')) $('confirmModalTitle').textContent = title || 'Confirm Action';
  if ($('confirmModalText')) $('confirmModalText').textContent = message || 'Are you sure you want to proceed?';
  confirmCallback = onConfirm;
  $('confirmModal')?.classList.add('active');
}

export function closeConfirmDialog() {
  $('confirmModal')?.classList.remove('active');
  confirmCallback = null;
}

export function openScanner(targetInputId) {
  currentScanTargetInput = $(targetInputId);
  const modal = $('scannerModal');
  modal?.classList.add('active');
  if ($('scannerStatus')) $('scannerStatus').textContent = 'Initializing camera...';

  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(stream => {
    const video = $('scannerVideo');
    if (video) { video.srcObject = stream; scanVideoTrack = stream.getVideoTracks()[0]; video.play(); }
    if ($('scannerStatus')) $('scannerStatus').textContent = 'Point camera at QR code';

    if ('BarcodeDetector' in window) {
      const detector = new BarcodeDetector();
      const detectLoop = async () => {
        if (!modal.classList.contains('active')) return;
        try {
          const barcodes = await detector.detect(video);
          if (barcodes.length > 0 && currentScanTargetInput) {
            currentScanTargetInput.value = barcodes[0].rawValue;
            closeScanner();
            return;
          }
        } catch (e) {}
        scanAnimFrameId = requestAnimationFrame(detectLoop);
      };
      scanAnimFrameId = requestAnimationFrame(detectLoop);
    }
  }).catch(err => {
    if ($('scannerStatus')) $('scannerStatus').textContent = 'Camera error: ' + err.message;
  });
}

export function closeScanner() {
  if (scanAnimFrameId) cancelAnimationFrame(scanAnimFrameId);
  if (scanVideoTrack) { scanVideoTrack.stop(); scanVideoTrack = null; }
  if ($('scannerVideo')) $('scannerVideo').srcObject = null;
  $('scannerModal')?.classList.remove('active');
}

export function openAttachModal(type, parentUid) {
  attachModalContext.type = type;
  attachModalContext.parentUid = parentUid;

  if (type === 'skuPickTag') {
    if ($('whModalTitle')) $('whModalTitle').textContent = `Select Tag to Bind to SKU`;
  } else {
    const parentTag = state.tags.find(t => t.uid === parentUid);
    if (!parentTag) return;
    attachModalContext.parentId = parentTag.tagId;
    if ($('whModalTitle')) $('whModalTitle').textContent = type === 'shelf' ? `Add Shelf Tag to Area: ${parentTag.tagRef || parentTag.tagId}` : `Add Item Tag to Shelf: ${parentTag.tagRef || parentTag.tagId}`;
  }
  
  if ($('whModalSearch')) $('whModalSearch').value = '';
  $('whAttachModal')?.classList.add('active');
  renderAttachModalList();
}

export function closeAttachModal() { $('whAttachModal')?.classList.remove('active'); }

export function renderAttachModalList() {
  const container = $('whModalListContainer');
  if (!container) return;
  const search = $('whModalSearch')?.value.trim().toLowerCase();
  let candidates = state.tags.filter(t => attachModalContext.type === 'skuPickTag' ? (t.tagType === 'ItemTag' || t.tagType === 'ShelfTag') : (attachModalContext.type === 'shelf' ? t.tagType === 'ShelfTag' : t.tagType === 'ItemTag'));

  if (search) candidates = candidates.filter(t => (t.tagId?.toLowerCase().includes(search) || t.tagRef?.toLowerCase().includes(search)));

  if (!candidates.length) { container.innerHTML = `<div class="empty-strip-hint">No matching tags available.</div>`; return; }

  container.innerHTML = candidates.map(t => `
    <div style="display:flex; align-items:center; justify-content:space-between; padding:10px; background:#0E1316; border:1px solid var(--line); border-radius:6px;">
      <div><strong>${escapeHtml(t.tagRef || t.tagId)}</strong> (${escapeHtml(t.tagId)})</div>
      <button class="btn-sm btn-primary" data-attach-candidate-uid="${t.uid}" data-candidate-tagid="${escapeHtml(t.tagId)}">Select</button>
    </div>
  `).join('');

  container.querySelectorAll('[data-attach-candidate-uid]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (attachModalContext.type === 'skuPickTag') {
        if ($('skuTagBind')) $('skuTagBind').value = btn.dataset.candidateTagid;
      } else {
        const candidate = state.tags.find(t => t.uid === btn.dataset.attachCandidateUid);
        if (candidate) {
          candidate.parentTag = attachModalContext.parentId;
          saveTagsToStorage();
          const { renderWarehouseConfigAnimated } = await import('./animation.js');
          renderWarehouseConfigAnimated();
        }
      }
      closeAttachModal();
    });
  });
}

export function openWhSkuPickerModal(tagId) {
  targetBindTagId = tagId;
  const tag = state.tags.find(t => t.tagId === tagId);
  const tagDisplay = tag && tag.tagRef ? `${tag.tagRef} (${tag.tagId})` : tagId;

  if ($('whSkuPickerTitle')) $('whSkuPickerTitle').textContent = `Bind SKU to Tag: ${tagDisplay}`;
  if ($('whSkuPickerSearch')) $('whSkuPickerSearch').value = '';
  $('whSkuPickerModal')?.classList.add('active');
  renderWhSkuPickerTable();
}

export function closeWhSkuPickerModal() {
  $('whSkuPickerModal')?.classList.remove('active');
  targetBindTagId = null;
}

export function renderWhSkuPickerTable() {
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
      ? `<img src="${escapeHtml(s.productImage)}" style="width:32px; height:32px; object-fit:cover; border-radius:4px;">`
      : `<div style="width:32px; height:32px; background:#0E1316; border:1px solid var(--line); border-radius:4px; display:flex; align-items:center; justify-content:center; color:var(--text-faint); font-size:8.5px;">No img</div>`;

    const bindBtnHtml = isAlreadyBoundToThis
      ? `<span style="font-size:10px; font-weight:700; color:var(--green);">✓ Bound</span>`
      : `<button class="btn-sm btn-primary" data-select-bind-sku="${escapeHtml(s.skuNo)}" type="button">Bind SKU</button>`;

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
    btn.addEventListener('click', async () => {
      const skuNo = btn.dataset.selectBindSku;
      const targetSku = state.skus.find(s => s.skuNo === skuNo);

      if (targetSku) {
        state.skus.forEach(s => {
          if (s.tagBind === targetBindTagId) s.tagBind = '';
        });

        targetSku.tagBind = targetBindTagId;
        saveSkusToStorage();
        closeWhSkuPickerModal();
        const { renderWarehouseConfigAnimated } = await import('./animation.js');
        renderWarehouseConfigAnimated();
      }
    });
  });
}

export function initModalListeners() {
  $('confirmModalCloseBtn')?.addEventListener('click', closeConfirmDialog);
  $('confirmModalCancelBtn')?.addEventListener('click', closeConfirmDialog);
  $('confirmModalActionBtn')?.addEventListener('click', () => {
    if (confirmCallback) confirmCallback();
    closeConfirmDialog();
  });

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    let isMouseDown = false;
    overlay.addEventListener('mousedown', (e) => isMouseDown = (e.target === overlay));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && isMouseDown) {
        if (overlay.id === 'scannerModal') closeScanner();
        else if (overlay.id === 'whSkuPickerModal') closeWhSkuPickerModal();
        else overlay.classList.remove('active');
      }
    });
  });

  document.querySelectorAll('[data-scan-for]').forEach(btn => btn.addEventListener('click', () => openScanner(btn.dataset.scanFor)));
  $('closeScannerBtn')?.addEventListener('click', closeScanner);
  $('confirmManualScanBtn')?.addEventListener('click', () => {
    const val = $('manualScanInput')?.value.trim();
    if (val && currentScanTargetInput) currentScanTargetInput.value = val;
    closeScanner();
  });

  document.querySelectorAll('[data-clear-field]').forEach(btn => {
    btn.addEventListener('click', () => {
      const field = $(btn.dataset.clearField);
      if (field) field.value = '';
    });
  });

  $('whModalCloseBtn')?.addEventListener('click', closeAttachModal);
  $('whModalSearch')?.addEventListener('input', renderAttachModalList);
  $('whSkuPickerCloseBtn')?.addEventListener('click', closeWhSkuPickerModal);
  $('whSkuPickerSearch')?.addEventListener('input', renderWhSkuPickerTable);
  $('skuDetailCloseBtn')?.addEventListener('click', () => $('skuDetailModal')?.classList.remove('active'));
}