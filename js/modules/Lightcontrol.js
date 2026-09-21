import { $, state, escapeHtml, renderTagIcon } from '../state.js';
import { confirmDialog } from '../UI/modals.js';
import { publishMqttViaServer, saveTagsToStorage, saveSkusToStorage } from '../api.js';
import { renderTagListAnimated } from '../UI/animation.js';

// --- Global Configuration Constants ---
const TAG_TOPIC = '/estation/7301A67/recv';    // MQTT topic for targeting individual or cascades of tags
const LIGHT_TOPIC = '/estation/7301A67/recv';  // MQTT topic for broadcast/global light commands
let editingUid = null;                         // Tracks the unique ID of the tag currently being edited (null if adding a new tag)

/**
 * Converts a 3-bit color integer bitmask into a CSS RGB color string.
 * Bit flags: 4 = Red, 2 = Green, 1 = Blue.
 * 
 * @param {number} color - Bitmask integer (0 to 7) representing RGB combinations.
 * @returns {string} CSS rgb() color code or fallback dark grey (#3A4148) for 0/off.
 */
export function tagSwatchColor(color) {
  if (!color) return '#3A4148';
  return `rgb(${(color & 4) ? 229 : 30}, ${(color & 2) ? 201 : 30}, ${(color & 1) ? 232 : 30})`;
}

/**
 * Reads global RGB checkbox states, updates the UI toggle styling and color text descriptions,
 * calculates the combined 3-bit color value, and updates the preview swatch.
 * 
 * @returns {number} The calculated 3-bit color integer value (0-7).
 */
export function updateColorPreview() {
  const r = $('colorRed')?.checked, g = $('colorGreen')?.checked, b = $('colorBlue')?.checked;
  
  // Highlight UI button options if checked
  if ($('optRed')) $('optRed').classList.toggle('checked', !!r);
  if ($('optGreen')) $('optGreen').classList.toggle('checked', !!g);
  if ($('optBlue')) $('optBlue').classList.toggle('checked', !!b);

  // Compute 3-bit bitmask integer: Red (4) + Green (2) + Blue (1)
  const color = (r ? 4 : 0) + (g ? 2 : 0) + (b ? 1 : 0);
  if ($('colorValue')) $('colorValue').textContent = color;

  // Build human-readable color label (e.g., "Red + Blue")
  const parts = [];
  if (r) parts.push('Red');
  if (g) parts.push('Green');
  if (b) parts.push('Blue');
  if ($('colorCombo')) $('colorCombo').textContent = parts.length ? parts.join(' + ') : 'No color selected';

  // Update visual color preview box
  const swatch = $('colorSwatchBig');
  if (swatch) {
    swatch.style.background = color === 0 ? '#3A4148' : `rgb(${r ? 229 : 30},${g ? 201 : 30},${b ? 232 : 30})`;
  }
  return color;
}

/**
 * Updates color preview controls specifically for the Light Strip Add/Edit side panel form.
 * 
 * @returns {number} Calculated 3-bit color value for the light strip form.
 */
export function updateLsColorPreview() {
  const r = $('lsColorRed')?.checked, g = $('lsColorGreen')?.checked, b = $('lsColorBlue')?.checked;
  if ($('lsOptRed')) $('lsOptRed').classList.toggle('checked', !!r);
  if ($('lsOptGreen')) $('lsOptGreen').classList.toggle('checked', !!g);
  if ($('lsOptBlue')) $('lsOptBlue').classList.toggle('checked', !!b);

  const color = (r ? 4 : 0) + (g ? 2 : 0) + (b ? 1 : 0);
  if ($('lsColorValue')) $('lsColorValue').textContent = color;
  if ($('lsColorSwatch')) $('lsColorSwatch').style.background = tagSwatchColor(color);
  return color;
}

/**
 * Opens or closes the Light Strip edit/create side panel and populates form fields if editing.
 * 
 * @param {boolean} [show] - Explicit true to show, false to hide. Toggles if undefined.
 * @param {Object|null} [editTag=null] - Tag object to edit; if omitted, sets up form for creation.
 */
export function toggleLsForm(show, editTag = null) {
  const panel = $('lsFormPanel');
  if (!panel) return;
  const titleEl = $('lsFormTitle');
  const isCurrentlyOpen = panel.classList.contains('open');
  if (show === undefined) show = !isCurrentlyOpen;

  // Close panel and clear form
  if (!show) {
    panel.classList.remove('open');
    editingUid = null;
    if (titleEl) titleEl.classList.remove('edit-mode-title');
    resetLsForm();
    return;
  }

  // Open panel
  panel.classList.add('open');
  if (editTag) {
    // Populate form with existing tag details for editing
    editingUid = editTag.uid;
    if (titleEl) {
      titleEl.textContent = 'Edit Light Strip (' + editTag.tagId + ')';
      titleEl.classList.add('edit-mode-title');
    }
    if ($('lsAddBtn')) $('lsAddBtn').textContent = 'SAVE CHANGES';
    
    if ($('lsTagType')) $('lsTagType').value = editTag.tagType;
    if ($('lsTagID')) $('lsTagID').value = editTag.tagId;
    if ($('lsTagRef')) $('lsTagRef').value = editTag.tagRef || '';
    if ($('lsAreaID')) $('lsAreaID').value = editTag.areaId || '';
    if ($('lsShopID')) $('lsShopID').value = editTag.shopId || '';
    if ($('lsMaterialID')) $('lsMaterialID').value = editTag.materialId || '';
    if ($('lsDescription')) $('lsDescription').value = editTag.description || '';
    
    // Decode default color bitmask back into checkbox states
    if ($('lsColorRed')) $('lsColorRed').checked = !!(editTag.defaultColor & 4);
    if ($('lsColorGreen')) $('lsColorGreen').checked = !!(editTag.defaultColor & 2);
    if ($('lsColorBlue')) $('lsColorBlue').checked = !!(editTag.defaultColor & 1);
    if ($('lsDefaultBeep')) $('lsDefaultBeep').checked = !!editTag.defaultBeep;
    if ($('lsDefaultFlash')) $('lsDefaultFlash').checked = !!editTag.defaultFlash;
  } else {
    // Prepare blank form for creating a new tag
    editingUid = null;
    if (titleEl) {
      titleEl.textContent = 'Add Light Strip';
      titleEl.classList.remove('edit-mode-title');
    }
    if ($('lsAddBtn')) $('lsAddBtn').textContent = 'ADD LIGHT STRIP';
    resetLsForm();
  }
  updateLsColorPreview();
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Resets all input elements within the Light Strip form back to default blank values.
 */
export function resetLsForm() {
  if ($('lsTagID')) $('lsTagID').value = '';
  if ($('lsTagRef')) $('lsTagRef').value = '';
  if ($('lsAreaID')) $('lsAreaID').value = '';
  if ($('lsShopID')) $('lsShopID').value = '';
  if ($('lsMaterialID')) $('lsMaterialID').value = '';
  if ($('lsDescription')) $('lsDescription').value = '';
  if ($('lsColorRed')) $('lsColorRed').checked = false;
  if ($('lsColorGreen')) $('lsColorGreen').checked = false;
  if ($('lsColorBlue')) $('lsColorBlue').checked = false;
  if ($('lsDefaultBeep')) $('lsDefaultBeep').checked = false;
  if ($('lsDefaultFlash')) $('lsDefaultFlash').checked = false;
  updateLsColorPreview();
}

/**
 * Filters and sorts global tags in `state.tags` based on active search terms, 
 * selected tag types, and configured sorting rules.
 * 
 * @returns {Array<Object>} Processed list of tag objects ready for display.
 */
function getFilteredAndSortedTags() {
  let result = [...state.tags];
  
  // Filter by selected tag category/type
  if (state.filterType !== 'ALL') result = result.filter(t => t.tagType === state.filterType);

  // Search filter matching tag ID, Tag Reference, or Material ID
  const search = ($('searchLightStrips')?.value || '').trim().toLowerCase();
  if (search) {
    result = result.filter(t => 
      (t.tagId || '').toLowerCase().includes(search) ||
      (t.tagRef || '').toLowerCase().includes(search) ||
      (t.materialId || '').toLowerCase().includes(search)
    );
  }

  // Sort by specified property (natural numeric/alphanumeric comparison)
  if (state.sortBy !== 'MANUAL') {
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

/**
 * Renders the filtered and sorted list of light strips as HTML cards in the UI container
 * and binds action buttons (Activate, Test, Stop, Edit, Delete, Selection Checkboxes).
 */
export function renderTagList() {
  const container = $('lightStripList');
  if (!container) return;
  const displayTags = getFilteredAndSortedTags();

  // Render empty state if no tags match filters
  if (!displayTags.length) {
    container.innerHTML = '<div class="empty-strip-hint">No matching light strips found.</div>';
    updateSelectAllState();
    return;
  }

  // Generate card templates
  container.innerHTML = displayTags.map(t => {
    const isSelected = state.selectedUids.has(t.uid);
    const customIconUrl = state.settings.icons[t.tagType];
    const iconBoxContent = customIconUrl
      ? `<img src="${escapeHtml(customIconUrl)}" alt="${escapeHtml(t.tagType)} Icon">`
      : `<div class="default-icon-wrap">${renderTagIcon(t.tagType)}</div>`;

    return `
      <div class="strip-card ${isSelected ? 'selected' : ''}" data-uid="${t.uid}" draggable="true">
        <div class="strip-head">
          <div class="strip-title">
            <input type="checkbox" class="strip-select-cb" data-uid="${t.uid}" ${isSelected ? 'checked' : ''}>
            <div class="strip-icon-box">${iconBoxContent}</div>
            <div style="min-width:0;">
              <div class="strip-tagid">${escapeHtml(t.tagId)}</div>
              ${t.tagRef ? `<div class="strip-tagref">${escapeHtml(t.tagRef)}</div>` : ''}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <span class="strip-badge">${renderTagIcon(t.tagType)} ${escapeHtml(t.tagType)}</span>
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
      </div>
    `;
  }).join('');

  // Attach event listeners for card checkbox selections
  container.querySelectorAll('.strip-select-cb').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const uid = e.target.dataset.uid;
      if (e.target.checked) state.selectedUids.add(uid);
      else state.selectedUids.delete(uid);
      renderTagList();
    });
  });

  // Attach action button handlers
  container.querySelectorAll('[data-activate]').forEach(btn => btn.addEventListener('click', () => publishTagActivate(btn.dataset.activate)));
  container.querySelectorAll('[data-test]').forEach(btn => btn.addEventListener('click', () => publishTagTest(btn.dataset.test)));
  container.querySelectorAll('[data-stop]').forEach(btn => btn.addEventListener('click', () => publishTagStop(btn.dataset.stop)));
  container.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => {
    const t = state.tags.find(x => x.uid === btn.dataset.edit);
    if (t) toggleLsForm(true, t);
  }));

  // Confirm delete dialog handler
  container.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', () => {
    const uid = btn.dataset.remove;
    confirmDialog("Delete Light Strip", "Are you sure you want to delete this light strip?", () => {
      state.tags = state.tags.filter(t => t.uid !== uid);
      state.selectedUids.delete(uid);
      saveTagsToStorage();
      renderTagListAnimated();
    });
  }));

  updateSelectAllState();
}

/**
 * Updates the state of the "Select All" checkbox based on whether all currently 
 * visible (filtered) tags are selected.
 */
function updateSelectAllState() {
  const visibleTags = getFilteredAndSortedTags();
  const allSelected = visibleTags.length > 0 && visibleTags.every(t => state.selectedUids.has(t.uid));
  if ($('selectAllCb')) $('selectAllCb').checked = allSelected;
}

/**
 * Traverses tag relationships to gather all related tags for cascading activation.
 * 1. Climbs UP the parent tree from startTag to root (prevents circular loops via visited Set).
 * 2. Expands DOWNWARD if startTag is an AreaTag (includes child shelves & item tags) or ShelfTag (includes child items).
 * 
 * @param {Object} startTag - Starting target tag object.
 * @returns {Array<Object>} List of all tags to be activated in cascade.
 */
export function getCascadeActivationSet(startTag) {
  const targetTags = new Set();
  if (!startTag) return [];

  // Traverse upward to gather parent/ancestor tags
  let current = startTag;
  const visited = new Set();
  while (current && !visited.has(current.uid)) {
    visited.add(current.uid);
    targetTags.add(current);
    if (!current.parentTag) break;
    current = state.tags.find(t => t.tagId === current.parentTag);
  }

  // Traversal downward for container-type tags
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

/**
 * Sends MQTT activation payloads for a target tag and all of its cascading ancestors/descendants.
 * 
 * @param {string} uid - Unique identifier of the starting tag.
 */
export function publishTagActivate(uid) {
  const t = state.tags.find(x => x.uid === uid);
  if (!t) return;
  getCascadeActivationSet(t).forEach(node => {
    publishMqttViaServer(TAG_TOPIC, { 
      Time: 5, 
      Items: [{ TagID: node.tagId, Beep: node.defaultBeep, Color: node.defaultColor, Flashing: node.defaultFlash }], 
      Sequence: 26, 
      Code: 131, 
      Token: "" 
    });
  });
}

/**
 * Sends a single MQTT test payload to activate light/beep state for a single tag for 5 seconds.
 * 
 * @param {string} uid - Unique identifier of target tag.
 */
export function publishTagTest(uid) {
  const t = state.tags.find(x => x.uid === uid);
  if (t) publishMqttViaServer(TAG_TOPIC, { 
    Time: 5, 
    Items: [{ TagID: t.tagId, Beep: t.defaultBeep, Color: t.defaultColor, Flashing: t.defaultFlash }], 
    Sequence: 26, 
    Code: 131, 
    Token: "" 
  });
}

/**
 * Sends an MQTT command to turn off lights/beeping (Color 0, Beep false) for a single tag.
 * 
 * @param {string} uid - Unique identifier of target tag.
 */
export function publishTagStop(uid) {
  const t = state.tags.find(x => x.uid === uid);
  if (t) publishMqttViaServer(TAG_TOPIC, { 
    Time: 5, 
    Items: [{ TagID: t.tagId, Beep: false, Color: 0, Flashing: false }], 
    Sequence: 26, 
    Code: 131, 
    Token: "" 
  });
}

/**
 * Initializes all event listeners for light strip controls, toolbar actions, 
 * search, sorting, modal actions, batch operations, and JSON backup import/export.
 */
export function initLightControlListeners() {
  // Live color preview triggers
  ['colorRed', 'colorGreen', 'colorBlue'].forEach(id => $(id)?.addEventListener('change', updateColorPreview));
  ['lsColorRed', 'lsColorGreen', 'lsColorBlue'].forEach(id => $(id)?.addEventListener('change', updateLsColorPreview));

  // Global broadcast light toggle button
  $('lightToggleBtn')?.addEventListener('click', () => {
    const color = updateColorPreview();
    const payload = {
      Time: 1, StartGroup: 0, EndGroup: 255, StartID: "000000000000", EndID: "FFFFFFFFFFFF",
      Flashing: $('flashToggle')?.checked, Beep: $('beepToggle')?.checked, Color: color, Sequence: 19, Code: 132, Token: ""
    };
    publishMqttViaServer(LIGHT_TOPIC, payload);
  });

  // Form toggling action buttons
  $('toggleAddLsBtn')?.addEventListener('click', () => toggleLsForm(true));
  $('lsCancelBtn')?.addEventListener('click', () => toggleLsForm(false));
  $('lsClearBtn')?.addEventListener('click', resetLsForm);

  // Submit handler for adding or updating a light strip tag
  $('lsAddBtn')?.addEventListener('click', () => {
    const tagId = $('lsTagID')?.value.trim();
    if (!tagId) { alert("Tag ID is required."); return; }

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

  // Search input and filter/sort controls
  $('searchLightStrips')?.addEventListener('input', () => renderTagListAnimated());
  $('filterTagType')?.addEventListener('change', (e) => { state.filterType = e.target.value; renderTagListAnimated(); });
  $('sortBy')?.addEventListener('change', (e) => { state.sortBy = e.target.value; renderTagListAnimated(); });
  $('sortDirBtn')?.addEventListener('click', () => {
    state.sortDir = state.sortDir === 'ASC' ? 'DESC' : 'ASC';
    if ($('sortDirBtn')) $('sortDirBtn').textContent = state.sortDir;
    renderTagListAnimated();
  });

  // Select all checkbox handler
  $('selectAllCb')?.addEventListener('change', (e) => {
    const visibleTags = getFilteredAndSortedTags();
    if (e.target.checked) visibleTags.forEach(t => state.selectedUids.add(t.uid));
    else visibleTags.forEach(t => state.selectedUids.delete(t.uid));
    renderTagListAnimated();
  });

  // Batch delete button handler
  $('batchDeleteBtn')?.addEventListener('click', () => {
    const count = state.selectedUids.size;
    if (count === 0) { alert('No tags selected for batch delete.'); return; }
    confirmDialog("Batch Delete Tags", `Are you sure you want to delete ${count} selected light strip(s)?`, () => {
      state.tags = state.tags.filter(t => !state.selectedUids.has(t.uid));
      state.selectedUids.clear();
      saveTagsToStorage();
      renderTagListAnimated();
    });
  });

  // Export state to JSON file handler
  $('exportJsonBtn')?.addEventListener('click', () => {
    const backupObj = { tags: state.tags, skus: state.skus };
    const blob = new Blob([JSON.stringify(backupObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smart_light_warehouse_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Import JSON backup file handlers
  $('importJsonBtn')?.addEventListener('click', () => $('importFileInput')?.click());
  $('importFileInput')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const imported = JSON.parse(evt.target.result);
        if (Array.isArray(imported)) state.tags = imported;
        else if (imported.tags) {
          state.tags = imported.tags || [];
          if (imported.skus) state.skus = imported.skus;
        }
        saveTagsToStorage();
        saveSkusToStorage();
        renderTagListAnimated();
        alert('JSON backup loaded successfully.');
      } catch (err) { alert('Invalid JSON file.'); }
    };
    reader.readAsText(file);
    e.target.value = '';
  });
}