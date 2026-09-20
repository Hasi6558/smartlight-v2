import { $, state, escapeHtml, renderTagIcon } from '../state.js';
import { openAttachModal, openWhSkuPickerModal, confirmDialog } from '../UI/modals.js';
import { openSkuDetailModal } from './inventory.js';
import { publishTagActivate, publishTagTest, publishTagStop } from './Lightcontrol.js';
import { renderWarehouseConfigAnimated } from '../UI/animation.js';
import { saveTagsToStorage, saveSkusToStorage } from '../api.js';

let draggedWhObject = null;

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

export function renderWarehouseStock() {
  const container = $('warehouseStockHierarchyList');
  if (!container) return;

  const areaTags = state.tags.filter(t => t.tagType === 'AreaTag');
  const allShelves = state.tags.filter(t => t.tagType === 'ShelfTag');
  const allItems = state.tags.filter(t => t.tagType === 'ItemTag');

  if (!areaTags.length) {
    container.innerHTML = '<div class="empty-strip-hint">No Area Tags created yet.</div>';
    return;
  }

  const search = ($('searchWarehouseStock')?.value || '').trim().toLowerCase();

  const renderedAreas = areaTags.map(area => {
    const assignedShelves = allShelves.filter(s => s.parentTag === area.tagId);
    const areaSelfMatches = stockTagMatchesSearch(area, search);

    let visibleShelves = assignedShelves;
    if (search) {
      visibleShelves = assignedShelves.filter(shelf => {
        const items = allItems.filter(i => i.parentTag === shelf.tagId);
        return stockTagMatchesSearch(shelf, search) || items.some(i => stockTagMatchesSearch(i, search));
      });
      if (!areaSelfMatches && !visibleShelves.length) return '';
    }

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

export function renderWarehouseConfig() {
  const container = $('warehouseHierarchyList');
  if (!container) return;

  const areaTags = state.tags.filter(t => t.tagType === 'AreaTag');
  const allShelves = state.tags.filter(t => t.tagType === 'ShelfTag');
  const allItems = state.tags.filter(t => t.tagType === 'ItemTag');

  if (!areaTags.length) {
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
                          <div class="wh-img-placeholder"><span>No Image</span></div>
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
  container.querySelectorAll('[data-stop]').forEach(btn => {
    btn.addEventListener('click', () => publishTagStop(btn.dataset.stop));
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

  container.querySelectorAll('[data-view-sku]').forEach(box => {
    box.addEventListener('click', (e) => {
      e.stopPropagation();
      const skuNo = box.dataset.viewSku;
      if (skuNo) openSkuDetailModal(skuNo);
    });
  });

  if (!state.configLocked) attachWarehouseDragAndDrop(container);
}

export function attachWarehouseDragAndDrop(container) {
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
}

export function initWarehouseListeners() {
  $('lockConfigBtn')?.addEventListener('click', () => {
    state.configLocked = !state.configLocked;
    const btn = $('lockConfigBtn');
    if (btn) {
      btn.textContent = state.configLocked ? 'CONFIG LOCKED' : 'LOCK CONFIG';
      btn.className = state.configLocked ? 'btn-sm btn-danger' : 'btn-sm btn-ghost';
    }
    renderWarehouseConfigAnimated();
  });

  $('searchWarehouseStock')?.addEventListener('input', renderWarehouseStock);
}