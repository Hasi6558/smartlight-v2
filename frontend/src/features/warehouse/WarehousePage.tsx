import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import type { InventoryRecord, MqttStatus, Sku, Tag } from '../../types/api';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { TagIcon } from '../../components/TagIcon';
import { ScannerModal } from '../../components/ScannerModal';

interface Props {
  mqtt: MqttStatus | null;
  onError: (message: string | null) => void;
}

type WarehouseMode = 'configuration' | 'stock';

function labelFor(tag: Tag) {
  return tag.tagRef || tag.tagId;
}

function skuForTag(tag: Tag, skus: Sku[]) {
  return skus.find((sku) => sku.tagBind === tag.tagId);
}

function stockForSku(sku: Sku | undefined, inventory: InventoryRecord[]) {
  return sku ? inventory.find((record) => record.skuNo === sku.skuNo)?.stock ?? 0 : 0;
}

interface TagCardProps {
  tag: Tag;
  skus: Sku[];
  inventory: InventoryRecord[];
  locked: boolean;
  onCommand: (tag: Tag, action: 'activate' | 'test' | 'stop') => void;
  onBind: (tag: Tag) => void;
  onUnbind: (skuNo: string) => void;
  onRemove: (tag: Tag) => void;
  onDragStart: (tag: Tag | null) => void;
  onDropTag: (parentTag: string) => void;
  onReorder: (targetUid: string) => void;
  animated: 'moved' | 'displaced' | false;
  onDragOverTag: (uid: string, side: 'before' | 'after') => void;
  onDragLeaveTag: () => void;
}

function TagCard({ tag, skus, inventory, locked, onCommand, onBind, onUnbind, onRemove, onDragStart, onDropTag, onReorder, animated, onDragOverTag, onDragLeaveTag }: TagCardProps) {
  const sku = skuForTag(tag, skus);
  const stock = stockForSku(sku, inventory);
  return (
    <div className={`wh-box-card ${tag.tagType === 'ShelfTag' ? 'wh-shelf-box' : ''} ${animated ? `warehouse-item-${animated}` : ''}`} draggable={!locked} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', tag.uid); onDragStart(tag); }} onDragEnd={() => { onDragStart(null); onDragLeaveTag(); }} onDragOver={(event) => { if (!locked && (tag.tagType === 'ShelfTag' || tag.tagType === 'ItemTag')) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; if (tag.tagType === 'ItemTag') onDragOverTag(tag.uid, event.clientX < event.currentTarget.getBoundingClientRect().left + event.currentTarget.getBoundingClientRect().width / 2 ? 'before' : 'after'); } }} onDrop={(event) => { if (locked) return; event.preventDefault(); event.stopPropagation(); if (tag.tagType === 'ItemTag') onReorder(tag.uid); else onDropTag(tag.tagId); }}>
      <div>
        <div className="wh-box-head">
          <div className="wh-tag-label">
            <TagIcon type={tag.tagType} />
            <span className="wh-box-tagid">{labelFor(tag)}</span>
          </div>
          {!locked && <button className="btn-sm btn-danger" onClick={() => onRemove(tag)} type="button">Delete</button>}
        </div>
        {tag.tagRef && <div className="wh-box-ref">({tag.tagId})</div>}
        {tag.tagType === 'ShelfTag' && (
          <div className="warehouse-sku-binding">
            {sku ? (
              <>
                <div className="stock-sku-label">{sku.itemLabel}</div>
                <div className="sku-number">{sku.skuNo}</div>
                {!locked && <button className="btn-sm btn-ghost" onClick={() => onUnbind(sku.skuNo)} type="button">Unbind SKU</button>}
              </>
            ) : locked ? <div className="no-sku">No SKU Bound</div> : <button className="btn-sm btn-accent bind-button" onClick={() => onBind(tag)} type="button">+ Bind SKU</button>}
          </div>
        )}
        {tag.tagType === 'ItemTag' && (
          sku ? (
            <>
              <div className="stock-sku-label">{sku.itemLabel}</div>
              <div className="sku-number">{sku.skuNo}</div>
              <div className="wh-img-placeholder">{sku.productImage ? <img src={sku.productImage} alt={sku.itemLabel} /> : <span>No Image</span>}</div>
              {!locked && <button className="btn-sm btn-ghost bind-button" onClick={() => onUnbind(sku.skuNo)} type="button">Unbind SKU</button>}
            </>
          ) : (
            <>
              <div className="wh-img-placeholder"><span>No Image</span></div>
              {!locked && <button className="btn-sm btn-accent bind-button" onClick={() => onBind(tag)} type="button">+ Bind SKU</button>}
            </>
          )
        )}
      </div>
      {tag.tagType !== 'AreaTag' && (
        <div className="wh-box-actions">
          <button className="btn-sm btn-accent" onClick={() => onCommand(tag, 'activate')} type="button">Act</button>
          <button className="btn-sm btn-primary" onClick={() => onCommand(tag, 'test')} type="button">Test</button>
          <button className="btn-sm btn-danger" onClick={() => onCommand(tag, 'stop')} type="button">Stop</button>
        </div>
      )}
      {tag.tagType === 'ShelfTag' && <div className={`stock-qty-badge ${stock <= 0 ? 'bad-stock' : ''}`}>Qty: {stock} pcs</div>}
    </div>
  );
}

export function WarehousePage({ mqtt, onError }: Props) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [skus, setSkus] = useState<Sku[]>([]);
  const [inventory, setInventory] = useState<InventoryRecord[]>([]);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<WarehouseMode>('configuration');
  const [locked, setLocked] = useState(true);
  const [collapsedAreas, setCollapsedAreas] = useState<Set<string>>(new Set());
  const [collapsedShelves, setCollapsedShelves] = useState<Set<string>>(new Set());
  const [bindTag, setBindTag] = useState<Tag | null>(null);
  const [removeTag, setRemoveTag] = useState<Tag | null>(null);
  const [draggedTag, setDraggedTag] = useState<Tag | null>(null);
  const [animatedTags, setAnimatedTags] = useState<Record<string, 'moved' | 'displaced'>>({});
  const [dropTarget, setDropTarget] = useState<{ uid: string | null; shelfUid: string; side: 'before' | 'after' } | null>(null);
  const [addTag, setAddTag] = useState<{ type: 'ShelfTag' | 'ItemTag'; parentTag: string } | null>(null);
  const [tagPickerSearch, setTagPickerSearch] = useState('');
  const [tagPickerSort, setTagPickerSort] = useState<'tagRef' | 'tagId' | 'uid'>('tagRef');
  const [tagPickerAscending, setTagPickerAscending] = useState(true);
  const [tagPickerScannerOpen, setTagPickerScannerOpen] = useState(false);

  const load = async () => {
    try {
      const [loadedTags, loadedSkus, loadedInventory] = await Promise.all([api.getTags(), api.getSkus(), api.getInventory()]);
      setTags(loadedTags);
      setSkus(loadedSkus);
      setInventory(loadedInventory);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Unable to load warehouse data');
    }
  };

  useEffect(() => { void load(); }, []);

  const matchingTags = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return tags;
    const matches = (tag: Tag) => {
      const sku = skuForTag(tag, skus);
      return [tag.tagId, tag.tagRef, sku?.skuNo, sku?.itemLabel].some((value) => value?.toLowerCase().includes(query));
    };
    const visible = new Set(tags.filter(matches).map((tag) => tag.uid));
    tags.forEach((tag) => {
      if (visible.has(tag.uid) && tag.parentTag) {
        const parent = tags.find((candidate) => candidate.tagId === tag.parentTag);
        if (parent) visible.add(parent.uid);
      }
    });
    return tags.filter((tag) => visible.has(tag.uid));
  }, [tags, skus, search]);

  const areas = matchingTags.filter((tag) => tag.tagType === 'AreaTag');
  const shelvesFor = (area: Tag) => matchingTags.filter((tag) => tag.tagType === 'ShelfTag' && tag.parentTag === area.tagId);
  const itemsFor = (shelf: Tag) => matchingTags.filter((tag) => tag.tagType === 'ItemTag' && tag.parentTag === shelf.tagId);

  const toggle = (set: Set<string>, uid: string, update: (value: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(uid)) next.delete(uid); else next.add(uid);
    update(next);
  };

  const command = async (tag: Tag, action: 'activate' | 'test' | 'stop') => {
    if (!mqtt?.connected) {
      onError('Connect the MQTT broker before controlling warehouse lights.');
      return;
    }
    try {
      await api.publishMqtt('/estation/7301A67/recv', {
        Time: action === 'test' ? 5 : 30,
        Items: [{ TagID: tag.tagId, Beep: action === 'stop' ? false : tag.defaultBeep, Color: action === 'stop' ? 0 : tag.defaultColor, Flashing: action === 'stop' ? false : tag.defaultFlash }],
        Sequence: action === 'activate' ? 25 : action === 'test' ? 26 : 27,
        Code: 131,
        Token: '',
      });
      onError(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Unable to publish warehouse light command');
    }
  };

  const remove = async () => {
    if (!removeTag) return;
    const removed = removeTag;
    // Warehouse removal detaches tags from the hierarchy; Light Control owns the tag registry.
    const next = tags.map((tag) => (
      tag.uid === removed.uid || tag.parentTag === removed.tagId
        ? { ...tag, parentTag: '' }
        : tag
    ));
    try {
      await api.saveTags(next);
      setTags(next);
      setRemoveTag(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Unable to remove warehouse tag');
    }
  };

  const bindSku = async (skuNo: string) => {
    if (!bindTag) return;
    try {
      const next = skus.map((sku) => sku.skuNo === skuNo ? { ...sku, tagBind: bindTag.tagId } : sku);
      await api.saveSkus(next);
      setSkus(next);
      setBindTag(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Unable to bind SKU');
    }
  };

  const unbindSku = async (skuNo: string) => {
    const next = skus.map((sku) => sku.skuNo === skuNo ? { ...sku, tagBind: '' } : sku);
    try {
      await api.saveSkus(next);
      setSkus(next);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Unable to unbind SKU');
    }
  };

  const moveTag = async (parentTag: string) => {
    const draggedUid = draggedTag?.uid;
    if (!draggedUid || locked || !parentTag) return;
    const source = tags.find((tag) => tag.uid === draggedUid);
    if (!source) return;
    if (source.tagType === 'ItemTag' && !tags.some((tag) => tag.tagType === 'ShelfTag' && tag.tagId === parentTag)) return;
    if (source.tagType === 'ShelfTag' && !tags.some((tag) => tag.tagType === 'AreaTag' && tag.tagId === parentTag)) return;
    if (source.tagType === 'AreaTag') return;
    const next = tags.map((tag) => tag.uid === draggedUid ? { ...tag, parentTag } : tag);
    try {
      await api.saveTags(next);
      setTags(next); setDraggedTag(null); setDropTarget(null);
      if (source.tagType === 'ItemTag') {
        setAnimatedTags({ [source.uid]: 'moved' });
        window.setTimeout(() => setAnimatedTags({}), 650);
      }
      onError(null);
    }
    catch (error) { onError(error instanceof Error ? error.message : 'Unable to rearrange warehouse tag'); }
  };

  const reorderItem = async (targetUid: string, side: 'before' | 'after') => {
    if (!draggedTag || locked || draggedTag.uid === targetUid || draggedTag.tagType !== 'ItemTag') return;
    const target = tags.find((tag) => tag.uid === targetUid);
    if (!target || target.tagType !== 'ItemTag') return;
    const fromIndex = tags.findIndex((tag) => tag.uid === draggedTag.uid);
    const targetIndex = tags.findIndex((tag) => tag.uid === targetUid);
    if (fromIndex < 0 || targetIndex < 0) return;
    const next = [...tags];
    const [moved] = next.splice(fromIndex, 1);
    moved.parentTag = target.parentTag;
    const insertIndex = next.findIndex((tag) => tag.uid === targetUid);
    next.splice(side === 'after' ? insertIndex + 1 : insertIndex, 0, moved);
    try {
      await api.saveTags(next);
      setTags(next);
      setDraggedTag(null);
      setDropTarget(null);
      setAnimatedTags(side === 'after' ? { [draggedTag.uid]: 'moved' } : { [draggedTag.uid]: 'moved', [targetUid]: 'displaced' });
      window.setTimeout(() => setAnimatedTags({}), 650);
      onError(null);
    }
    catch (error) { onError(error instanceof Error ? error.message : 'Unable to reorder warehouse tags'); }
  };

  const moveItemToShelfEnd = async (shelfTagId: string) => {
    if (!draggedTag || locked || draggedTag.tagType !== 'ItemTag') return;
    const sourceIndex = tags.findIndex((tag) => tag.uid === draggedTag.uid);
    if (sourceIndex < 0) return;
    const shelfItems = tags.filter((tag) => tag.tagType === 'ItemTag' && tag.parentTag === shelfTagId);
    const lastItem = shelfItems[shelfItems.length - 1];
    if (!lastItem || lastItem.uid === draggedTag.uid) return;
    const next = [...tags];
    const [moved] = next.splice(sourceIndex, 1);
    moved.parentTag = shelfTagId;
    const lastIndex = next.findIndex((tag) => tag.uid === lastItem.uid);
    next.splice(lastIndex + 1, 0, moved);
    try {
      await api.saveTags(next);
      setTags(next); setDraggedTag(null); setDropTarget(null);
      setAnimatedTags({ [draggedTag.uid]: 'moved' });
      window.setTimeout(() => setAnimatedTags({}), 650);
      onError(null);
    } catch (error) { onError(error instanceof Error ? error.message : 'Unable to move warehouse item'); }
  };

  const attachTag = async (tag: Tag) => {
    if (!addTag) return;
    try {
      const next = tags.map((candidate) => candidate.uid === tag.uid ? { ...candidate, parentTag: addTag.parentTag } : candidate);
      await api.saveTags(next);
      setTags(next); setAddTag(null); setTagPickerSearch(''); onError(null);
    } catch (error) { onError(error instanceof Error ? error.message : 'Unable to attach warehouse tag'); }
  };

  const pickerTags = useMemo(() => {
    if (!addTag) return [];
    const query = tagPickerSearch.trim().toLowerCase();
    return tags.filter((tag) => tag.tagType === addTag.type)
      .filter((tag) => [tag.tagRef, tag.tagId].some((value) => value.toLowerCase().includes(query)))
      .sort((left, right) => {
        const a = (left[tagPickerSort] || '').toLowerCase();
        const b = (right[tagPickerSort] || '').toLowerCase();
        return (a.localeCompare(b) || left.uid.localeCompare(right.uid)) * (tagPickerAscending ? 1 : -1);
      });
  }, [addTag, tags, tagPickerSearch, tagPickerSort, tagPickerAscending]);

  return (
    <div className="wh-wrap">
      <div className="strip-toolbar">
        <div><h3>{mode === 'configuration' ? 'Warehouse Layout & Hierarchy' : 'Warehouse Stock View'}</h3><p className="hint">Assign created Shelf Tags to Area Tags, and Item Tags to Shelf Tags.</p></div>
        {mode === 'configuration' && <button className={`btn-sm ${locked ? 'btn-danger' : 'btn-ghost'}`} onClick={() => setLocked((value) => !value)} type="button">{locked ? '🔒 CONFIG LOCKED' : '🔓 LOCK CONFIG'}</button>}
      </div>
      <div className="warehouse-mode-tabs">
        <button className={`btn-sm ${mode === 'configuration' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMode('configuration')} type="button">Configuration</button>
        <button className={`btn-sm ${mode === 'stock' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMode('stock')} type="button">Stock View</button>
      </div>
      <div className="filter-sort-bar">
        <div className="bar-group" style={{ flex: 1 }}>
          <label htmlFor="warehouse-search">Search:</label>
          <input id="warehouse-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Tag Reference, Tag ID, SKU No, or Item Label..." />
          {search && <button className="btn-field-icon" onClick={() => setSearch('')} type="button">✕</button>}
        </div>
      </div>
      <div className="warehouse-hierarchy-list">
        {!areas.length && <div className="empty-strip-hint">No Area Tags created yet. Add an Area Tag in Light Control to start configuring your warehouse.</div>}
        {areas.map((area) => {
          const shelves = shelvesFor(area);
          const areaCollapsed = !search && collapsedAreas.has(area.uid);
          return (
            <div className="wh-area-card" key={area.uid}>
              <div className="wh-area-header">
                <button className="wh-area-title" onClick={() => toggle(collapsedAreas, area.uid, setCollapsedAreas)} type="button"><span>{areaCollapsed ? '▶' : '▼'}</span><TagIcon type="AreaTag" /><span>{labelFor(area)} {area.tagRef && <small>({area.tagId})</small>}</span></button>
                <div className="wh-attach-row">{!locked && mode === 'configuration' && <button className="btn-sm btn-primary" onClick={() => setAddTag({ type: 'ShelfTag', parentTag: area.tagId })} type="button">+ Add Shelf Tag</button>}<div className="wh-action-btns"><button className="btn-sm btn-accent" onClick={() => void command(area, 'activate')} type="button">Activate Area</button><button className="btn-sm btn-primary" onClick={() => void command(area, 'test')} type="button">Test</button><button className="btn-sm btn-danger" onClick={() => void command(area, 'stop')} type="button">Stop</button></div></div>
              </div>
              {!areaCollapsed && <div className="wh-shelf-list">{!shelves.length && <div className="hint">No Shelf Tags attached to this Area.</div>}{shelves.map((shelf) => {
                const shelfItems = itemsFor(shelf);
                const shelfCollapsed = !search && collapsedShelves.has(shelf.uid);
                return (
                  <div className="wh-shelf-row" key={shelf.uid} onDragOver={(event) => { if (!locked) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void moveTag(shelf.parentTag); }}>
                    <TagCard tag={shelf} skus={skus} inventory={inventory} locked={locked || mode === 'stock'} animated={false} onDragStart={setDraggedTag} onDropTag={(parentTag) => void moveTag(parentTag)} onReorder={() => undefined} onDragOverTag={() => undefined} onDragLeaveTag={() => undefined} onCommand={(tag, action) => void command(tag, action)} onBind={setBindTag} onUnbind={(skuNo) => void unbindSku(skuNo)} onRemove={setRemoveTag} />
                    <div className="wh-shelf-controls-right"><button className="btn-toggle-shelf-desktop" onClick={() => toggle(collapsedShelves, shelf.uid, setCollapsedShelves)} type="button">{shelfCollapsed ? '▶' : '◀'}</button><div className="wh-shelf-divider" /></div>
                    {!shelfCollapsed && <div className="wh-items-horizontal" onDragOver={(event) => { if (!locked) { event.preventDefault(); setDropTarget({ uid: null, shelfUid: shelf.uid, side: 'after' }); } }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void moveItemToShelfEnd(shelf.tagId); }}>
                      {!shelfItems.length && <div className="hint">No Item Tags attached.</div>}
                      {shelfItems.map((item) => <div className="warehouse-item-drop-slot" key={item.uid}>
                        {draggedTag && draggedTag.uid !== item.uid && <><div className={`warehouse-drop-indicator before ${dropTarget?.uid === item.uid && dropTarget.side === 'before' ? 'active' : ''}`}><span>◀</span></div><div className={`warehouse-drop-indicator after ${dropTarget?.uid === item.uid && dropTarget.side === 'after' ? 'active' : ''}`}><span>▶</span></div></>}
                        <TagCard tag={item} skus={skus} inventory={inventory} locked={locked || mode === 'stock'} animated={animatedTags[item.uid] || false} onDragStart={setDraggedTag} onDropTag={(parentTag) => void moveTag(parentTag)} onReorder={(targetUid) => void reorderItem(targetUid, dropTarget?.side || 'before')} onDragOverTag={(uid, side) => setDropTarget({ uid, shelfUid: shelf.uid, side })} onDragLeaveTag={() => setDropTarget((current) => current?.uid === item.uid ? null : current)} onCommand={(tag, action) => void command(tag, action)} onBind={setBindTag} onUnbind={(skuNo) => void unbindSku(skuNo)} onRemove={setRemoveTag} />
                      </div>)}
                      {dropTarget?.shelfUid === shelf.uid && dropTarget.uid === null && <div className="warehouse-drop-end"><span>▶ DROP HERE</span></div>}
                      {!locked && mode === 'configuration' && <button className="wh-add-tag-slot" onClick={() => setAddTag({ type: 'ItemTag', parentTag: shelf.tagId })} type="button">+ Add Item Tag</button>}
                    </div>}
                  </div>
                );
              })}</div>}
            </div>
          );
        })}
      </div>
      <Modal open={bindTag !== null} title={`Bind SKU to ${bindTag ? labelFor(bindTag) : ''}`} onClose={() => setBindTag(null)}>
        <div className="sku-picker-list">{skus.filter((sku) => !sku.tagBind || sku.tagBind === bindTag?.tagId).map((sku) => <button className="data-row" key={sku.skuNo} onClick={() => void bindSku(sku.skuNo)} type="button"><strong>{sku.skuNo}</strong><span>{sku.itemLabel}</span></button>)}</div>
      </Modal>
      <ConfirmDialog open={removeTag !== null} title="Remove warehouse tag" message={`Remove ${removeTag ? labelFor(removeTag) : 'this tag'} from the warehouse hierarchy?`} onCancel={() => setRemoveTag(null)} onConfirm={() => void remove()} />
      <Modal open={addTag !== null} title={addTag?.type === 'ShelfTag' ? 'Add Shelf Tag' : 'Add Item Tag'} maxWidth={620} onClose={() => setAddTag(null)}>
        <div className="warehouse-tag-picker">
          <div className="warehouse-tag-picker-toolbar">
            <div className="input-with-actions warehouse-tag-picker-search">
              <input value={tagPickerSearch} onChange={(event) => setTagPickerSearch(event.target.value)} placeholder="Search Tag Reference or Tag ID..." autoFocus />
              <div className="input-actions-inside"><button className="btn-field-icon btn-scan-qr" onClick={() => setTagPickerScannerOpen(true)} title="Scan QR / Barcode" type="button">▦</button><button className="btn-field-icon btn-clear-x" onClick={() => setTagPickerSearch('')} title="Clear Search" type="button">✕</button></div>
            </div>
            <select value={tagPickerSort} onChange={(event) => setTagPickerSort(event.target.value as 'tagRef' | 'tagId' | 'uid')}><option value="tagRef">Sort by Reference</option><option value="tagId">Sort by Tag ID</option><option value="uid">Sort by Date Added</option></select>
            <button className="btn-sm btn-ghost" onClick={() => setTagPickerAscending((value) => !value)} type="button">{tagPickerAscending ? 'ASC' : 'DESC'}</button>
          </div>
          <div className="warehouse-tag-picker-grid">{pickerTags.length ? pickerTags.map((tag) => <button className="warehouse-tag-picker-card" key={tag.uid} onClick={() => void attachTag(tag)} type="button"><TagIcon type={tag.tagType} /><span><strong>{tag.tagRef || tag.tagId}</strong>{tag.tagRef && <small>{tag.tagId}</small>}</span><span className="btn-sm btn-primary">Attach</span></button>) : <div className="empty-strip-hint">No unattached matching tags.</div>}</div>
        </div>
      </Modal>
      <ScannerModal open={tagPickerScannerOpen} onClose={() => setTagPickerScannerOpen(false)} onDetected={(value) => { setTagPickerSearch(value); setTagPickerScannerOpen(false); }} />
    </div>
  );
}
