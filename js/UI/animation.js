import { renderTagList } from '../modules/Lightcontrol.js';
import { renderWarehouseConfig } from '../modules/warehouse.js';

export function renderTagListAnimated() {
  const container = document.getElementById('lightStripList');
  if (!container) return;
  const firstPositions = new Map();
  container.querySelectorAll('.strip-card').forEach(card => { if (card.dataset.uid) firstPositions.set(card.dataset.uid, card.getBoundingClientRect()); });

  renderTagList();

  container.querySelectorAll('.strip-card').forEach(card => {
    const first = firstPositions.get(card.dataset.uid);
    if (first) {
      const last = card.getBoundingClientRect();
      const deltaX = first.left - last.left, deltaY = first.top - last.top;
      if (deltaX !== 0 || deltaY !== 0) {
        card.style.transition = 'none';
        card.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
        requestAnimationFrame(() => { requestAnimationFrame(() => { card.style.transition = 'transform 0.35s cubic-bezier(0.2, 0, 0, 1)'; card.style.transform = ''; }); });
      }
    }
  });
}

export function renderWarehouseConfigAnimated() {
  const container = document.getElementById('warehouseHierarchyList');
  if (!container) { renderWarehouseConfig(); return; }
  const firstPositions = new Map();
  container.querySelectorAll('.wh-shelf-row[data-shelf-uid], .wh-box-card[data-item-uid]').forEach(el => {
    const uid = el.dataset.shelfUid || el.dataset.itemUid;
    if (uid) firstPositions.set(uid, el.getBoundingClientRect());
  });

  renderWarehouseConfig();

  container.querySelectorAll('.wh-shelf-row[data-shelf-uid], .wh-box-card[data-item-uid]').forEach(el => {
    const uid = el.dataset.shelfUid || el.dataset.itemUid;
    const first = firstPositions.get(uid);
    if (first) {
      const last = el.getBoundingClientRect();
      const deltaX = first.left - last.left, deltaY = first.top - last.top;
      if (deltaX !== 0 || deltaY !== 0) {
        el.style.transition = 'none';
        el.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
        requestAnimationFrame(() => { requestAnimationFrame(() => { el.style.transition = 'transform 0.35s cubic-bezier(0.2, 0, 0, 1)'; el.style.transform = ''; }); });
      }
    }
  });
}