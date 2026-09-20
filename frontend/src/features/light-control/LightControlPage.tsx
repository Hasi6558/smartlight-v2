import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import type { MqttStatus, Tag } from '../../types/api';
import { ConfirmDialog } from '../../components/Modal';
import { TagIcon } from '../../components/TagIcon';
import { ScannerModal } from '../../components/ScannerModal';

const topic = '/estation/7301A67/recv';
const emptyTag: Omit<Tag, 'uid'> = { tagType: 'ItemTag', tagId: '', tagRef: '', areaId: '', shopId: '', materialId: '', description: '', defaultColor: 0, defaultBeep: false, defaultFlash: false, parentTag: '' };
const colourOptions = [['RED', 4], ['GREEN', 2], ['BLUE', 1]] as const;

function swatch(color: number) {
  return color ? `rgb(${color & 4 ? 229 : 30}, ${color & 2 ? 201 : 30}, ${color & 1 ? 232 : 30})` : '#3A4148';
}

function descendants(tags: Tag[], tag: Tag) {
  const result = new Map<string, Tag>([[tag.uid, tag]]);
  let parent = tag.parentTag ? tags.find((item) => item.tagId === tag.parentTag) : undefined;
  while (parent && !result.has(parent.uid)) {
    result.set(parent.uid, parent);
    parent = parent.parentTag ? tags.find((item) => item.tagId === parent?.parentTag) : undefined;
  }
  if (tag.tagType !== 'ItemTag') tags.filter((item) => item.parentTag === tag.tagId).forEach((item) => {
    result.set(item.uid, item);
    if (tag.tagType === 'AreaTag') tags.filter((child) => child.parentTag === item.tagId).forEach((child) => result.set(child.uid, child));
  });
  return [...result.values()];
}

interface Props { mqtt: MqttStatus | null; onError: (message: string | null) => void; }

export function LightControlPage({ mqtt, onError }: Props) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [form, setForm] = useState(emptyTag);
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState('MANUAL');
  const [descending, setDescending] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupColor, setGroupColor] = useState(0);
  const [groupFlash, setGroupFlash] = useState(true);
  const [groupBeep, setGroupBeep] = useState(true);
  const [removeTag, setRemoveTag] = useState<Tag | null>(null);
  const [scanTarget, setScanTarget] = useState<keyof Omit<Tag, 'uid'> | null>(null);
  const [iconUrls, setIconUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    Promise.all([api.getTags(), api.getSettings()]).then(([loadedTags, settings]) => {
      setTags(loadedTags);
      setIconUrls({ AreaTag: settings.icon_AreaTag || '', ShelfTag: settings.icon_ShelfTag || '', ItemTag: settings.icon_ItemTag || '' });
    }).catch((error: unknown) => onError(error instanceof Error ? error.message : 'Unable to load tags'));
  }, [onError]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    const result = tags.filter((tag) => (filter === 'ALL' || tag.tagType === filter) && [tag.tagId, tag.tagRef, tag.materialId].some((value) => value.toLowerCase().includes(query)));
    if (sortBy !== 'MANUAL') result.sort((a, b) => {
      const comparison = a[sortBy as keyof Tag].toString().localeCompare(b[sortBy as keyof Tag].toString(), undefined, { numeric: true, sensitivity: 'base' });
      return descending ? -comparison : comparison;
    });
    return result;
  }, [tags, filter, search, sortBy, descending]);

  const save = async (next: Tag[]) => {
    try { await api.saveTags(next); setTags(next); onError(null); } catch (error) { onError(error instanceof Error ? error.message : 'Unable to save tags'); }
  };

  const saveForm = async () => {
    if (!form.tagId.trim()) { onError('Tag ID is required.'); return; }
    const tag: Tag = { ...form, tagId: form.tagId.trim(), uid: editingUid || `tag_${Date.now()}` };
    await save(editingUid ? tags.map((item) => item.uid === editingUid ? tag : item) : [...tags, tag]);
    setForm(emptyTag); setEditingUid(null); setFormOpen(false);
  };

  const publish = async (tag: Tag, action: 'activate' | 'test' | 'stop') => {
    if (!mqtt?.connected) { onError('Connect the broker to control light strips.'); return; }
    const targets = action === 'activate' ? descendants(tags, tag) : [tag];
    try {
      await Promise.all(targets.map((item) => api.publishMqtt(topic, { Time: 5, Items: [{ TagID: item.tagId, Beep: action === 'stop' ? false : item.defaultBeep, Color: action === 'stop' ? 0 : item.defaultColor, Flashing: action === 'stop' ? false : item.defaultFlash }], Sequence: 26, Code: 131, Token: '' })));
      onError(null);
    } catch (error) { onError(error instanceof Error ? error.message : 'Unable to publish light command'); }
  };

  const publishGroup = async () => {
    try { await api.publishMqtt(topic, { Time: 1, StartGroup: 0, EndGroup: 255, StartID: '000000000000', EndID: 'FFFFFFFFFFFF', Flashing: groupFlash, Beep: groupBeep, Color: groupColor, Sequence: 19, Code: 132, Token: '' }); onError(null); }
    catch (error) { onError(error instanceof Error ? error.message : 'Unable to publish group command'); }
  };

  const update = (key: keyof Omit<Tag, 'uid'>, value: string | number | boolean) => setForm((current) => ({ ...current, [key]: value }));
  const selectedVisible = visible.filter((tag) => selected.has(tag.uid));
  const batch = async (action: 'activate' | 'test' | 'stop') => {
    await Promise.all(selectedVisible.map((tag) => publish(tag, action)));
  };
  const deleteSelected = async () => {
    if (!selectedVisible.length) return;
    await save(tags.filter((tag) => !selected.has(tag.uid)));
    setSelected(new Set());
  };

  return <div className="light-wrap">
    <section className="panel">
      <div className="panel-head"><h3>Group Light Control</h3></div>
      <div className="panel-body">
        <div className="lg-row">
          <div className="lg-colors">{colourOptions.map(([label, bit]) => <label className={`chip-color ${(groupColor & bit) ? 'checked' : ''}`} key={label}><input type="checkbox" checked={(groupColor & bit) !== 0} onChange={() => setGroupColor((value) => value ^ bit)} /><span className={`dot-color ${label.toLowerCase()}`} />{label}</label>)}</div>
          <div className="lg-toggles"><label className="lg-toggle"><span className="switch switch-sm"><input type="checkbox" checked={groupFlash} onChange={(event) => setGroupFlash(event.target.checked)} /><span className="slider" /></span>Flash</label><label className="lg-toggle"><span className="switch switch-sm"><input type="checkbox" checked={groupBeep} onChange={(event) => setGroupBeep(event.target.checked)} /><span className="slider" /></span>Beep</label></div>
          <div className="lg-preview"><span className="swatch-sm" style={{ background: swatch(groupColor) }} /><span>{groupColor ? colourOptions.filter(([, bit]) => groupColor & bit).map(([label]) => label).join(' + ') : 'No color'}</span><span className="cp-val">Color: {groupColor}</span></div>
          <button className="btn-primary btn-toggle-light" disabled={!mqtt?.connected} onClick={() => void publishGroup()} type="button">TOGGLE LIGHT GROUP</button>
        </div>
        <div className="light-status">{mqtt?.connected ? 'Ready.' : 'Connect broker to enable.'}</div>
      </div>
    </section>
    <div className="strip-toolbar"><h3>Light Strips & Tags</h3><div className="button-row"><button className="btn-ghost btn-sm" type="button">Export JSON</button><button className="btn-ghost btn-sm" type="button">Import JSON</button><button className="btn-primary btn-sm" onClick={() => { setEditingUid(null); setForm(emptyTag); setFormOpen((value) => !value); }} type="button">{formOpen ? '− Hide Add Light Strip' : '+ Add Light Strip'}</button></div></div>
    <div className={`expandable-panel ${formOpen ? 'open' : ''}`}><div className="expandable-inner"><section className="panel"><div className="panel-head"><h3>{editingUid ? `Edit Light Strip (${form.tagId})` : 'Add Light Strip'}</h3><div className="button-row"><button className="btn-sm btn-ghost" onClick={() => setForm(emptyTag)} type="button">Clear Entry</button><button className="btn-sm btn-ghost" onClick={() => setFormOpen(false)} type="button">Cancel</button></div></div><div className="panel-body">
      <div className="row2">
        <div className="field"><label>Tag type</label><select value={form.tagType} onChange={(event) => update('tagType', event.target.value)}><option>AreaTag</option><option>ShelfTag</option><option>ItemTag</option></select></div>
        <div className="field"><label>Tag ID</label><div className="input-with-actions"><input placeholder="e.g. AD1E000E9EEB" value={form.tagId} onChange={(event) => update('tagId', event.target.value)} /><div className="input-actions-inside"><button className="btn-field-icon" onClick={() => setScanTarget('tagId')} type="button" title="Scan QR / Barcode">▦</button><button className="btn-field-icon btn-clear-x" onClick={() => update('tagId', '')} type="button" title="Clear Tag ID">✕</button></div></div></div>
      </div>
      <div className="row2">
        <div className="field"><label>Tag Reference</label><div className="input-with-actions"><input placeholder="e.g. Soap SKU1" value={form.tagRef} onChange={(event) => update('tagRef', event.target.value)} /><div className="input-actions-inside"><button className="btn-field-icon" onClick={() => setScanTarget('tagRef')} type="button" title="Scan QR / Barcode">▦</button><button className="btn-field-icon btn-clear-x" onClick={() => update('tagRef', '')} type="button" title="Clear Tag Reference">✕</button></div></div></div>
        <div className="field"><label>Area ID</label><div className="input-with-actions"><input value={form.areaId} onChange={(event) => update('areaId', event.target.value)} /><div className="input-actions-inside"><button className="btn-field-icon" onClick={() => setScanTarget('areaId')} type="button" title="Scan QR / Barcode">▦</button><button className="btn-field-icon btn-clear-x" onClick={() => update('areaId', '')} type="button" title="Clear Area ID">✕</button></div></div></div>
      </div>
      <div className="row2">
        <div className="field"><label>Shop ID</label><div className="input-with-actions"><input value={form.shopId} onChange={(event) => update('shopId', event.target.value)} /><div className="input-actions-inside"><button className="btn-field-icon" onClick={() => setScanTarget('shopId')} type="button" title="Scan QR / Barcode">▦</button><button className="btn-field-icon btn-clear-x" onClick={() => update('shopId', '')} type="button" title="Clear Shop ID">✕</button></div></div></div>
        <div className="field"><label>Material ID</label><div className="input-with-actions"><input value={form.materialId} onChange={(event) => update('materialId', event.target.value)} /><div className="input-actions-inside"><button className="btn-field-icon" onClick={() => setScanTarget('materialId')} type="button" title="Scan QR / Barcode">▦</button><button className="btn-field-icon btn-clear-x" onClick={() => update('materialId', '')} type="button" title="Clear Material ID">✕</button></div></div></div>
      </div>
      <div className="field"><label>Description</label><input placeholder="e.g. Shampoo, aisle 4" value={form.description} onChange={(event) => update('description', event.target.value)} /></div>
      <div className="field"><label>Default color</label><div className="lg-colors">{colourOptions.map(([label, bit]) => <label className={`chip-color ${(form.defaultColor & bit) ? 'checked' : ''}`} key={label}><input type="checkbox" checked={(form.defaultColor & bit) !== 0} onChange={() => update('defaultColor', form.defaultColor ^ bit)} /><span className={`dot-color ${label.toLowerCase()}`} />{label}</label>)}<span className="lg-preview form-color-preview"><span className="swatch-sm" style={{ background: swatch(form.defaultColor) }} />Color: {form.defaultColor}</span></div></div>
      <div className="field form-toggle-field"><div className="lg-toggles form-toggles"><label className="lg-toggle"><span className="switch switch-sm"><input type="checkbox" checked={form.defaultFlash} onChange={(event) => update('defaultFlash', event.target.checked)} /><span className="slider" /></span>Default flash</label><label className="lg-toggle"><span className="switch switch-sm"><input type="checkbox" checked={form.defaultBeep} onChange={(event) => update('defaultBeep', event.target.checked)} /><span className="slider" /></span>Default beep</label></div></div><button className="btn-block btn-primary" onClick={() => void saveForm()} type="button">{editingUid ? 'SAVE CHANGES' : 'ADD LIGHT STRIP'}</button>
    </div></section></div></div>
    <div className="filter-sort-bar"><div className="bar-group" style={{ flex: 1 }}><label>Search:</label><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Tag ID, Ref, Material ID..." /></div><div className="bar-group"><label>Filter:</label><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="ALL">All Tag Types</option><option>AreaTag</option><option>ShelfTag</option><option>ItemTag</option></select></div><div className="bar-group"><label>Sort By:</label><select value={sortBy} onChange={(event) => setSortBy(event.target.value)}><option value="MANUAL">Manual Order</option><option value="tagId">Tag ID</option><option value="tagRef">Tag Reference</option><option value="areaId">Area ID</option><option value="shopId">Shop ID</option><option value="materialId">Material ID</option></select><button className="btn-sm btn-ghost" onClick={() => setDescending((value) => !value)} type="button">{descending ? 'DESC' : 'ASC'}</button></div><div className="bar-group batch-actions"><label><input type="checkbox" checked={visible.length > 0 && visible.every((tag) => selected.has(tag.uid))} onChange={(event) => setSelected(event.target.checked ? new Set(visible.map((tag) => tag.uid)) : new Set())} /> Select All</label><button className="btn-sm btn-accent" disabled={!selectedVisible.length} onClick={() => void batch('activate')} type="button">Batch Activate</button><button className="btn-sm btn-primary" disabled={!selectedVisible.length} onClick={() => void batch('test')} type="button">Batch Test</button><button className="btn-sm btn-danger" disabled={!selectedVisible.length} onClick={() => void batch('stop')} type="button">Batch Stop</button><button className="btn-sm btn-danger" disabled={!selectedVisible.length} onClick={() => void deleteSelected()} type="button">Batch Delete</button></div></div>
    <div className="strip-list">{!visible.length && <div className="empty-strip-hint">No matching light strips found.</div>}{visible.map((tag) => <article className={`strip-card ${selected.has(tag.uid) ? 'selected' : ''}`} key={tag.uid}><div className="strip-head"><div className="strip-title"><input className="strip-select-cb" type="checkbox" checked={selected.has(tag.uid)} onChange={(event) => setSelected((current) => { const next = new Set(current); event.target.checked ? next.add(tag.uid) : next.delete(tag.uid); return next; })} /><div className="strip-icon-box"><div className="default-icon-wrap"><TagIcon type={tag.tagType} customSrc={iconUrls[tag.tagType]} /></div></div><div><div className="strip-tagid">{tag.tagId}</div>{tag.tagRef && <div className="strip-tagref">{tag.tagRef}</div>}</div></div><span className="strip-badge"><TagIcon type={tag.tagType} customSrc={iconUrls[tag.tagType]} /> {tag.tagType}</span></div><div className="strip-kv"><div className="k">Parent</div><div className="v">{tag.parentTag || '—'}</div><div className="k">Area</div><div className="v">{tag.areaId || '—'}</div><div className="k">Shop</div><div className="v">{tag.shopId || '—'}</div><div className="k">Material</div><div className="v">{tag.materialId || '—'}</div><div className="k">Desc</div><div className="v">{tag.description || '—'}</div></div><div className="strip-defaults"><span className="strip-swatch" style={{ background: swatch(tag.defaultColor) }} /><span>Color {tag.defaultColor}</span><span>{tag.defaultBeep ? 'Beep ON' : 'Beep OFF'}</span><span>{tag.defaultFlash ? 'Flash ON' : 'Flash OFF'}</span></div><div className="strip-actions"><button className="btn-sm btn-accent" onClick={() => void publish(tag, 'activate')} type="button">Activate</button><button className="btn-sm btn-primary" onClick={() => void publish(tag, 'test')} type="button">Test</button><button className="btn-sm btn-danger" onClick={() => void publish(tag, 'stop')} type="button">Stop</button><button className="btn-sm btn-ghost" onClick={() => { setEditingUid(tag.uid); setForm(tag); setFormOpen(true); }} type="button">Edit</button><button className="btn-sm btn-ghost" onClick={() => setRemoveTag(tag)} type="button">Delete</button></div></article>)}</div>
    <ConfirmDialog open={removeTag !== null} title="Delete Light Strip" message="Are you sure you want to delete this light strip?" onCancel={() => setRemoveTag(null)} onConfirm={() => { if (removeTag) void save(tags.filter((tag) => tag.uid !== removeTag.uid)); setRemoveTag(null); }} />
    <ScannerModal open={scanTarget !== null} onClose={() => setScanTarget(null)} onDetected={(value) => { if (scanTarget) update(scanTarget, value); setScanTarget(null); }} />
  </div>;
}
