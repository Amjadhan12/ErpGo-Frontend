import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, Eye, Plus, RefreshCw, RotateCcw, X } from "lucide-react";
import { api } from "@/lib/api";
import { fetchAllPages, getErrorMessage, getValidationResult, isRecord, numberValue, optionalText, parseId, parseLaravelPage, todayValue } from "@/app/InventoryShared";
import { useLocale } from "@/lib/locale";

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

function formatMoney(amount: number, currency: string, language: "en" | "ps"): string {
  return `${currency} ${new Intl.NumberFormat(language === "ps" ? "ps-AF" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(amount)}`;
}

function formatDate(value: string, language: "en" | "ps"): string {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(language === "ps" ? "ps-AF" : "en-US", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

type Translate = (text: string) => string;

function interpolate(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((message, [key, value]) => message.replaceAll(`{${key}}`, value), template);
}

function translateReturnMessage(message: string, t: Translate, language: "en" | "ps", fallback: string): string {
  const translated = t(message);
  if (translated !== message) return translated;
  if (language === "ps") {
    if (/field is required\.$/i.test(message)) return t("This field is required.");
    if (/must be a number\.$/i.test(message)) return t("Enter a valid number.");
    if (/must be greater than 0\.$/i.test(message)) return t("Enter a positive quantity with up to 4 decimal places.");
    if (/given data was invalid/i.test(message)) return t("Review the highlighted fields.");
    return t(fallback);
  }
  return message || t(fallback);
}

export default function Returns({ kind }: { kind: ReturnKind }) {
  const { direction, language, t } = useLocale();
  const sale = kind === "sale";
  const config = sale
    ? { endpoint: "/api/sale-returns", sourceEndpoint: "/api/sales", idKey: "sale_id", field: "sale_item_id" }
    : { endpoint: "/api/purchase-returns", sourceEndpoint: "/api/purchases", idKey: "purchase_id", field: "purchase_item_id" };
  const numberFormat = useMemo(() => new Intl.NumberFormat(language === "ps" ? "ps-AF" : "en-US"), [language]);
  const quantityFormat = useMemo(() => new Intl.NumberFormat(language === "ps" ? "ps-AF" : "en-US", { maximumFractionDigits: 4 }), [language]);
  const quantityText = (value: number) => quantityFormat.format(value);
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
      .catch((error: unknown) => { if (!controller.signal.aborted) { setPage(null); setListError(translateReturnMessage(getErrorMessage(error), t, language, "Returns could not be loaded. Please try again.")); } })
      .finally(() => { if (!controller.signal.aborted) setIsLoading(false); });
    return () => controller.abort();
  }, [config.endpoint, currentPage, kind, retry, t, language]);

  useEffect(() => {
    const controller = new AbortController();
    setOptionsLoading(true); setOptionsError(null);
    Promise.all([
      fetchAllPages(config.sourceEndpoint, {}, (row) => parseSource(row, kind), controller.signal),
      fetchAllPages(config.endpoint, {}, (row) => parseReturn(row, kind), controller.signal),
    ]).then(([sourceRows, returnRows]) => {
      setSources(sourceRows.filter((record) => record.status === "posted"));
      setAllReturns(returnRows.filter((record) => record.status === "posted"));
    }).catch((error: unknown) => { if (!controller.signal.aborted) setOptionsError(translateReturnMessage(getErrorMessage(error), t, language, "Return options could not be loaded. Please try again.")); })
      .finally(() => { if (!controller.signal.aborted) setOptionsLoading(false); });
    return () => controller.abort();
  }, [config.endpoint, config.sourceEndpoint, kind, optionsRetry, t, language]);

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
      if (!isRecord(data) || !isRecord(data.data)) throw new Error(t("The return details response is incomplete."));
      setSelected(parseReturn(data.data, kind));
    } catch (error: unknown) { setSelected(record); setDetailError(translateReturnMessage(getErrorMessage(error), t, language, "Return details could not be loaded. Please try again.")); }
    finally { setDetailLoading(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return;
    const errors: Record<string, string> = {};
    if (!selectedSource) errors[config.idKey] = t(`Select a posted ${sale ? "sale" : "purchase"}.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(returnDate) || Number.isNaN(new Date(`${returnDate}T00:00:00`).getTime())) errors.return_date = t("Enter a valid return date.");
    if (selectedSource && returnDate < selectedSource.date) errors.return_date = t(`Return date cannot be before the original ${sale ? "sale" : "purchase"} date.`);
    const submittedItemIds: number[] = [];
    const lines = (selectedSource?.items ?? []).flatMap((item) => {
      const raw = (quantities[item.id] ?? "").trim();
      if (!raw) return [];
      submittedItemIds.push(item.id);
      const amount = Number(raw); const remaining = remainingByItem.get(item.id) ?? 0;
      if (!/^\d+(?:\.\d{1,4})?$/.test(raw) || !Number.isFinite(amount) || amount <= 0) errors[`items.${item.id}.quantity`] = t("Enter a positive quantity with up to 4 decimal places.");
      else if (amount > remaining) errors[`items.${item.id}.quantity`] = interpolate(t("Only {quantity} remains eligible for return."), { quantity: quantityText(remaining) });
      return [{ [config.field]: item.id, quantity: raw }];
    });
    if (!lines.length) errors.items = t("Enter a quantity for at least one item.");
    setFieldErrors(errors);
    if (Object.keys(errors).length) { setFormError(t("Review the highlighted fields.")); return; }
    setSaving(true); setFormError(null); setSuccess(null);
    try {
      const payload = { return_number: returnNumber, [config.idKey]: selectedSource!.id, return_date: returnDate, notes: notes.trim() || null, items: lines };
      const { data } = await api.post<unknown>(config.endpoint, payload);
      setSuccess(isRecord(data) && typeof data.message === "string"
        ? translateReturnMessage(data.message, t, language, sale ? "Sale return recorded successfully." : "Purchase return recorded successfully.")
        : t(sale ? "Sale return recorded successfully." : "Purchase return recorded successfully."));
      setSourceId(""); setQuantities({}); setNotes(""); setReturnNumber(dateNumber(kind)); setCurrentPage(1); setRetry((value) => value + 1); setOptionsRetry((value) => value + 1);
    } catch (error: unknown) {
      const result = getValidationResult(error); setFormError(translateReturnMessage(result.message, t, language, "The return could not be recorded. Please try again."));
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(result.fields)) {
        const itemMatch = key.match(/^items\.(\d+)\.(quantity|sale_item_id|purchase_item_id)$/);
        if (itemMatch) {
          const index = Number(itemMatch[1]); const itemId = submittedItemIds[index]; const item = selectedSource?.items.find((row) => row.id === itemId);
          if (item) next[`items.${item.id}.quantity`] = translateReturnMessage(value, t, language, "Please check this field and try again.");
          else next.items = translateReturnMessage(value, t, language, "Please check this field and try again.");
        } else next[key] = translateReturnMessage(value, t, language, "Please check this field and try again.");
      }
      setFieldErrors(next);
    } finally { setSaving(false); }
  }

  const sourceKind = sale ? t("Sale") : t("Purchase");
  const partnerKind = sale ? t("Customer") : t("Supplier");
  const title = sale ? t("Sale Returns") : t("Purchase Returns");
  const startRecord = page && page.total ? (page.currentPage - 1) * page.perPage + 1 : 0;
  const endRecord = page ? Math.min((page.currentPage - 1) * page.perPage + page.data.length, page.total) : 0;
  const returnMessage = sale ? t("Record sale return") : t("Record purchase return");

  return (
    <div className="returns-redesign" dir={direction}>
      <style>{`
        .returns-redesign{--rr-ink:#172b4d;--rr-muted:#64748b;--rr-line:#e2e8f0;--rr-soft:#f8fafc;color:var(--rr-ink);display:grid;gap:22px;max-width:1480px;margin:0 auto;padding:24px}
        .returns-redesign *{box-sizing:border-box}.returns-redesign button,.returns-redesign input,.returns-redesign select,.returns-redesign textarea{font:inherit}
        .returns-redesign__heading{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}.returns-redesign__eyebrow{margin:0 0 7px;color:#64748b;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}
        .returns-redesign__heading h1{margin:0;color:#12233e;font-size:clamp(25px,3vw,34px);line-height:1.2}.returns-redesign__heading p:not(.returns-redesign__eyebrow){max-width:780px;margin:9px 0 0;color:var(--rr-muted);line-height:1.55}
        .returns-redesign__button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:42px;padding:9px 14px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;color:#233755;font-weight:700;cursor:pointer}
        .returns-redesign__button:hover:not(:disabled){background:#f1f5f9}.returns-redesign__button:disabled{opacity:.55;cursor:not-allowed}.returns-redesign__button--primary{border-color:#1d4ed8;background:#2563eb;color:#fff}.returns-redesign__button--primary:hover:not(:disabled){background:#1d4ed8}
        .returns-redesign__panel{min-width:0;overflow:hidden;border:1px solid var(--rr-line);border-radius:16px;background:#fff;box-shadow:0 5px 18px #0f172a0a}
        .returns-redesign__panel-heading{display:flex;align-items:center;gap:13px;padding:20px 22px;border-bottom:1px solid var(--rr-line)}.returns-redesign__panel-icon{display:grid;place-items:center;flex:0 0 42px;width:42px;height:42px;border-radius:12px;background:#eff6ff;color:#1d4ed8}
        .returns-redesign__panel-heading h2,.returns-redesign__list-heading h2{margin:0;font-size:19px;color:#172b4d}.returns-redesign__panel-heading p,.returns-redesign__list-heading p{margin:5px 0 0;color:var(--rr-muted);font-size:14px;line-height:1.45}
        .returns-redesign__form{display:grid;gap:20px;padding:22px}.returns-redesign__form-top{display:grid;grid-template-columns:minmax(180px,.8fr) minmax(280px,1.5fr) minmax(190px,.8fr);gap:14px;align-items:start}
        .returns-redesign__number,.returns-redesign__field{min-width:0;display:grid;gap:7px}.returns-redesign__number{align-content:start;padding:13px 15px;min-height:88px;border:1px solid #dbeafe;border-radius:12px;background:#f8fbff}
        .returns-redesign__number span,.returns-redesign__field>span{font-size:13px;color:#475569;font-weight:700}.returns-redesign__number strong{overflow-wrap:anywhere;font-size:15px;color:#1e3a8a}.returns-redesign__number small{color:var(--rr-muted);line-height:1.4}
        .returns-redesign__field input,.returns-redesign__field select,.returns-redesign__notes textarea,.returns-redesign__quantity{width:100%;min-height:43px;padding:10px 12px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;color:#172b4d}
        .returns-redesign__field input:focus,.returns-redesign__field select:focus,.returns-redesign__notes textarea:focus,.returns-redesign__quantity:focus{outline:3px solid #bfdbfe;border-color:#3b82f6}.returns-redesign__required{color:#b42318}.returns-redesign__error-text{display:block;color:#b42318;font-size:13px;line-height:1.4}
        .returns-redesign__summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;padding:14px;border:1px solid var(--rr-line);border-radius:12px;background:var(--rr-soft)}
        .returns-redesign__summary>div,.returns-redesign__detail-grid>div{display:grid;gap:5px;min-width:0;padding:5px}.returns-redesign__summary small,.returns-redesign__detail-grid small{color:var(--rr-muted);font-size:12px;font-weight:650}.returns-redesign__summary strong,.returns-redesign__detail-grid strong{overflow-wrap:anywhere;font-size:14px;line-height:1.4}
        .returns-redesign__items-heading,.returns-redesign__list-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:2px 0 12px}.returns-redesign__items-heading h3{margin:0;font-size:16px}.returns-redesign__items-heading p{margin:5px 0 0;color:var(--rr-muted);font-size:13px;line-height:1.5}
        .returns-redesign__count{white-space:nowrap;padding:6px 10px;border-radius:999px;background:#eff6ff;color:#1d4ed8;font-size:13px;font-weight:750}.returns-redesign__table-scroll{width:100%;overflow-x:auto;border:1px solid var(--rr-line);border-radius:11px}
        .returns-redesign__table{width:100%;border-collapse:collapse;text-align:start;font-size:13px}.returns-redesign__table th{padding:11px 12px;background:#f8fafc;color:#475569;font-size:12px;font-weight:750;white-space:nowrap}.returns-redesign__table td{padding:12px;border-top:1px solid #edf1f5;vertical-align:middle}
        .returns-redesign__table td strong{display:block;color:#1e293b}.returns-redesign__table td small{display:block;margin-top:3px;color:var(--rr-muted)}.returns-redesign__table tr:hover td{background:#fbfdff}.returns-redesign__table--items{min-width:850px}.returns-redesign__table--history{min-width:980px}.returns-redesign__table--history td{max-width:280px}.returns-redesign__product-list{max-width:260px;line-height:1.5;overflow-wrap:anywhere}
        .returns-redesign__quantity{width:120px;min-width:100px;min-height:38px;padding:7px 9px}.returns-redesign__notes{display:grid;gap:7px;max-width:100%;color:#475569;font-size:13px;font-weight:700}.returns-redesign__notes textarea{resize:vertical;min-height:84px;font-weight:400}
        .returns-redesign__notice{margin:0;padding:11px 13px;border:1px solid #bfdbfe;border-radius:10px;background:#eff6ff;color:#1e3a8a;font-size:13px;line-height:1.5}.returns-redesign__form-actions{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:3px}.returns-redesign__form-actions .returns-redesign__button{flex:0 0 auto}
        .returns-redesign__state{display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:20px 22px;color:#475569;line-height:1.5}.returns-redesign__state--error{color:#9f1d16;background:#fff7f6}.returns-redesign__empty{display:grid;justify-items:center;gap:7px;padding:34px 20px;text-align:center;color:#64748b}.returns-redesign__empty strong{color:#24364f}.returns-redesign__list-heading{padding:19px 22px 16px}
        .returns-redesign__table-wrap{padding:0 18px 18px}.returns-redesign__badge{display:inline-flex;padding:4px 8px;border-radius:999px;background:#f1f5f9;color:#334155;font-size:12px;font-weight:750;text-transform:capitalize}.returns-redesign__pagination{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:13px 20px;border-top:1px solid var(--rr-line);color:#64748b;font-size:13px}.returns-redesign__pagination>div{display:flex;align-items:center;gap:10px}.returns-redesign__pagination .returns-redesign__button{min-height:36px;padding:6px 10px;font-size:13px}
        .returns-redesign__modal-backdrop{position:fixed;z-index:1000;inset:0;display:grid;place-items:center;padding:22px;background:#0f172a99}.returns-redesign__dialog{width:min(920px,100%);max-height:min(92vh,920px);overflow:auto;border-radius:16px;background:#fff;box-shadow:0 24px 70px #0004}
        .returns-redesign__dialog-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:20px 23px;border-bottom:1px solid var(--rr-line)}.returns-redesign__dialog-heading h2{margin:0;font-size:21px;overflow-wrap:anywhere}.returns-redesign__dialog-heading p:last-child{margin:6px 0 0;color:var(--rr-muted)}
        .returns-redesign__icon-button{width:42px;height:42px;display:grid;place-items:center;border:1px solid var(--rr-line);border-radius:10px;background:#fff;color:#334155;cursor:pointer}.returns-redesign__dialog-body{display:grid;gap:18px;padding:20px 23px}.returns-redesign__detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;padding:12px;border-radius:12px;background:#f8fafc}.returns-redesign__dialog-footer{display:flex;justify-content:flex-end;padding:14px 23px;border-top:1px solid var(--rr-line)}
        .returns-redesign__spinner{width:18px;height:18px;border:2px solid #cbd5e1;border-top-color:#2563eb;border-radius:50%;animation:returns-redesign-spin .8s linear infinite}@keyframes returns-redesign-spin{to{transform:rotate(360deg)}}
        @media(max-width:760px){.returns-redesign{padding:16px;gap:16px}.returns-redesign__heading{flex-direction:column}.returns-redesign__form{padding:16px}.returns-redesign__form-top{grid-template-columns:1fr}.returns-redesign__panel-heading{padding:16px}.returns-redesign__table-wrap{padding:0 12px 12px}.returns-redesign__pagination{align-items:flex-start;flex-direction:column}.returns-redesign__pagination>div{width:100%;justify-content:space-between}.returns-redesign__form-actions{align-items:stretch;flex-direction:column}.returns-redesign__form-actions .returns-redesign__button{width:100%}.returns-redesign__modal-backdrop{align-items:end;padding:0}.returns-redesign__dialog{max-height:calc(100dvh - 10px);border-radius:16px 16px 0 0}.returns-redesign__dialog-body{padding:16px}.returns-redesign__dialog-heading{padding:16px}}
        @media(max-width:520px){.returns-redesign{padding:12px}.returns-redesign__items-heading{flex-direction:column}.returns-redesign__count{align-self:flex-start}.returns-redesign__summary,.returns-redesign__detail-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.returns-redesign__pagination>div{flex-wrap:wrap}.returns-redesign__pagination>div>span{order:-1;width:100%;text-align:center}}
        @media(prefers-reduced-motion:reduce){.returns-redesign__spinner{animation-duration:1.8s}}
      `}</style>
      <header className="returns-redesign__heading">
        <div><p className="returns-redesign__eyebrow">{t("Operations")}</p><h1>{title}</h1><p>{interpolate(t("Record goods returned against posted {source} transactions. Inventory and partner account effects are applied."), { source: sourceKind.toLowerCase() })}</p></div>
        <button type="button" className="returns-redesign__button" onClick={() => { setRetry((value) => value + 1); setOptionsRetry((value) => value + 1); }} disabled={isLoading || optionsLoading}><RefreshCw size={16} aria-hidden="true" />{t("Refresh")}</button>
      </header>
      {success && <p className="returns-redesign__notice" role="status">{success}</p>}
      <section className="returns-redesign__panel" aria-labelledby="returns-redesign-form-title">
        <header className="returns-redesign__panel-heading"><span className="returns-redesign__panel-icon"><RotateCcw size={19} aria-hidden="true" /></span><div><h2 id="returns-redesign-form-title">{returnMessage}</h2><p>{t("Choose the original posted transaction and enter quantities to return.")}</p></div></header>
        {optionsError && <div className="returns-redesign__state returns-redesign__state--error" role="alert"><AlertCircle size={18} aria-hidden="true" /><span>{optionsError}</span><button type="button" className="returns-redesign__button" onClick={() => setOptionsRetry((value) => value + 1)}>{t("Reload options")}</button></div>}
        {formError && <div className="returns-redesign__state returns-redesign__state--error" role="alert"><AlertCircle size={18} aria-hidden="true" /><span>{formError}</span></div>}
        <form className="returns-redesign__form" onSubmit={(event) => void submit(event)} noValidate>
          <div className="returns-redesign__form-top">
            <div className="returns-redesign__number"><span>{t("Return number")}</span><strong>{returnNumber}</strong><small>{t("Unique number generated for this request.")}</small></div>
            <label className="returns-redesign__field"><span>{interpolate(t("Original {source}"), { source: sourceKind })} <i className="returns-redesign__required">*</i></span>
              <select value={sourceId} onChange={(event) => { setSourceId(event.target.value); setQuantities({}); setFieldErrors({}); setFormError(null); }} disabled={saving || optionsLoading || Boolean(optionsError)} aria-invalid={Boolean(fieldErrors[config.idKey])}>
                <option value="">{optionsLoading ? t("Loading posted transactions...") : interpolate(t("Select {source}"), { source: sourceKind.toLowerCase() })}</option>
                {sources.map((source) => <option value={source.id} key={source.id}>{source.number} | {source.partner} | {formatDate(source.date, language)} | {formatMoney(source.total, source.currency, language)}</option>)}
              </select>{fieldErrors[config.idKey] && <small className="returns-redesign__error-text">{fieldErrors[config.idKey]}</small>}
            </label>
            <label className="returns-redesign__field"><span>{t("Return date")} <i className="returns-redesign__required">*</i></span><input type="date" value={returnDate} onChange={(event) => { setReturnDate(event.target.value); setFieldErrors((current) => { const next = { ...current }; delete next.return_date; return next; }); setFormError(null); }} disabled={saving} aria-invalid={Boolean(fieldErrors.return_date)} />{fieldErrors.return_date && <small className="returns-redesign__error-text">{fieldErrors.return_date}</small>}</label>
          </div>
          {selectedSource ? <>
            <div className="returns-redesign__summary"><div><small>{interpolate(t("Original {source}"), { source: sourceKind })}</small><strong>{selectedSource.number}</strong></div><div><small>{partnerKind}</small><strong>{selectedSource.partner}</strong></div><div><small>{t("Original date")}</small><strong>{formatDate(selectedSource.date, language)}</strong></div><div><small>{t("Warehouse")} / {t("Currency")}</small><strong>{selectedSource.warehouse} / {selectedSource.currency}</strong></div><div><small>{t("Original total")}</small><strong>{formatMoney(selectedSource.total, selectedSource.currency, language)}</strong></div></div>
            <div className="returns-redesign__items-heading"><div><h3>{t("Items eligible for return")}</h3><p>{t("Return amounts use the original posted line values; the backend calculates and records them.")}</p></div><span className="returns-redesign__count">{interpolate(t("{count} items"), { count: numberFormat.format(selectedSource.items.length) })}</span></div>
            <div className="returns-redesign__table-scroll"><table className="returns-redesign__table returns-redesign__table--items"><thead><tr><th>{t("Product")}</th><th>{t("Original quantity")}</th><th>{t("Returned quantity")}</th><th>{t("Remaining quantity")}</th><th>{t("Original unit value")}</th><th>{t("Original line total")}</th><th>{t("Return quantity")}</th></tr></thead>
              <tbody>{selectedSource.items.map((item) => { const remaining = remainingByItem.get(item.id) ?? 0; const returned = item.quantity - remaining; const field = fieldErrors[`items.${item.id}.quantity`]; const quantityLabel = interpolate(t("Return quantity for {product}"), { product: item.product }); return <tr key={item.id}><td><strong>{item.product}</strong>{item.sku && <small>{item.sku}</small>}</td><td>{quantityText(item.quantity)}</td><td>{quantityText(returned)}</td><td>{quantityText(remaining)}</td><td>{formatMoney(item.unitValue, selectedSource.currency, language)}</td><td>{formatMoney(item.lineTotal, selectedSource.currency, language)}</td><td><input className="returns-redesign__quantity" aria-label={quantityLabel} aria-invalid={Boolean(field)} type="number" min="0" max={remaining} step="0.0001" inputMode="decimal" value={quantities[item.id] ?? ""} onChange={(event) => updateQuantity(item.id, event.target.value)} disabled={saving || remaining <= 0} placeholder="-" />{field && <small className="returns-redesign__error-text">{field}</small>}</td></tr>; })}</tbody>
            </table></div>{fieldErrors.items && <small className="returns-redesign__error-text">{fieldErrors.items}</small>}
          </> : <div className="returns-redesign__state">{optionsLoading ? t("Loading eligible transactions...") : sources.length ? interpolate(t("Select a posted {source} to view its items."), { source: sourceKind.toLowerCase() }) : interpolate(t("No posted {source} transactions are available for return."), { source: sourceKind.toLowerCase() })}</div>}
          <label className="returns-redesign__notes"><span>{t("Notes (optional)")}</span><textarea rows={3} maxLength={5000} value={notes} onChange={(event) => setNotes(event.target.value)} disabled={saving} placeholder={t("Optional return notes")} aria-invalid={Boolean(fieldErrors.notes)} />{fieldErrors.notes && <small className="returns-redesign__error-text">{fieldErrors.notes}</small>}</label>
          <p className="returns-redesign__notice">{t("Recording a return does not issue or settle a cash refund or payment.")}</p>
          <div className="returns-redesign__form-actions"><span>{t("The return is recorded against the original transaction; any cash settlement is handled separately.")}</span><button className="returns-redesign__button returns-redesign__button--primary" type="submit" disabled={saving || optionsLoading || Boolean(optionsError) || !sources.length}><Plus size={16} aria-hidden="true" />{saving ? t("Recording...") : returnMessage}</button></div>
        </form>
      </section>
      <section className="returns-redesign__panel" aria-label={interpolate(t("{title} history"), { title })}>
        <div className="returns-redesign__list-heading"><div><h2>{interpolate(t("{title} history"), { title })}</h2><p>{interpolate(t("{count} records"), { count: numberFormat.format(page?.total ?? 0) })}</p></div></div>
        {isLoading ? <div className="returns-redesign__state" role="status"><span className="returns-redesign__spinner" />{t("Loading returns...")}</div>
          : listError ? <div className="returns-redesign__state returns-redesign__state--error" role="alert"><AlertCircle size={19} aria-hidden="true" /><span>{listError}</span><button type="button" className="returns-redesign__button" onClick={() => setRetry((value) => value + 1)}>{t("Try again")}</button></div>
          : page && !page.data.length ? <div className="returns-redesign__empty"><RotateCcw size={22} aria-hidden="true" /><strong>{t("No returns yet")}</strong><span>{t("Recorded returns will appear here.")}</span></div>
          : page && <>
            <div className="returns-redesign__table-wrap"><div className="returns-redesign__table-scroll"><table className="returns-redesign__table returns-redesign__table--history">
              <thead><tr><th>{t("Return number")}</th><th>{t("Return date")}</th><th>{interpolate(t("Original {source}"), { source: sourceKind })}</th><th>{partnerKind}</th><th>{t("Items")}</th><th>{t("Total")}</th><th>{t("Status")}</th><th>{t("Details")}</th></tr></thead>
              <tbody>{page.data.map((record) => { const itemSummary = record.items.map((item) => `${item.product} x ${quantityText(item.quantity)}`).join(", "); return <tr key={record.id}><td><strong>{record.number}</strong></td><td>{formatDate(record.date, language)}</td><td>{record.source.number}</td><td>{record.partner}</td><td><span className="returns-redesign__product-list" title={itemSummary}>{interpolate(t("{count} items"), { count: numberFormat.format(record.items.length) })}{itemSummary ? ` | ${itemSummary}` : ""}</span></td><td><strong>{formatMoney(record.total, record.currency, language)}</strong></td><td><span className="returns-redesign__badge">{t(record.status.replaceAll("_", " "))}</span></td><td><button className="returns-redesign__button" type="button" onClick={() => void openDetails(record)}><Eye size={15} aria-hidden="true" />{t("Details")}</button></td></tr>; })}</tbody>
            </table></div></div>
            <footer className="returns-redesign__pagination"><span>{interpolate(t("Showing {start}-{end} of {total}"), { start: numberFormat.format(startRecord), end: numberFormat.format(endRecord), total: numberFormat.format(page.total) })}</span><div>
              <button type="button" className="returns-redesign__button" onClick={() => setCurrentPage((value) => value - 1)} disabled={page.currentPage <= 1} aria-label={t("Previous page")}>{direction === "rtl" ? <ChevronRight size={15} aria-hidden="true" /> : <ChevronLeft size={15} aria-hidden="true" />}{t("Previous")}</button>
              <span>{interpolate(t("Page {page} of {lastPage}"), { page: numberFormat.format(page.currentPage), lastPage: numberFormat.format(page.lastPage) })}</span>
              <button type="button" className="returns-redesign__button" onClick={() => setCurrentPage((value) => value + 1)} disabled={page.currentPage >= page.lastPage} aria-label={t("Next page")}>{t("Next")}{direction === "rtl" ? <ChevronLeft size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}</button>
            </div></footer>
          </>}
      </section>
      {(selected || detailLoading || detailError) && <div className="returns-redesign__modal-backdrop" role="presentation">
        <section className="returns-redesign__dialog" role="dialog" aria-modal="true" aria-labelledby="returns-redesign-detail-title">
          <header className="returns-redesign__dialog-heading"><div><p className="returns-redesign__eyebrow">{t("Return details")}</p><h2 id="returns-redesign-detail-title">{selected?.number ?? title}</h2><p>{selected && formatDate(selected.date, language)}</p></div><button type="button" className="returns-redesign__icon-button" aria-label={t("Close details")} disabled={detailLoading} onClick={() => { setSelected(null); setDetailError(null); }}><X size={19} aria-hidden="true" /></button></header>
          {detailLoading ? <div className="returns-redesign__state" role="status"><span className="returns-redesign__spinner" />{t("Loading return details...")}</div>
            : detailError ? <div className="returns-redesign__state returns-redesign__state--error" role="alert"><AlertCircle size={19} aria-hidden="true" /><span>{detailError}</span><button type="button" className="returns-redesign__button" onClick={() => selected && void openDetails(selected)}>{t("Retry")}</button></div>
            : selected && <div className="returns-redesign__dialog-body">
              <div className="returns-redesign__detail-grid"><div><small>{interpolate(t("Original {source}"), { source: sourceKind })}</small><strong>{selected.source.number}</strong></div><div><small>{partnerKind}</small><strong>{selected.partner}</strong></div><div><small>{t("Return date")}</small><strong>{formatDate(selected.date, language)}</strong></div><div><small>{t("Warehouse")}</small><strong>{selected.warehouse}</strong></div><div><small>{t("Created by")}</small><strong>{selected.creator || "-"}</strong></div><div><small>{t("Status")}</small><strong>{t(selected.status.replaceAll("_", " "))}</strong></div><div><small>{t("Subtotal")}</small><strong>{formatMoney(selected.subtotal, selected.currency, language)}</strong></div><div><small>{t("Total")}</small><strong>{formatMoney(selected.total, selected.currency, language)}</strong></div><div><small>{t("Notes")}</small><strong>{selected.notes || t("No notes")}</strong></div></div>
              <div className="returns-redesign__items-heading"><h3>{t("Returned items")}</h3><span className="returns-redesign__count">{interpolate(t("{count} items"), { count: numberFormat.format(selected.items.length) })}</span></div>
              <div className="returns-redesign__table-scroll"><table className="returns-redesign__table returns-redesign__table--items"><thead><tr><th>{t("Product")}</th><th>{t("Quantity")}</th><th>{t("Unit value")}</th><th>{t("Line total")}</th><th>{t("Notes")}</th></tr></thead><tbody>
                {selected.items.map((item) => <tr key={item.id}><td><strong>{item.product}</strong>{item.sku && <small>{item.sku}</small>}</td><td>{quantityText(item.quantity)}</td><td>{formatMoney(item.unitValue, selected.currency, language)}</td><td><strong>{formatMoney(item.lineTotal, selected.currency, language)}</strong></td><td>{item.notes || "-"}</td></tr>)}
              </tbody></table></div>
            </div>}
          <footer className="returns-redesign__dialog-footer"><button type="button" className="returns-redesign__button" onClick={() => { setSelected(null); setDetailError(null); }}>{t("Close")}</button></footer>
        </section>
      </div>}
    </div>
  );
}
