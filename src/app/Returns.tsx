import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, Eye, Plus, RefreshCw, RotateCcw, X } from "lucide-react";
import { api } from "@/lib/api";
import { fetchAllPages, formatQuantity, getErrorMessage, getValidationResult, isRecord, numberValue, optionalText, parseId, parseLaravelPage, todayValue } from "@/app/InventoryShared";

export type ReturnKind = "sale" | "purchase";

interface ReturnItem {
  id: number;
  originalItemId: number;
  productId: number;
  product: string;
  sku: string | null;
  quantity: number;
  unitValue: number;
  lineTotal: number;
  notes: string | null;
}

interface SourceRecord {
  id: number;
  number: string;
  date: string;
  partner: string;
  warehouse: string;
  currency: string;
  status: string;
  total: number;
  items: ReturnItem[];
}

interface ReturnRecord {
  id: number;
  number: string;
  date: string;
  source: SourceRecord;
  partner: string;
  warehouse: string;
  currency: string;
  subtotal: number;
  total: number;
  status: string;
  notes: string | null;
  items: ReturnItem[];
  creator: string | null;
}

interface ReturnPage {
  data: ReturnRecord[];
  currentPage: number;
  lastPage: number;
  perPage: number;
  total: number;
}

function dateNumber(kind: ReturnKind): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const salt = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8).toUpperCase() : Math.random().toString(36).slice(2, 10).toUpperCase();
  return `${kind === "sale" ? "SR" : "PR"}-${stamp}-${salt}`;
}

function relationName(value: unknown, ...fields: string[]): string {
  if (!isRecord(value)) return "—";
  for (const field of fields) if (typeof value[field] === "string" && value[field].trim()) return value[field];
  return "—";
}

function parseOriginalItem(value: unknown, kind: ReturnKind): ReturnItem {
  if (!isRecord(value) || !isRecord(value.product)) throw new Error("The source transaction contains an incomplete item.");
  const quantity = numberValue(value.quantity, "item quantity");
  const lineTotal = numberValue(value.line_total, "item line total");
  const unitValue = numberValue(kind === "sale" ? value.unit_price : value.unit_cost, "item unit value");
  return {
    id: parseId(value.id, "source item ID"), originalItemId: parseId(value.id, "source item ID"),
    productId: parseId(value.product_id, "product ID"), product: relationName(value.product, "name"),
    sku: optionalText(value.product.sku), quantity, unitValue, lineTotal, notes: optionalText(value.notes),
  };
}

function parseSource(value: unknown, kind: ReturnKind): SourceRecord {
  if (!isRecord(value) || !Array.isArray(value.items)) throw new Error("The source transaction response is incomplete.");
  const sale = kind === "sale";
  const number = value[sale ? "sale_number" : "purchase_number"];
  const date = value[sale ? "sale_date" : "purchase_date"];
  if (typeof number !== "string" || typeof date !== "string") throw new Error("The source transaction is missing its number or date.");
  return {
    id: parseId(value.id, "source transaction ID"), number, date: date.slice(0, 10),
    partner: relationName(sale ? value.customer : value.supplier, "business_name", "name"),
    warehouse: relationName(value.warehouse, "name"), currency: relationName(value.currency, "code"),
    status: typeof value.status === "string" ? value.status : "unknown",
    total: numberValue(value.grand_total, "source total"), items: value.items.map((item) => parseOriginalItem(item, kind)),
  };
}

function parseReturnedItem(value: unknown, kind: ReturnKind): ReturnItem {
  if (!isRecord(value)) throw new Error("The return contains an invalid item.");
  const original = kind === "sale" ? value.sale_item_id : value.purchase_item_id;
  const product = isRecord(value.product) ? value.product : {};
  const unitValue = numberValue(kind === "sale" ? value.unit_price : value.unit_cost, "returned unit value");
  return {
    id: parseId(value.id, "return item ID"), originalItemId: parseId(original, "original item ID"),
    productId: parseId(value.product_id, "product ID"), product: relationName(product, "name"), sku: optionalText(product.sku),
    quantity: numberValue(value.quantity, "returned quantity"), unitValue, lineTotal: numberValue(value.line_total, "return line total"), notes: optionalText(value.notes),
  };
}

function parseReturn(value: unknown, kind: ReturnKind): ReturnRecord {
  if (!isRecord(value) || !Array.isArray(value.items)) throw new Error("The return response is incomplete.");
  const sale = kind === "sale";
  const sourceValue = value[sale ? "sale" : "purchase"];
  const source = isRecord(sourceValue)
    ? parseSource({ ...sourceValue, items: Array.isArray(sourceValue.items) ? sourceValue.items : [] }, kind)
    : { id: 0, number: "—", date: "", partner: "—", warehouse: "—", currency: relationName(value.currency, "code"), status: "unknown", total: 0, items: [] };
  return {
    id: parseId(value.id, "return ID"), number: typeof value.return_number === "string" ? value.return_number : `Return ${String(value.id)}`,
    date: typeof value.return_date === "string" ? value.return_date.slice(0, 10) : "", source,
    partner: relationName(sale ? value.customer : value.supplier, "business_name", "name"),
    warehouse: relationName(value.warehouse, "name"), currency: relationName(value.currency, "code"),
    subtotal: numberValue(value.subtotal, "return subtotal"), total: numberValue(value.grand_total, "return total"),
    status: typeof value.status === "string" ? value.status : "posted", notes: optionalText(value.notes),
    items: value.items.map((item) => parseReturnedItem(item, kind)), creator: relationName(value.creator, "name") === "—" ? null : relationName(value.creator, "name"),
  };
}

function formatMoney(amount: number, currency: string): string {
  return `${currency} ${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(amount)}`;
}

function formatDate(value: string): string {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export default function Returns({ kind }: { kind: ReturnKind }) {
  const sale = kind === "sale";
  const config = sale
    ? { title: "Sale Returns", endpoint: "/api/sale-returns", sourceEndpoint: "/api/sales", sourceLabel: "Sale", partnerLabel: "Customer", originalKey: "sale_item_id", idKey: "sale_id", field: "sale_item_id" }
    : { title: "Purchase Returns", endpoint: "/api/purchase-returns", sourceEndpoint: "/api/purchases", sourceLabel: "Purchase", partnerLabel: "Supplier", originalKey: "purchase_item_id", idKey: "purchase_id", field: "purchase_item_id" };
  const [page, setPage] = useState<ReturnPage | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [allReturns, setAllReturns] = useState<ReturnRecord[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [sourceId, setSourceId] = useState("");
  const [returnNumber, setReturnNumber] = useState(() => dateNumber(kind));
  const [returnDate, setReturnDate] = useState(todayValue);
  const [notes, setNotes] = useState("");
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<ReturnRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true); setListError(null);
    api.get<unknown>(config.endpoint, { params: { page: currentPage }, signal: controller.signal })
      .then(({ data }) => setPage(parseLaravelPage(data, (row) => parseReturn(row, kind))))
      .catch((error: unknown) => { if (!controller.signal.aborted) { setPage(null); setListError(getErrorMessage(error)); } })
      .finally(() => { if (!controller.signal.aborted) setIsLoading(false); });
    return () => controller.abort();
  }, [config.endpoint, currentPage, kind, retry]);

  useEffect(() => {
    const controller = new AbortController();
    setOptionsLoading(true); setOptionsError(null);
    Promise.all([
      fetchAllPages(config.sourceEndpoint, {}, (row) => parseSource(row, kind), controller.signal),
      fetchAllPages(config.endpoint, {}, (row) => parseReturn(row, kind), controller.signal),
    ]).then(([sourceRows, returnRows]) => {
      setSources(sourceRows.filter((record) => record.status === "posted"));
      setAllReturns(returnRows.filter((record) => record.status === "posted"));
    }).catch((error: unknown) => { if (!controller.signal.aborted) setOptionsError(getErrorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setOptionsLoading(false); });
    return () => controller.abort();
  }, [config.endpoint, config.sourceEndpoint, kind, optionsRetry]);

  const selectedSource = sources.find((source) => String(source.id) === sourceId) ?? null;
  const remainingByItem = useMemo(() => {
    const returned = new Map<number, number>();
    for (const record of allReturns) if (record.source.id === selectedSource?.id) {
      for (const item of record.items) returned.set(item.originalItemId, (returned.get(item.originalItemId) ?? 0) + item.quantity);
    }
    return new Map((selectedSource?.items ?? []).map((item) => [item.id, Math.max(0, item.quantity - (returned.get(item.id) ?? 0))]));
  }, [allReturns, selectedSource]);

  function updateQuantity(itemId: number, value: string) {
    setQuantities((current) => ({ ...current, [itemId]: value }));
    setFieldErrors((current) => { const next = { ...current }; delete next[`items.${itemId}.quantity`]; delete next.items; return next; });
    setFormError(null); setSuccess(null);
  }

  async function openDetails(record: ReturnRecord) {
    setSelected(null); setDetailError(null); setDetailLoading(true);
    try {
      const { data } = await api.get<unknown>(`${config.endpoint}/${record.id}`);
      if (!isRecord(data) || !isRecord(data.data)) throw new Error("The return details response is incomplete.");
      setSelected(parseReturn(data.data, kind));
    } catch (error: unknown) { setSelected(record); setDetailError(getErrorMessage(error)); }
    finally { setDetailLoading(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return;
    const errors: Record<string, string> = {};
    if (!selectedSource) errors[config.idKey] = `Select a posted ${config.sourceLabel.toLowerCase()}.`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(returnDate) || Number.isNaN(new Date(`${returnDate}T00:00:00`).getTime())) errors.return_date = "Enter a valid return date.";
    if (selectedSource && returnDate < selectedSource.date) errors.return_date = `Return date cannot be before the original ${config.sourceLabel.toLowerCase()} date.`;
    const submittedItemIds: number[] = [];
    const lines = (selectedSource?.items ?? []).flatMap((item) => {
      const raw = (quantities[item.id] ?? "").trim();
      if (!raw) return [];
      submittedItemIds.push(item.id);
      const amount = Number(raw); const remaining = remainingByItem.get(item.id) ?? 0;
      if (!/^\d+(?:\.\d{1,4})?$/.test(raw) || !Number.isFinite(amount) || amount <= 0) errors[`items.${item.id}.quantity`] = "Enter a positive quantity with up to 4 decimal places.";
      else if (amount > remaining) errors[`items.${item.id}.quantity`] = `Only ${formatQuantity(remaining)} remains eligible for return.`;
      return [{ [config.field]: item.id, quantity: raw }];
    });
    if (!lines.length) errors.items = "Enter a quantity for at least one item.";
    setFieldErrors(errors);
    if (Object.keys(errors).length) { setFormError("Review the highlighted fields."); return; }
    setSaving(true); setFormError(null); setSuccess(null);
    try {
      const payload = { return_number: returnNumber, [config.idKey]: selectedSource!.id, return_date: returnDate, notes: notes.trim() || null, items: lines };
      const { data } = await api.post<unknown>(config.endpoint, payload);
      setSuccess(isRecord(data) && typeof data.message === "string" ? data.message : `${config.sourceLabel} return recorded.`);
      setSourceId(""); setQuantities({}); setNotes(""); setReturnNumber(dateNumber(kind)); setCurrentPage(1); setRetry((value) => value + 1); setOptionsRetry((value) => value + 1);
    } catch (error: unknown) {
      const result = getValidationResult(error); setFormError(result.message);
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(result.fields)) {
        const itemMatch = key.match(/^items\.(\d+)\.(quantity|sale_item_id|purchase_item_id)$/);
        if (itemMatch) {
          const index = Number(itemMatch[1]); const itemId = submittedItemIds[index]; const item = selectedSource?.items.find((row) => row.id === itemId);
          if (item) next[`items.${item.id}.quantity`] = value;
          else next.items = value;
        } else next[key] = value;
      }
      setFieldErrors(next);
    } finally { setSaving(false); }
  }

  const startRecord = page && page.total ? (page.currentPage - 1) * page.perPage + 1 : 0;
  const endRecord = page ? Math.min((page.currentPage - 1) * page.perPage + page.data.length, page.total) : 0;

  return <div className="returns-page">
    <header className="returns-heading"><div><p className="overview-eyebrow">OPERATIONS</p><h1>{config.title}</h1><p>Record goods returned against posted {config.sourceLabel.toLowerCase()}s. The backend applies the inventory and partner account effects.</p></div><button type="button" className="overview-refresh" onClick={() => { setRetry((value) => value + 1); setOptionsRetry((value) => value + 1); }} disabled={isLoading || optionsLoading}><RefreshCw size={16} className={isLoading || optionsLoading ? "overview-refresh__spinning" : ""} /> Refresh</button></header>
    {success && <p className="returns-success" role="status">{success}</p>}
    <section className="returns-panel" aria-labelledby="returns-form-title"><header className="returns-panel-heading"><span><RotateCcw size={18} /></span><div><h2 id="returns-form-title">Record {config.sourceLabel.toLowerCase()} return</h2><p>Choose the original posted transaction and enter quantities to return.</p></div></header>
      {optionsError && <div className="returns-state returns-error" role="alert"><AlertCircle size={18} />{optionsError}<button type="button" onClick={() => setOptionsRetry((value) => value + 1)}>Reload options</button></div>}
      {formError && <p className="returns-form-error" role="alert">{formError}</p>}
      <form className="returns-form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="returns-form-top"><div className="returns-number"><span>Return number</span><strong>{returnNumber}</strong><small>Unique number generated for this request.</small></div><label><span>Original {config.sourceLabel.toLowerCase()} <i>*</i></span><select value={sourceId} onChange={(event) => { setSourceId(event.target.value); setQuantities({}); setFieldErrors({}); setFormError(null); }} disabled={saving || optionsLoading || Boolean(optionsError)} aria-invalid={Boolean(fieldErrors[config.idKey])}><option value="">{optionsLoading ? "Loading posted transactions…" : `Select ${config.sourceLabel.toLowerCase()}`}</option>{sources.map((source) => <option value={source.id} key={source.id}>{source.number} · {source.partner} · {formatDate(source.date)} · {source.currency} {formatMoney(source.total, source.currency)}</option>)}</select>{fieldErrors[config.idKey] && <small className="returns-field-error">{fieldErrors[config.idKey]}</small>}</label><label><span>Return date <i>*</i></span><input type="date" value={returnDate} onChange={(event) => setReturnDate(event.target.value)} disabled={saving} aria-invalid={Boolean(fieldErrors.return_date)} />{fieldErrors.return_date && <small className="returns-field-error">{fieldErrors.return_date}</small>}</label></div>
        {selectedSource ? <><div className="returns-source-summary"><div><small>Original {config.sourceLabel.toLowerCase()}</small><strong>{selectedSource.number}</strong></div><div><small>{config.partnerLabel}</small><strong>{selectedSource.partner}</strong></div><div><small>Original date</small><strong>{formatDate(selectedSource.date)}</strong></div><div><small>Warehouse · Currency</small><strong>{selectedSource.warehouse} · {selectedSource.currency}</strong></div><div><small>Original total</small><strong>{formatMoney(selectedSource.total, selectedSource.currency)}</strong></div></div>
          <div className="returns-items-heading"><div><h3>Items eligible for return</h3><p>Return values use original posted line amounts; the backend calculates and records them.</p></div><span>{selectedSource.items.length} items</span></div>
          <div className="returns-items-scroll"><table className="returns-items-table"><thead><tr><th>Product</th><th>Original qty</th><th>Returned qty</th><th>Remaining qty</th><th>Original unit value</th><th>Original line total</th><th>Return qty</th></tr></thead><tbody>{selectedSource.items.map((item) => { const returned = item.quantity - (remainingByItem.get(item.id) ?? 0); const field = fieldErrors[`items.${item.id}.quantity`]; return <tr key={item.id}><td><strong>{item.product}</strong>{item.sku && <small>{item.sku}</small>}</td><td>{formatQuantity(item.quantity)}</td><td>{formatQuantity(returned)}</td><td>{formatQuantity(remainingByItem.get(item.id) ?? 0)}</td><td>{formatMoney(item.unitValue, selectedSource.currency)}</td><td>{formatMoney(item.lineTotal, selectedSource.currency)}</td><td><input aria-label={`Return quantity for ${item.product}`} aria-invalid={Boolean(field)} type="number" min="0" max={remainingByItem.get(item.id) ?? 0} step="0.0001" inputMode="decimal" value={quantities[item.id] ?? ""} onChange={(event) => updateQuantity(item.id, event.target.value)} disabled={saving || (remainingByItem.get(item.id) ?? 0) <= 0} placeholder="—" />{field && <small className="returns-field-error">{field}</small>}</td></tr>; })}</tbody></table></div>{fieldErrors.items && <p className="returns-field-error">{fieldErrors.items}</p>}</> : <div className="returns-inline-empty">{optionsLoading ? "Loading eligible transactions…" : sources.length ? `Select a posted ${config.sourceLabel.toLowerCase()} to view its items.` : `No posted ${config.sourceLabel.toLowerCase()}s are available for return.`}</div>}
        <label className="returns-notes"><span>Notes (optional)</span><textarea rows={2} maxLength={5000} value={notes} onChange={(event) => setNotes(event.target.value)} disabled={saving} placeholder="Optional return notes" aria-invalid={Boolean(fieldErrors.notes)} />{fieldErrors.notes && <small className="returns-field-error">{fieldErrors.notes}</small>}</label>
        <div className="returns-form-actions"><span>Submitting posts this return through the backend; it does not settle a cash refund.</span><button className="returns-submit" type="submit" disabled={saving || optionsLoading || Boolean(optionsError) || !sources.length}><Plus size={16} />{saving ? "Recording…" : `Record ${config.sourceLabel.toLowerCase()} return`}</button></div>
      </form>
    </section>
    <section className="returns-panel" aria-label={`${config.title} history`}><div className="returns-list-heading"><div><h2>{config.title} history</h2><p>{page?.total.toLocaleString() ?? 0} records</p></div></div>
      {isLoading ? <div className="returns-state" role="status"><span className="loading-spinner" />Loading returns…</div> : listError ? <div className="returns-state returns-error" role="alert"><AlertCircle size={18} />{listError}<button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div> : page && !page.data.length ? <div className="returns-state returns-empty"><span><RotateCcw size={21} /></span><strong>No returns yet</strong><small>Recorded returns will appear here.</small></div> : page && <><div className="returns-table-scroll"><table className="returns-table"><thead><tr><th>Return number</th><th>Return date</th><th>Original {config.sourceLabel.toLowerCase()}</th><th>{config.partnerLabel}</th><th>Items</th><th>Currency</th><th>Total</th><th>Status</th><th>Action</th></tr></thead><tbody>{page.data.map((record) => <tr key={record.id}><td><strong>{record.number}</strong></td><td>{formatDate(record.date)}</td><td>{record.source.number}</td><td>{record.partner}</td><td>{record.items.reduce((sum, item) => sum + item.quantity, 0) > 0 ? `${record.items.length} · ${record.items.map((item) => `${item.product} × ${formatQuantity(item.quantity)}`).join(", ")}` : record.items.length}</td><td><span className="returns-currency">{record.currency}</span></td><td><strong>{formatMoney(record.total, record.currency)}</strong></td><td>{record.status.replaceAll("_", " ")}</td><td><button className="returns-view" type="button" onClick={() => void openDetails(record)}><Eye size={15} /> Details</button></td></tr>)}</tbody></table></div><footer className="returns-pagination"><span>Showing {startRecord}–{endRecord} of {page.total.toLocaleString()}</span><div><button type="button" onClick={() => setCurrentPage((value) => value - 1)} disabled={page.currentPage <= 1}><ChevronLeft size={15} /> Previous</button><span>Page <strong>{page.currentPage}</strong> of <strong>{page.lastPage}</strong></span><button type="button" onClick={() => setCurrentPage((value) => value + 1)} disabled={page.currentPage >= page.lastPage}>Next <ChevronRight size={15} /></button></div></footer></>}
    </section>
    {(selected || detailLoading || detailError) && <div className="returns-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !detailLoading) { setSelected(null); setDetailError(null); } }}><section className="returns-modal" role="dialog" aria-modal="true" aria-labelledby="returns-detail-title"><header><div><p className="overview-eyebrow">RETURN DETAILS</p><h2 id="returns-detail-title">{selected?.number ?? config.title}</h2><p>{selected && formatDate(selected.date)}</p></div><button type="button" aria-label="Close details" disabled={detailLoading} onClick={() => { setSelected(null); setDetailError(null); }}><X size={19} /></button></header>{detailLoading ? <div className="returns-state"><span className="loading-spinner" />Loading return details…</div> : detailError ? <div className="returns-state returns-error" role="alert">{detailError}</div> : selected && <div className="returns-detail-body"><dl><div><dt>Original {config.sourceLabel.toLowerCase()}</dt><dd>{selected.source.number}</dd></div><div><dt>{config.partnerLabel}</dt><dd>{selected.partner}</dd></div><div><dt>Return date</dt><dd>{formatDate(selected.date)}</dd></div><div><dt>Warehouse</dt><dd>{selected.warehouse}</dd></div><div><dt>Currency</dt><dd>{selected.currency}</dd></div><div><dt>Status</dt><dd>{selected.status}</dd></div><div><dt>Return total</dt><dd>{formatMoney(selected.total, selected.currency)}</dd></div><div><dt>Recorded by</dt><dd>{selected.creator ?? "—"}</dd></div></dl><div className="returns-items-scroll"><table className="returns-items-table"><thead><tr><th>Product</th><th>Quantity</th><th>Unit value</th><th>Line total</th></tr></thead><tbody>{selected.items.map((item) => <tr key={item.id}><td>{item.product}{item.sku && <small>{item.sku}</small>}</td><td>{formatQuantity(item.quantity)}</td><td>{formatMoney(item.unitValue, selected.currency)}</td><td><strong>{formatMoney(item.lineTotal, selected.currency)}</strong></td></tr>)}</tbody></table></div>{selected.notes && <p className="returns-detail-notes"><strong>Notes</strong><br />{selected.notes}</p>}</div>}</section></div>}
  </div>;
}
