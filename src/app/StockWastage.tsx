import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { formatQuantity, getErrorMessage, getValidationResult, loadProducts, loadWarehouses, parseId, parseLaravelPage, type InventoryProductOption, type InventoryWarehouseOption, type LaravelPage } from "@/app/InventoryShared";

interface WastageAllocation { batch_number: string | null; expiry_date: string | null; quantity: number }
interface WastageItem { id: number; product_id: number; quantity: number; reason: string; notes: string | null; product?: { name?: string; sku?: string | null; unit?: string }; batch_allocations?: WastageAllocation[] }
interface Wastage { id: number; wastage_number: string; wastage_date: string; notes: string | null; warehouse?: { name?: string }; items: WastageItem[] }
const pageSize = 20;

function parseWastage(value: unknown): Wastage {
  if (!value || typeof value !== "object") throw new Error("The wastage response is incomplete.");
  const row = value as Record<string, unknown>;
  if (!Array.isArray(row.items)) throw new Error("The wastage response is missing items.");
  return { id: parseId(row.id, "wastage ID"), wastage_number: String(row.wastage_number ?? ""), wastage_date: String(row.wastage_date ?? ""), notes: typeof row.notes === "string" ? row.notes : null, warehouse: row.warehouse as Wastage["warehouse"], items: row.items.map((value) => { const item = value as Record<string, unknown>; const allocations = Array.isArray(item.batch_allocations) ? item.batch_allocations.map((entry) => { const batch = entry as Record<string, unknown>; return { batch_number: typeof batch.batch_number === "string" ? batch.batch_number : null, expiry_date: typeof batch.expiry_date === "string" ? batch.expiry_date : null, quantity: Number(batch.quantity) }; }) : undefined; return { id: parseId(item.id, "wastage item ID"), product_id: parseId(item.product_id, "product ID"), quantity: Number(item.quantity), reason: String(item.reason ?? ""), notes: typeof item.notes === "string" ? item.notes : null, product: item.product as WastageItem["product"], batch_allocations: allocations }; }) };
}

export default function StockWastage() {
  const [warehouses, setWarehouses] = useState<InventoryWarehouseOption[]>([]);
  const [products, setProducts] = useState<InventoryProductOption[]>([]);
  const [rows, setRows] = useState<LaravelPage<Wastage> | null>(null);
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<Wastage | null>(null);
  const [warehouseId, setWarehouseId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  useEffect(() => { const controller = new AbortController(); void Promise.all([loadWarehouses(controller.signal), loadProducts(controller.signal)]).then(([w, p]) => { setWarehouses(w); setProducts(p); }).catch((e: unknown) => { if (!controller.signal.aborted) setError(getErrorMessage(e)); }); return () => controller.abort(); }, [retry]);
  useEffect(() => { const controller = new AbortController(); setLoading(true); void api.get<unknown>("/api/stock-wastages", { params: { page, per_page: pageSize }, signal: controller.signal }).then(({ data }) => setRows(parseLaravelPage(data, parseWastage))).catch((e: unknown) => { if (!controller.signal.aborted) setError(getErrorMessage(e)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [page, retry]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; setBusy(true); setFieldErrors({}); setError(null); setSuccess(null);
    try { await api.post("/api/stock-wastages", { warehouse_id: Number(warehouseId), wastage_date: date, notes: notes || null, items: [{ product_id: Number(productId), quantity: Number(quantity), reason }] }); setSuccess("Stock wastage recorded."); setProductId(""); setQuantity(""); setReason(""); setNotes(""); setPage(1); setRetry((v) => v + 1); }
    catch (e: unknown) { const result = getValidationResult(e); setFieldErrors(result.fields); setError(result.message); }
    finally { setBusy(false); }
  }

  return <div className="purchases-page inventory-operation-page"><header className="purchases-heading"><div><p className="overview-eyebrow">INVENTORY</p><h1>Stock Wastage</h1><p className="overview-heading__description">Record damaged, expired, or otherwise unusable stock.</p></div></header>
    {error && <div className="form-alert form-alert--error" role="alert">{error} <button type="button" onClick={() => setRetry((v) => v + 1)}>Retry</button></div>}{success && <div className="form-alert" role="status">{success}</div>}
    <section className="purchases-panel"><h2>Record wastage</h2><form className="inventory-form" onSubmit={(e) => void submit(e)}>
      <label>Warehouse<select required value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}><option value="">Select warehouse</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>{fieldErrors.warehouse_id && <small>{fieldErrors.warehouse_id}</small>}</label>
      <label>Product<select required value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">Select product</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` · ${p.sku}` : ""}</option>)}</select>{fieldErrors["items.0.product_id"] && <small>{fieldErrors["items.0.product_id"]}</small>}</label>
      <label>Quantity<input required type="number" min="0.0001" step="0.0001" value={quantity} onChange={(e) => setQuantity(e.target.value)} />{fieldErrors["items.0.quantity"] && <small>{fieldErrors["items.0.quantity"]}</small>}</label>
      <label>Date<input required type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label>Reason<input required maxLength={100} value={reason} onChange={(e) => setReason(e.target.value)} />{fieldErrors["items.0.reason"] && <small>{fieldErrors["items.0.reason"]}</small>}</label>
      <label>Notes<input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <button className="purchase-save-button" disabled={busy || !warehouses.length || !products.length}>{busy ? "Saving…" : "Record Wastage"}</button>
    </form><p className="inventory-form-hint">Available batches are allocated by the server in FEFO order. Batch allocations appear in the details record.</p></section>
    <section className="purchases-panel" aria-label="Stock wastage records">{loading ? <div className="purchases-state" role="status">Loading wastage…</div> : rows?.data.length ? <><div className="purchases-table-scroll"><table className="purchases-table inventory-table"><thead><tr><th>Reference</th><th>Date</th><th>Warehouse</th><th>Items</th><th>Details</th></tr></thead><tbody>{rows.data.map((r) => <tr key={r.id}><td>{r.wastage_number}</td><td>{r.wastage_date}</td><td>{r.warehouse?.name ?? "—"}</td><td>{r.items.length}</td><td><button type="button" className="purchase-view-button" onClick={() => setDetail(r)}>Details</button></td></tr>)}</tbody></table></div><footer className="purchases-pagination"><span>{rows.total} records</span><div className="purchases-pagination__controls"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {rows.lastPage}</span><button type="button" disabled={page >= rows.lastPage} onClick={() => setPage(page + 1)}>Next</button></div></footer></> : <div className="purchases-state purchases-state--empty">No wastage records yet.</div>}</section>
    {detail && <div className="purchase-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setDetail(null); }}><section className="purchase-modal" role="dialog" aria-modal="true"><header className="purchase-modal__header"><h2>{detail.wastage_number}</h2><button type="button" onClick={() => setDetail(null)} aria-label="Close">×</button></header><div className="purchase-modal__body"><p>{detail.wastage_date} · {detail.warehouse?.name ?? "—"}</p>{detail.notes && <p>{detail.notes}</p>}<ul>{detail.items.map((i) => <li key={i.id}>{i.product?.name ?? `Product ${i.product_id}`} — {formatQuantity(i.quantity)} {i.product?.unit ?? ""} · {i.reason}{i.notes ? ` (${i.notes})` : ""}{i.batch_allocations?.length ? <ul>{i.batch_allocations.map((batch, index) => <li key={`${batch.batch_number ?? "unknown"}-${index}`}>Batch {batch.batch_number ?? "not recorded"}: {formatQuantity(batch.quantity)}{batch.expiry_date ? ` · expiry ${batch.expiry_date}` : " · no expiry recorded"}</li>)}</ul> : null}</li>)}</ul></div></section></div>}
  </div>;
}
