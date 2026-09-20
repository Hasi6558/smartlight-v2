import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import type { MqttStatus, Picklist, PicklistItem, PicklistTemplate, Sku, Tag } from '../../types/api';
import { Modal, ConfirmDialog } from '../../components/Modal';
import { ScannerModal } from '../../components/ScannerModal';

interface Props { mqtt: MqttStatus | null; onError: (message: string | null) => void; }
const colors = [1, 2, 3, 4, 5, 6, 7];

function cascade(tags: Tag[], tagId: string) {
  const start = tags.find((tag) => tag.tagId === tagId);
  if (!start) return [];
  const result = new Map<string, Tag>();
  const visit = (tag: Tag) => {
    if (result.has(tag.uid)) return;
    result.set(tag.uid, tag);
    if (tag.parentTag) {
      const parent = tags.find((item) => item.tagId === tag.parentTag);
      if (parent) visit(parent);
    }
    tags.filter((item) => item.parentTag === tag.tagId).forEach(visit);
  };
  visit(start);
  return [...result.values()];
}

export function PicklistsPage({ mqtt, onError }: Props) {
  const [lists, setLists] = useState<Picklist[]>([]);
  const [templates, setTemplates] = useState<PicklistTemplate[]>([]);
  const [skus, setSkus] = useState<Sku[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [type, setType] = useState<'PICKLIST' | 'PUTAWAY'>('PICKLIST');
  const [draftItems, setDraftItems] = useState<PicklistItem[]>([]);
  const [skuNo, setSkuNo] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [listNo, setListNo] = useState('');
  const [orderNo, setOrderNo] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [search, setSearch] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedTemplates, setExpandedTemplates] = useState<Set<string>>(new Set());
  const [deleteTemplate, setDeleteTemplate] = useState<PicklistTemplate | null>(null);
  const [expandedLists, setExpandedLists] = useState<Set<string>>(new Set());
  const [deleteList, setDeleteList] = useState<Picklist | null>(null);
  const [viewList, setViewList] = useState<Picklist | null>(null);
  const [itemConfirmSku, setItemConfirmSku] = useState<Sku | null>(null);
  const [scannerTarget, setScannerTarget] = useState<'order' | 'sku' | null>(null);

  const load = async () => {
    const [loadedLists, loadedTemplates, loadedSkus, loadedTags] = await Promise.all([api.getPicklists(), api.getPicklistTemplates(), api.getSkus(), api.getTags()]);
    setLists(loadedLists); setTemplates(loadedTemplates); setSkus(loadedSkus); setTags(loadedTags);
  };
  useEffect(() => { load().catch((error: unknown) => onError(error instanceof Error ? error.message : 'Unable to load picklists')); }, [onError]);

  const filteredLists = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return lists.filter((list) => showHistory || list.createdAt.slice(0, 10) === today).filter((list) => list.listNo.toLowerCase().includes(search.toLowerCase()) || list.orderNo.toLowerCase().includes(search.toLowerCase()));
  }, [lists, search, showHistory]);

  const prepareList = async (nextType: 'PICKLIST' | 'PUTAWAY') => {
    setType(nextType);
    setDraftItems([]);
    try {
      const numbers = await api.getNextNumbers(nextType);
      setOrderNo(numbers.orderNo); setListNo(numbers.listNo); onError(null);
      setCreateOpen(true);
    } catch (error) { onError(error instanceof Error ? error.message : 'Unable to allocate list numbers'); }
  };

  const addTemplateToToday = async (template: PicklistTemplate) => {
    try {
      const numbers = await api.getNextNumbers(template.type);
      const list: Picklist = { uid: `list_${Date.now()}`, type: template.type, orderNo: numbers.orderNo, listNo: numbers.listNo, status: 'PENDING', items: template.items.map((item) => ({ ...item })), createdAt: new Date().toISOString() };
      const next = [list, ...lists];
      await api.savePicklists(next); setLists(next); onError(null);
    } catch (error) { onError(error instanceof Error ? error.message : 'Unable to add template to today'); }
  };

  const removeTemplate = async () => {
    if (!deleteTemplate) return;
    try { const next = templates.filter((template) => template.uid !== deleteTemplate.uid); await api.savePicklistTemplates(next); setTemplates(next); setDeleteTemplate(null); }
    catch (error) { onError(error instanceof Error ? error.message : 'Unable to delete template'); }
  };

  const removeList = async () => {
    if (!deleteList) return;
    try {
      const next = lists.filter((list) => list.uid !== deleteList.uid);
      await api.savePicklists(next);
      setLists(next);
      setDeleteList(null);
      onError(null);
    } catch (error) { onError(error instanceof Error ? error.message : 'Unable to delete list'); }
  };

  const addItem = () => {
    const sku = itemConfirmSku;
    const qty = Number(quantity);
    if (!sku || !Number.isInteger(qty) || qty < 1) { onError('Choose a valid SKU and positive quantity.'); return; }
    const existing = draftItems.find((item) => item.skuNo === sku.skuNo);
    setDraftItems(existing ? draftItems.map((item) => item.skuNo === sku.skuNo ? { ...item, quantity: item.quantity + qty } : item) : [...draftItems, { ...sku, quantity: qty }]);
    setSkuNo(''); setItemSearch(''); setQuantity('1'); setItemConfirmSku(null); onError(null);
  };

  const selectSku = (value: string) => {
    const sku = skus.find((item) => item.skuNo === value);
    if (!sku) return;
    setSkuNo(sku.skuNo);
    setItemConfirmSku(sku);
    setQuantity('1');
  };

  const handleScan = (value: string) => {
    setScannerTarget(null);
    if (scannerTarget === 'order') setOrderNo(value);
    else if (scannerTarget === 'sku') selectSku(value);
  };

  const saveList = async () => {
    if (!draftItems.length) { onError('Add at least one item to the list.'); return; }
    const list: Picklist = { uid: `list_${Date.now()}`, type, orderNo, listNo, status: 'PENDING', color: colors[lists.length % colors.length], items: draftItems, createdAt: new Date().toISOString() };
    setBusy(true);
    try { await api.savePicklists([list, ...lists]); setLists([list, ...lists]); setDraftItems([]); onError(null); }
    catch (error) { onError(error instanceof Error ? error.message : 'Unable to save list'); }
    finally { setBusy(false); }
  };

  const updateList = async (list: Picklist, status: Picklist['status']) => {
    if (status === 'ACTIVE' && !mqtt?.connected) { onError('Connect the MQTT broker before activating a list.'); return; }
    setBusy(true);
    try {
      if (status === 'ACTIVE') {
        const tagItems = [...new Map(list.items.flatMap((item) => cascade(tags, item.tagBind)).map((tag) => [tag.uid, tag])).values()];
        await api.publishMqtt('/estation/7301A67/recv', { Time: 5, Items: tagItems.map((tag) => ({ TagID: tag.tagId, Beep: true, Color: list.color || 1, Flashing: true })), Sequence: 26, Code: 131, Token: '' });
      }
      if (status === 'COMPLETED') await api.commitList(list.orderNo, list.listNo, list.items.map((item) => ({ skuNo: item.skuNo, quantityDelta: (list.type === 'PUTAWAY' ? 1 : -1) * item.quantity })));
      if (status === 'COMPLETED' || status === 'CANCELLED') {
        const tagItems = list.items.flatMap((item) => cascade(tags, item.tagBind));
        if (mqtt?.connected && tagItems.length) await api.publishMqtt('/estation/7301A67/recv', { Time: 5, Items: tagItems.map((tag) => ({ TagID: tag.tagId, Beep: false, Color: 0, Flashing: false })), Sequence: 26, Code: 131, Token: '' });
      }
      const updated = lists.map((item) => item.uid === list.uid ? { ...item, status, activatedAt: status === 'ACTIVE' ? new Date().toISOString() : item.activatedAt, completedAt: status === 'COMPLETED' || status === 'CANCELLED' ? new Date().toISOString() : item.completedAt } : item);
      await api.savePicklists(updated); setLists(updated); onError(null);
    } catch (error) { onError(error instanceof Error ? error.message : 'Unable to update list'); }
    finally { setBusy(false); }
  };

  const saveTemplate = async () => {
    if (!templateName.trim() || !draftItems.length) { onError('Enter a template name and add at least one item.'); return; }
    const template: PicklistTemplate = { uid: `template_${Date.now()}`, name: templateName.trim(), type, items: draftItems, createdAt: new Date().toISOString() };
    try { await api.savePicklistTemplates([template, ...templates]); setTemplates([template, ...templates]); setTemplateName(''); onError(null); }
    catch (error) { onError(error instanceof Error ? error.message : 'Unable to save template'); }
  };

  return <div className="home-wrap">
    <div className="strip-toolbar"><div><h3>Home</h3><p className="hint">Create and manage Picklists (outbound) and Putaway Lists (inbound) for the warehouse.</p></div></div>
    <div className="home-launcher-row"><button className="home-launcher-btn" onClick={() => void prepareList('PICKLIST')} type="button"><span className="home-launcher-icon"><svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v13H6V4a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M14 3v4h4M9 13h4M17 15v5M14.5 17.5h5" fill="none" stroke="currentColor" strokeWidth="1.8"/></svg></span><span className="home-launcher-label">Create Picklist</span><span className="home-launcher-sub">Subtract stock · outbound</span></button><button className="home-launcher-btn" onClick={() => void prepareList('PUTAWAY')} type="button"><span className="home-launcher-icon"><svg viewBox="0 0 24 24"><path d="m3 8 9-5 9 5v9l-9 5-9-5Z" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="m3 8 9 5 9-5M12 13v8M17 15v5M14.5 17.5h5" fill="none" stroke="currentColor" strokeWidth="1.8"/></svg></span><span className="home-launcher-label">Create Putaway List</span><span className="home-launcher-sub">Add stock · inbound (GRN)</span></button></div>
    <section className="panel">
      <div className="section-heading"><h2>{showHistory ? 'All lists' : "Today's lists"}</h2><div className="toolbar"><input placeholder="Search list number..." value={search} onChange={(event) => setSearch(event.target.value)} /><button className="button secondary" onClick={() => setShowHistory(!showHistory)} type="button">{showHistory ? 'Today' : 'History'}</button></div></div>
      <div className="list-card-stack">{filteredLists.map((list) => {
        const expanded = !expandedLists.has(list.uid);
        return <article className={`list-card status-${list.status.toLowerCase()}`} key={list.uid}>
          <div className="list-card-head" onClick={() => setExpandedLists((current) => { const next = new Set(current); expanded ? next.add(list.uid) : next.delete(list.uid); return next; })} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setExpandedLists((current) => { const next = new Set(current); expanded ? next.add(list.uid) : next.delete(list.uid); return next; }); } }}>
            <span className="list-card-chevron">{expanded ? '⌄' : '›'}</span><div className="list-card-ids"><span className="listno">{list.listNo}</span><span className="orderno">{list.orderNo} · {list.type}</span></div><span className="strip-badge">{list.status}</span>
            <div className="list-card-actions" onClick={(event) => event.stopPropagation()}><button className="btn-sm btn-ghost" onClick={() => setViewList(list)} type="button">View More</button><button className="btn-sm btn-danger" onClick={() => setDeleteList(list)} type="button">Delete</button>{list.status === 'PENDING' && <button className="btn-sm btn-accent" disabled={busy} onClick={() => void updateList(list, 'ACTIVE')} type="button">Activate</button>}{list.status === 'ACTIVE' && <button className="btn-sm btn-primary" disabled={busy} onClick={() => void updateList(list, 'COMPLETED')} type="button">Complete</button>}{list.status === 'ACTIVE' && <button className="btn-sm btn-danger" disabled={busy} onClick={() => void updateList(list, 'CANCELLED')} type="button">Cancel</button>}</div>
          </div>
          <div className={`list-card-body ${expanded ? 'open' : ''}`}><div className="list-card-body-inner">{list.items.map((item) => <div className="list-item-row" key={item.skuNo}><div className="list-item-meta"><span className="sku">{item.skuNo}</span><span className="label">{item.itemLabel}</span><span className="desc">{item.description}</span></div><span className="list-item-qty">× {item.quantity}</span></div>)}</div></div>
        </article>;
      })}</div>
    </section>
    <button className="template-drawer-toggle" onClick={() => setTemplatesOpen((value) => !value)} type="button"><span>Templates</span><span>‹</span></button><aside className={`template-drawer ${templatesOpen ? 'active' : ''}`}><div className="template-drawer-head"><h3>Saved Templates</h3><button className="btn-sm btn-ghost" onClick={() => setTemplatesOpen(false)} type="button">✕</button></div><div className="template-drawer-body">{templates.length ? templates.map((template) => { const expanded = expandedTemplates.has(template.uid); return <div className="template-card" key={template.uid}><button className="template-card-head" onClick={() => setExpandedTemplates((current) => { const next = new Set(current); expanded ? next.delete(template.uid) : next.add(template.uid); return next; })} type="button"><span className="list-card-chevron">{expanded ? '⌄' : '›'}</span><span className={`list-type-badge ${template.type}`}>{template.type}</span><span>{template.name}</span></button>{expanded && <div className="template-card-body"><div className="template-card-actions"><button className="btn-sm btn-primary" onClick={() => void addTemplateToToday(template)} type="button">Add to Today's List</button><button className="btn-sm btn-ghost" onClick={() => setCreateOpen(true)} type="button">View More</button><button className="btn-sm btn-ghost" onClick={() => { setType(template.type); setDraftItems(template.items); setTemplateName(template.name); setCreateOpen(true); }} type="button">Edit</button><button className="btn-sm btn-danger" onClick={() => setDeleteTemplate(template)} type="button">Delete</button></div>{template.items.map((item) => <div className="list-item-row" key={item.skuNo}><div className="list-item-meta"><span className="sku">{item.skuNo}</span><span className="label">{item.itemLabel}</span></div><span className="list-item-qty">{item.quantity}</span></div>)}</div>}</div>; }) : <div className="empty-strip-hint">No templates saved yet.</div>}</div></aside>
    <Modal open={createOpen} title={type === 'PUTAWAY' ? 'Create Putaway List' : 'Create Picklist'} maxWidth={680} onClose={() => setCreateOpen(false)}>
      <div className="picklist-create-modal">
      <div className="row2">
        <div className="field">
          <label>Order Number</label>
          <div className="input-with-actions">
            <input placeholder="Leave blank to auto-generate" value={orderNo} onChange={(event) => setOrderNo(event.target.value)} />
            <div className="input-actions-inside">
              <button className="btn-field-icon btn-scan-qr" title="Scan order number" onClick={() => setScannerTarget('order')} type="button">▦</button>
              <button className="btn-field-icon btn-clear-x" title="Clear order number" onClick={() => setOrderNo('')} type="button">✕</button>
            </div>
          </div>
        </div>
        <div className="field">
          <label>{type === 'PUTAWAY' ? 'Putaway Number' : 'Picklist Number'}</label>
          <input disabled value={listNo} readOnly />
        </div>
      </div>
      <div className="field" style={{ borderTop: '1px solid var(--line)', marginTop: 4, paddingTop: 12 }}>
        <label>Scan Item SKU</label>
        <div className="input-with-actions">
          <input placeholder="Scan or enter SKU, then press Enter" value={skuNo} onChange={(event) => setSkuNo(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); selectSku(skuNo.trim()); } }} />
          <div className="input-actions-inside">
            <button className="btn-field-icon btn-scan-qr" title="Scan item SKU" onClick={() => setScannerTarget('sku')} type="button">▦</button>
            <button className="btn-field-icon btn-clear-x" title="Clear SKU" onClick={() => { setSkuNo(''); setItemConfirmSku(null); }} type="button">✕</button>
          </div>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>{itemConfirmSku ? `Selected: ${itemConfirmSku.skuNo} — ${itemConfirmSku.itemLabel}` : 'Scan an SKU or select a matching item below.'}</div>
        <label style={{ marginTop: 10 }}>Filter items</label>
        <input placeholder="Filter by SKU or item label..." value={itemSearch} onChange={(event) => setItemSearch(event.target.value)} />
        <select value={skuNo} onChange={(event) => selectSku(event.target.value)} style={{ marginTop: 8 }}>
          <option value="">Select a matching item...</option>
          {skus.filter((sku) => `${sku.skuNo} ${sku.itemLabel}`.toLowerCase().includes(itemSearch.toLowerCase())).map((sku) => <option key={sku.skuNo} value={sku.skuNo}>{sku.skuNo} — {sku.itemLabel}</option>)}
        </select>
      </div>
      <div className="table-wrap" style={{ maxHeight: 260, marginTop: 10 }}>
        <table className="cl-item-table"><thead><tr><th>SKU</th><th>Item Label</th><th>Description</th><th>Qty</th><th /></tr></thead><tbody>
          {draftItems.length ? draftItems.map((item) => <tr key={item.skuNo}><td>{item.skuNo}</td><td>{item.itemLabel}</td><td>{item.description || '—'}</td><td>{item.quantity}</td><td><button className="btn-sm btn-danger" onClick={() => setDraftItems((current) => current.filter((entry) => entry.skuNo !== item.skuNo))} type="button">✕</button></td></tr>) : <tr className="empty-row"><td colSpan={5}>No items added yet.</td></tr>}
        </tbody></table>
      </div>
      <div className="modal-actions"><button className="btn-ghost" onClick={() => setCreateOpen(false)} type="button">Cancel</button><button className="btn-ghost" disabled={!draftItems.length} onClick={() => void saveTemplate()} type="button">Save List as Template</button><button className="btn-primary" disabled={!draftItems.length} onClick={() => void saveList().then(() => setCreateOpen(false))} type="button">Save &amp; Publish List</button></div>
      </div>
    </Modal>
    <Modal open={itemConfirmSku !== null} title="Confirm Item" maxWidth={360} onClose={() => setItemConfirmSku(null)}>
      {itemConfirmSku && <div className="picklist-item-confirm">
        {itemConfirmSku.productImage ? <img src={itemConfirmSku.productImage} alt={itemConfirmSku.itemLabel || itemConfirmSku.skuNo} /> : <div className="picklist-item-image-empty">No image available</div>}
        <strong className="sku-number">{itemConfirmSku.skuNo}</strong>
        <div className="picklist-item-label">{itemConfirmSku.itemLabel}</div>
        <div className="hint">{itemConfirmSku.description || 'No description'}</div>
        <div className="field" style={{ marginTop: 14 }}><label>Quantity</label><div className="cl-qty-stepper"><button className="btn-sm btn-ghost" onClick={() => setQuantity(String(Math.max(1, Number(quantity) - 1)))} type="button">−</button><input type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /><button className="btn-sm btn-ghost" onClick={() => setQuantity(String(Number(quantity) + 1))} type="button">+</button></div></div>
        <button className="btn-primary" onClick={addItem} style={{ marginTop: 12, width: '100%' }} type="button">+ Add Item</button>
      </div>}
    </Modal>
    <ScannerModal open={scannerTarget !== null} onClose={() => setScannerTarget(null)} onDetected={handleScan} />
    <ConfirmDialog open={deleteTemplate !== null} title="Delete Template" message={`Are you sure you want to delete ${deleteTemplate?.name || 'this template'}?`} onCancel={() => setDeleteTemplate(null)} onConfirm={() => void removeTemplate()} />
    <ConfirmDialog open={deleteList !== null} title="Delete List" message={`Are you sure you want to delete ${deleteList?.listNo || 'this list'}?`} onCancel={() => setDeleteList(null)} onConfirm={() => void removeList()} />
    <Modal open={viewList !== null} title={viewList ? `${viewList.type === 'PUTAWAY' ? 'Putaway List' : 'Picklist'} · ${viewList.listNo}` : 'List Details'} maxWidth={620} onClose={() => setViewList(null)}>
      {viewList && <><div className="hint" style={{ marginBottom: 12 }}>Order: {viewList.orderNo}</div>{viewList.items.map((item) => <div className="list-view-item" key={item.skuNo}>{item.productImage ? <img src={item.productImage} alt={item.itemLabel || item.skuNo} /> : <div className="list-view-no-image">No image</div>}<div className="list-item-meta"><span className="sku">{item.skuNo}</span><span className="label">{item.itemLabel}</span><span className="desc">{item.description || '—'}</span></div><span className="list-item-qty">× {item.quantity}</span></div>)}</>}
    </Modal>
  </div>;
}
