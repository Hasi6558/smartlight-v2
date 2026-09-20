import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client';
import type { InventoryRecord, Sku, StockTransaction, Tag } from '../../types/api';
import { Modal, ConfirmDialog } from '../../components/Modal';
import { ScannerModal } from '../../components/ScannerModal';

declare const XLSX: {
  utils: {
    json_to_sheet: (data: unknown[]) => unknown;
    sheet_to_json: (sheet: unknown, options?: { defval?: string }) => Array<Record<string, unknown>>;
    book_new: () => unknown;
    book_append_sheet: (book: unknown, sheet: unknown, name: string) => void;
  };
  writeFile: (book: unknown, filename: string) => void;
  read: (data: ArrayBuffer, options: { type: string }) => { Sheets: Record<string, unknown>; SheetNames: string[] };
};

interface Props { onError: (message: string | null) => void; }
type ScannerTarget = 'skuNo' | 'tagBind' | null;

const emptySku: Sku = { skuNo: '', itemLabel: '', description: '', supplierCustomer: '', tagBind: '', dateAdded: '', productImage: '' };
const text = (value: unknown) => String(value ?? '');

function Field({ label, value, onChange, placeholder, type = 'text', disabled = false, onScan }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; disabled?: boolean; onScan?: () => void;
}) {
  return <label className="field">{label}<div className="input-with-actions">
    <input type={type} value={value} disabled={disabled} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    {!disabled && <div className="input-actions-inside">{onScan && <button className="btn-field-icon btn-scan-qr" onClick={onScan} type="button" title={`Scan ${label}`}>▦</button>}<button className="btn-field-icon btn-clear-x" onClick={() => onChange('')} type="button" title={`Clear ${label}`}>✕</button></div>}
  </div></label>;
}

export function InventoryPage({ onError }: Props) {
  const [skus, setSkus] = useState<Sku[]>([]);
  const [inventory, setInventory] = useState<InventoryRecord[]>([]);
  const [transactions, setTransactions] = useState<StockTransaction[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [skuForm, setSkuForm] = useState<Sku>(emptySku);
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'skus' | 'inventory' | 'transactions'>('skus');
  const [busy, setBusy] = useState(false);
  const [skuModalOpen, setSkuModalOpen] = useState(false);
  const [detailSku, setDetailSku] = useState<Sku | InventoryRecord | null>(null);
  const [deleteSkuNo, setDeleteSkuNo] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dbLocked, setDbLocked] = useState(true);
  const [dateRange, setDateRange] = useState('ALL');
  const [tagFilter, setTagFilter] = useState('ALL');
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [scannerTarget, setScannerTarget] = useState<ScannerTarget>(null);
  const [importInput, setImportInput] = useState<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [adjustments, setAdjustments] = useState<Record<string, string>>({});

  const load = async () => {
    const [loadedSkus, loadedInventory, loadedTransactions, loadedTags] = await Promise.all([
      api.getSkus(), api.getInventory(), api.getTransactions(), api.getTags(),
    ]);
    setSkus(loadedSkus); setInventory(loadedInventory); setTransactions(loadedTransactions); setTags(loadedTags);
  };
  useEffect(() => { load().catch((error: unknown) => onError(error instanceof Error ? error.message : 'Unable to load inventory data')); }, [onError]);

  const visibleSkus = useMemo(() => {
    const now = new Date();
    return skus.filter((sku) => {
      const filters: Record<string, string> = {
        skuNo: sku.skuNo, label: sku.itemLabel, description: sku.description,
        supplier: sku.supplierCustomer, tag: sku.tagBind, date: sku.dateAdded,
      };
      if (Object.entries(columnFilters).some(([key, value]) => value && !filters[key].toLowerCase().includes(value.toLowerCase()))) return false;
      if (search && !Object.values(filters).some((value) => value.toLowerCase().includes(search.toLowerCase()))) return false;
      if (tagFilter === 'BOUND' && !sku.tagBind || tagFilter === 'UNBOUND' && sku.tagBind) return false;
      if (dateRange !== 'ALL' && sku.dateAdded) {
        const date = new Date(sku.dateAdded);
        const days = Math.floor((now.getTime() - date.getTime()) / 86400000);
        if (dateRange === 'TODAY' && sku.dateAdded !== now.toISOString().slice(0, 10)) return false;
        if (dateRange === 'WEEK' && (days < 0 || days > 7)) return false;
        if ((dateRange === 'MONTH' || dateRange === '30DAYS') && (days < 0 || days > 30)) return false;
      }
      return true;
    });
  }, [skus, search, columnFilters, dateRange, tagFilter]);
  const visibleInventory = useMemo(() => inventory.filter((item) => [item.skuNo, item.itemLabel, item.description, item.supplierCustomer].some((value) => value.toLowerCase().includes(search.toLowerCase()))), [inventory, search]);

  const updateForm = (key: keyof Sku, value: string) => setSkuForm((current) => ({ ...current, [key]: value }));
  const resetForm = () => { setSkuForm(emptySku); if (imageInputRef.current) imageInputRef.current.value = ''; };
  const saveSku = async () => {
    if (!skuForm.skuNo.trim() || !skuForm.itemLabel.trim()) { onError('SKU number and item label are required.'); return; }
    const next = { ...skuForm, skuNo: skuForm.skuNo.trim(), itemLabel: skuForm.itemLabel.trim(), dateAdded: skuForm.dateAdded || new Date().toISOString().slice(0, 10) };
    const nextSkus = editingSku ? skus.map((sku) => sku.skuNo === editingSku ? next : sku) : [...skus, next];
    setBusy(true);
    try { await api.saveSkus(nextSkus); setSkus(nextSkus); resetForm(); setEditingSku(null); setSkuModalOpen(false); onError(null); }
    catch (error) { onError(error instanceof Error ? error.message : 'Unable to save SKU'); } finally { setBusy(false); }
  };
  const deleteSelected = async () => {
    const next = skus.filter((sku) => !selected.has(sku.skuNo));
    setBusy(true);
    try { await api.saveSkus(next); setSkus(next); setSelected(new Set()); onError(null); }
    catch (error) { onError(error instanceof Error ? error.message : 'Unable to delete SKUs'); } finally { setBusy(false); }
  };
  const importExcel = async (file: File) => {
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
      const imported = rows.map((row) => ({ skuNo: text(row.skuNo || row['SKU No'] || row.SKU), itemLabel: text(row.itemLabel || row['Item Label']), description: text(row.description || row.Description), supplierCustomer: text(row.supplierCustomer || row.Supplier), tagBind: text(row.tagBind || row['Tag Bind']), dateAdded: text(row.dateAdded || row['Date Added']) || new Date().toISOString().slice(0, 10), productImage: text(row.productImage || row.Image) })).filter((sku) => sku.skuNo && sku.itemLabel);
      await api.saveSkus([...skus.filter((sku) => !imported.some((item) => item.skuNo === sku.skuNo)), ...imported]); await load(); onError(null);
    } catch (error) { onError(error instanceof Error ? error.message : 'Unable to import Excel file'); }
  };
  const exportTemplate = () => { const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ skuNo: '', itemLabel: '', description: '', supplierCustomer: '', tagBind: '', dateAdded: '', productImage: '' }]), 'SKUs'); XLSX.writeFile(book, 'SKU_Import_Template.xlsx'); };
  const adjust = async (skuNo: string) => {
    const delta = Number(adjustments[skuNo]);
    if (!Number.isInteger(delta) || delta === 0) { onError('Enter a non-zero whole-number adjustment.'); return; }
    setBusy(true); try { await api.adjustInventory(skuNo, delta); setAdjustments((current) => ({ ...current, [skuNo]: '' })); await load(); onError(null); } catch (error) { onError(error instanceof Error ? error.message : 'Unable to adjust inventory'); } finally { setBusy(false); }
  };

  const openAdd = () => { resetForm(); setEditingSku(null); setSkuModalOpen(true); };
  const openEdit = (sku: Sku) => { setSkuForm(sku); setEditingSku(sku.skuNo); setSkuModalOpen(true); };
  const setImage = (file: File | undefined) => { if (!file) return; const reader = new FileReader(); reader.onload = () => updateForm('productImage', text(reader.result)); reader.readAsDataURL(file); };

  return <div className="sku-wrap">
    <div className="strip-toolbar"><div><h3>Warehouse Database · SKU Management</h3><p className="hint">Manage item SKUs, descriptions, supplier/customer ties, and tag bindings stored in SQLite.</p></div>
      <div className="button-row"><button className="btn-sm btn-ghost" onClick={exportTemplate} type="button">Export Excel Template</button><button className="btn-sm btn-ghost" onClick={() => importInput?.click()} type="button">Import Excel</button><button className="btn-sm btn-danger" onClick={() => setDbLocked(!dbLocked)} type="button">{dbLocked ? 'SKU DB LOCKED' : 'SKU DB UNLOCKED'}</button><button className="btn-sm btn-primary" disabled={dbLocked} onClick={openAdd} type="button">+ Add SKU Item</button><input ref={(node) => setImportInput(node)} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importExcel(file); event.target.value = ''; }} /></div>
    </div>
    <div className="button-row inventory-tabs"><button className="btn-sm btn-ghost" onClick={() => setTab('skus')} type="button">SKU Database</button><button className="btn-sm btn-ghost" onClick={() => setTab('inventory')} type="button">Inventory</button><button className="btn-sm btn-ghost" onClick={() => setTab('transactions')} type="button">Transactions</button></div>
    <div className="filter-sort-bar inventory-search-bar"><div className="bar-group bar-group--grow-260"><label>Central Search:</label><div className="input-with-actions"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by SKU No or Item Label..." /><div className="input-actions-inside"><button className="btn-field-icon btn-clear-x" onClick={() => setSearch('')} type="button">✕</button></div></div></div></div>
    {tab === 'skus' && <><div className="filter-sort-bar"><div className="bar-group"><label>Date Range:</label><select value={dateRange} onChange={(event) => setDateRange(event.target.value)}><option value="ALL">All Time</option><option value="TODAY">Today</option><option value="WEEK">This Week</option><option value="MONTH">This Month</option><option value="30DAYS">Past 30 Days</option></select></div><div className="bar-group"><label>Tag Bind Filter:</label><select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}><option value="ALL">All Tags</option><option value="BOUND">Bound Only</option><option value="UNBOUND">Unbound Only</option></select></div><label className="select-all"><input type="checkbox" checked={visibleSkus.length > 0 && visibleSkus.every((sku) => selected.has(sku.skuNo))} onChange={(event) => setSelected(event.target.checked ? new Set(visibleSkus.map((sku) => sku.skuNo)) : new Set())} /> Select All</label><button className="btn-sm btn-danger" disabled={dbLocked || selected.size === 0 || busy} onClick={() => void deleteSelected()} type="button">Batch Delete</button></div>
      <section className="panel sku-database-panel"><div className="panel-head"><h3>SKU Inventory Table</h3><span className="hint">Filter across column headers simultaneously</span></div><div className="table-wrap sku-database-table-wrap"><table className="sku-table-responsive"><thead><tr><th></th><th>Image</th>{[['skuNo', 'SKU No'], ['label', 'Item Label'], ['description', 'Description'], ['supplier', 'Supplier / Customer'], ['tag', 'Tag Bind'], ['date', 'Date Added']].map(([key, label]) => <th key={key}>{label}<input className="table-header-filter" value={columnFilters[key] || ''} onChange={(event) => setColumnFilters({ ...columnFilters, [key]: event.target.value })} placeholder="Filter..." /></th>)}<th>Actions</th></tr></thead><tbody>{visibleSkus.map((sku) => <tr key={sku.skuNo}><td><input type="checkbox" checked={selected.has(sku.skuNo)} onChange={(event) => { const next = new Set(selected); event.target.checked ? next.add(sku.skuNo) : next.delete(sku.skuNo); setSelected(next); }} /></td><td>{sku.productImage ? <img className="sku-thumb-btn" src={sku.productImage} alt="" onClick={() => setDetailSku(sku)} /> : 'No img'}</td><td>{sku.skuNo}</td><td>{sku.itemLabel}</td><td>{sku.description || '—'}</td><td>{sku.supplierCustomer || '—'}</td><td>{sku.tagBind || '—'}</td><td>{sku.dateAdded || '—'}</td><td><button className="btn-sm btn-view-more" onClick={() => setDetailSku(sku)} type="button">View More</button>{!dbLocked && <><button className="btn-sm btn-ghost" onClick={() => openEdit(sku)} type="button">Edit</button><button className="btn-sm btn-ghost danger-text" onClick={() => setDeleteSkuNo(sku.skuNo)} type="button">Delete</button></>}</td></tr>)}</tbody></table></div></section></>}
    {tab === 'inventory' && <section className="panel"><div className="panel-head"><h3>Inventory List</h3><span className="hint">Stock adjustments and product images</span></div><div className="table-wrap"><table className="sku-table-responsive"><thead><tr><th>Image</th><th>SKU No</th><th>Item Label</th><th>Description</th><th>Supplier</th><th>Stock (Qty)</th><th>Actions</th></tr></thead><tbody>{visibleInventory.map((item) => <tr key={item.skuNo}><td>{item.productImage ? <img className="table-product-image" src={item.productImage} alt="" onClick={() => setDetailSku(item)} /> : '—'}</td><td>{item.skuNo}</td><td>{item.itemLabel}</td><td>{item.description || '—'}</td><td>{item.supplierCustomer || '—'}</td><td className={item.stock <= 0 ? 'stock-danger' : 'stock-good'}>{item.stock}</td><td><div className="table-action-group"><input type="number" placeholder="+/-" value={adjustments[item.skuNo] || ''} onChange={(event) => setAdjustments({ ...adjustments, [item.skuNo]: event.target.value })} /><button className="btn-sm btn-primary" disabled={busy} onClick={() => void adjust(item.skuNo)} type="button">Adjust</button><button className="btn-sm btn-view-more" onClick={() => setDetailSku(item)} type="button">View More</button></div></td></tr>)}</tbody></table></div></section>}
    {tab === 'transactions' && <section className="panel"><div className="panel-head"><h3>Transaction Logs</h3></div><div className="table-wrap"><table className="sku-table-responsive"><thead><tr><th>Timestamp</th><th>Order No</th><th>PickList No</th><th>SKU Number</th><th>Item Label</th><th>Description</th><th>Quantity</th></tr></thead><tbody>{transactions.filter((tx) => [tx.orderNo, tx.picklistNo, tx.skuNo, tx.itemLabel].some((value) => value.toLowerCase().includes(search.toLowerCase()))).map((tx) => <tr key={tx.id}><td>{tx.timestamp}</td><td>{tx.orderNo}</td><td>{tx.picklistNo}</td><td>{tx.skuNo}</td><td>{tx.itemLabel}</td><td>{tx.description || '—'}</td><td className={tx.quantity < 0 ? 'stock-danger' : 'stock-good'}>{tx.quantity > 0 ? '+' : ''}{tx.quantity}</td></tr>)}</tbody></table></div></section>}
    <Modal open={skuModalOpen} title={editingSku ? `Edit SKU Item (${editingSku})` : 'Add SKU Item'} maxWidth={620} onClose={() => setSkuModalOpen(false)}><div className="form-grid"><Field label="SKU No *" value={skuForm.skuNo} disabled={!!editingSku} onChange={(value) => updateForm('skuNo', value)} onScan={() => setScannerTarget('skuNo')} placeholder="e.g. SKU-880912" /><Field label="Item Label *" value={skuForm.itemLabel} onChange={(value) => updateForm('itemLabel', value)} /><Field label="Supplier / Customer" value={skuForm.supplierCustomer} onChange={(value) => updateForm('supplierCustomer', value)} /><label className="field">Tag Bind<div className="input-with-actions"><input list="sku-tags" value={skuForm.tagBind} onChange={(event) => updateForm('tagBind', event.target.value)} placeholder="Search or enter Tag ID" /><div className="input-actions-inside"><button className="btn-field-icon btn-scan-qr" onClick={() => setScannerTarget('tagBind')} type="button">▦</button><button className="btn-field-icon btn-clear-x" onClick={() => updateForm('tagBind', '')} type="button">✕</button></div></div><datalist id="sku-tags">{tags.map((tag) => <option key={tag.uid} value={tag.tagId} />)}</datalist></label><label className="field full-width">Description<div className="input-with-actions"><textarea value={skuForm.description} onChange={(event) => updateForm('description', event.target.value)} /><div className="input-actions-inside"><button className="btn-field-icon btn-clear-x" onClick={() => updateForm('description', '')} type="button">✕</button></div></div></label><div className="field full-width"><label>Product Image</label><div className="button-row"><button className="btn-sm btn-ghost" onClick={() => imageInputRef.current?.click()} type="button">Choose Image File</button><button className="btn-sm btn-danger" onClick={() => updateForm('productImage', '')} type="button">Remove Image</button><input ref={imageInputRef} type="file" accept="image/*" hidden onChange={(event) => setImage(event.target.files?.[0])} />{skuForm.productImage && <img className="sku-form-image" src={skuForm.productImage} alt="Preview" />}</div></div></div><div className="modal-actions"><button className="btn-ghost" onClick={resetForm} type="button">Clear Entry</button><button className="btn-ghost" onClick={() => setSkuModalOpen(false)} type="button">Cancel</button><button className="btn-primary" disabled={busy} onClick={() => void saveSku()} type="button">Save SKU</button></div></Modal>
    <Modal open={detailSku !== null} title={detailSku ? `SKU Details · ${detailSku.skuNo}` : 'SKU Details'} maxWidth={520} onClose={() => setDetailSku(null)}>{detailSku && <div className="sku-detail"><div className="sku-detail-image">{detailSku.productImage ? <img src={detailSku.productImage} alt={detailSku.itemLabel} /> : 'No Product Image Uploaded'}</div><p><strong>SKU No:</strong> {detailSku.skuNo}</p><p><strong>Item Label:</strong> {detailSku.itemLabel || '—'}</p><p><strong>Supplier / Customer:</strong> {detailSku.supplierCustomer || '—'}</p><p><strong>Tag Bind:</strong> {detailSku.tagBind || '—'}</p><p><strong>Date Added:</strong> {detailSku.dateAdded || '—'}</p><p><strong>Description:</strong> {detailSku.description || 'No extended description available.'}</p></div>}</Modal>
    <ScannerModal open={scannerTarget !== null} onClose={() => setScannerTarget(null)} onDetected={(value) => { if (scannerTarget) updateForm(scannerTarget, value); setScannerTarget(null); }} />
    <ConfirmDialog open={deleteSkuNo !== null} title="Delete SKU" message={`Delete ${deleteSkuNo || 'this SKU'}?`} onCancel={() => setDeleteSkuNo(null)} onConfirm={() => { const next = skus.filter((sku) => sku.skuNo !== deleteSkuNo); void api.saveSkus(next).then(() => { setSkus(next); setDeleteSkuNo(null); }).catch((error: unknown) => onError(error instanceof Error ? error.message : 'Unable to delete SKU')); }} />
  </div>;
}
