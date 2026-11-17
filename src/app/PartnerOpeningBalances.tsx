import { useEffect, useMemo, useState, type FormEvent } from "react";
import axios from "axios";
import { AlertCircle, ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/locale";

type PartnerType = "Customer" | "Supplier";
type PartnerTypeFilter = PartnerType | "All";
type RecordPartnerType = PartnerType | "Unknown";

interface PartnerOption {
  id: number;
  name: string;
  partnerType: PartnerType;
  businessName: string | null;
}

interface CurrencyOption {
  id: number;
  code: string;
  name: string;
  symbol: string;
}

interface OpeningBalanceRecord {
  id: number;
  partnerId: number;
  partnerName: string;
  partnerType: RecordPartnerType;
  currencyId: number;
  currencyCode: string;
  currencySymbol: string;
  amount: string;
  openingDate: string;
  notes: string | null;
  creator: string | null;
}

interface Pagination<T> {
  rows: T[];
  lastPage: number;
}

interface OpeningBalanceForm {
  partnerId: string;
  currencyId: string;
  amount: string;
  openingDate: string;
  notes: string;
}

type FieldErrors = Partial<Record<keyof OpeningBalanceForm, string>>;

function todayInputDate(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const emptyForm: OpeningBalanceForm = {
  partnerId: "",
  currencyId: "",
  amount: "",
  openingDate: todayInputDate(),
  notes: "",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseId(value: unknown): number {
  const id = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error("The server returned an invalid record ID.");
  return id;
}

function parsePagination<T>(value: unknown, parser: (row: unknown) => T | null): Pagination<(T | null)> {
  if (!isRecord(value) || !isRecord(value.data) || !Array.isArray(value.data.data) || typeof value.data.last_page !== "number") {
    throw new Error("The server returned an incomplete paginated response.");
  }
  return { rows: value.data.data.map(parser), lastPage: value.data.last_page };
}

function parsePartner(value: unknown): PartnerOption | null {
  if (!isRecord(value) || (value.partner_type !== "Customer" && value.partner_type !== "Supplier") || typeof value.name !== "string") {
    throw new Error("The server returned an invalid active partner.");
  }
  if (value.is_active !== true) return null;
  return {
    id: parseId(value.id),
    name: value.name,
    partnerType: value.partner_type,
    businessName: typeof value.business_name === "string" ? value.business_name : null,
  };
}

function parseCurrency(value: unknown): CurrencyOption {
  if (!isRecord(value) || typeof value.code !== "string" || typeof value.name !== "string") {
    throw new Error("The server returned an invalid currency.");
  }
  return {
    id: parseId(value.id),
    code: value.code,
    name: value.name,
    symbol: typeof value.symbol === "string" ? value.symbol : value.code,
  };
}

function parseOpeningBalance(value: unknown): OpeningBalanceRecord {
  if (!isRecord(value) || !isRecord(value.currency)) {
    throw new Error("The server returned an invalid opening-balance record.");
  }
  const partner = isRecord(value.business_partner) ? value.business_partner : null;
  const partnerType: RecordPartnerType = partner?.partner_type === "Customer" || partner?.partner_type === "Supplier" ? partner.partner_type : "Unknown";
  return {
    id: parseId(value.id),
    partnerId: parseId(partner?.id ?? value.business_partner_id),
    partnerName: typeof partner?.name === "string" ? partner.name : `Partner #${String(value.business_partner_id ?? "unknown")}`,
    partnerType,
    currencyId: parseId(value.currency.id),
    currencyCode: typeof value.currency.code === "string" ? value.currency.code : "",
    currencySymbol: typeof value.currency.symbol === "string" ? value.currency.symbol : String(value.currency.code ?? ""),
    amount: typeof value.amount === "string" || typeof value.amount === "number" ? String(value.amount) : "0",
    openingDate: typeof value.opening_date === "string" ? value.opening_date.slice(0, 10) : "",
    notes: typeof value.notes === "string" && value.notes ? value.notes : null,
    creator: isRecord(value.creator) && typeof value.creator.name === "string" ? value.creator.name : null,
  };
}

function errorDetails(error: unknown): { message: string; fields: FieldErrors } {
  if (!axios.isAxiosError(error)) {
    return { message: error instanceof Error ? error.message : "The request could not be completed.", fields: {} };
  }
  const body: unknown = error.response?.data;
  const message = isRecord(body) && typeof body.message === "string" ? body.message : !error.response ? "Could not connect to the server. Check your connection and try again." : "The request could not be completed.";
  const fields: FieldErrors = {};
  if (isRecord(body) && isRecord(body.errors)) {
    const map: Record<string, keyof OpeningBalanceForm> = {
      business_partner_id: "partnerId",
      currency_id: "currencyId",
      opening_date: "openingDate",
    };
    for (const [key, messages] of Object.entries(body.errors)) {
      if (Array.isArray(messages) && typeof messages[0] === "string") {
        const field = map[key] ?? (key in emptyForm ? key as keyof OpeningBalanceForm : undefined);
        if (field) fields[field] = messages[0];
      }
    }
  }
  return { message, fields };
}

function amountUnits(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole || "0") * 10000n + BigInt((fraction + "0000").slice(0, 4));
}

function formatUnits(units: bigint, currency: string): string {
  const whole = units / 10000n;
  const fraction = String(units % 10000n).padStart(4, "0").replace(/0+$/, "");
  const formatted = new Intl.NumberFormat(undefined).format(Number(whole));
  return `${currency} ${fraction ? `${formatted}.${fraction}` : formatted}`;
}

async function fetchAllPages<T>(
  endpoint: string,
  params: Record<string, string | number | undefined>,
  parser: (row: unknown) => T | null,
  signal: AbortSignal,
): Promise<T[]> {
  const first = await api.get<unknown>(endpoint, { params: { ...params, page: 1 }, signal });
  const page = parsePagination(first.data, parser);
  const rows = page.rows.filter((row): row is T => row !== null);
  for (let start = 2; start <= page.lastPage; start += 4) {
    const pageNumbers = Array.from({ length: Math.min(4, page.lastPage - start + 1) }, (_, index) => start + index);
    const responses = await Promise.all(pageNumbers.map((pageNumber) => api.get<unknown>(endpoint, { params: { ...params, page: pageNumber }, signal })));
    for (const response of responses) rows.push(...parsePagination(response.data, parser).rows.filter((row): row is T => row !== null));
  }
  return rows;
}

function formatDate(value: string, language: "en" | "ps"): string {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(language === "ps" ? "ps-AF" : "en-US", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export default function PartnerOpeningBalances() {
  const { direction, language, t } = useLocale();
  const [partnerType, setPartnerType] = useState<PartnerType>("Customer");
  const [partnerId, setPartnerId] = useState("");
  const [currencyId, setCurrencyId] = useState("");
  const [amount, setAmount] = useState("");
  const [openingDate, setOpeningDate] = useState(todayInputDate());
  const [notes, setNotes] = useState("");
  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([]);
  const [records, setRecords] = useState<OpeningBalanceRecord[]>([]);
  const [listFilter, setListFilter] = useState<PartnerTypeFilter>("All");
  const [tablePage, setTablePage] = useState(1);
  const [partnerLoading, setPartnerLoading] = useState(true);
  const [currencyLoading, setCurrencyLoading] = useState(true);
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [partnersError, setPartnersError] = useState<string | null>(null);
  const [currenciesError, setCurrenciesError] = useState<string | null>(null);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formFields, setFormFields] = useState<FieldErrors>({});
  const [success, setSuccess] = useState<string | null>(null);
  const [recordsRetry, setRecordsRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setPartnerLoading(true);
    setPartnersError(null);
    fetchAllPages("/api/business-partners", { partner_type: partnerType }, parsePartner, controller.signal)
      .then((rows) => setPartners(rows))
      .catch((error: unknown) => { if (!controller.signal.aborted) { setPartners([]); setPartnersError(errorDetails(error).message); } })
      .finally(() => { if (!controller.signal.aborted) setPartnerLoading(false); });
    setPartnerId("");
    return () => controller.abort();
  }, [partnerType]);

  useEffect(() => {
    const controller = new AbortController();
    setCurrencyLoading(true);
    setCurrenciesError(null);
    fetchAllPages("/api/currencies", { is_active: "true", per_page: 100 }, parseCurrency, controller.signal)
      .then((rows) => setCurrencies(rows.filter((currency) => ["AFN", "USD", "PKR"].includes(currency.code))))
      .catch((error: unknown) => { if (!controller.signal.aborted) { setCurrencies([]); setCurrenciesError(errorDetails(error).message); } })
      .finally(() => { if (!controller.signal.aborted) setCurrencyLoading(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setRecordsLoading(true);
    setRecordsError(null);
    fetchAllPages("/api/partner-opening-balances", {}, parseOpeningBalance, controller.signal)
      .then((rows) => setRecords(rows))
      .catch((error: unknown) => { if (!controller.signal.aborted) { setRecords([]); setRecordsError(errorDetails(error).message); } })
      .finally(() => { if (!controller.signal.aborted) setRecordsLoading(false); });
    return () => controller.abort();
  }, [recordsRetry]);

  const filteredRecords = useMemo(() => records.filter((record) => listFilter === "All" || record.partnerType === listFilter), [records, listFilter]);
  const pageSize = 20;
  const lastPage = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const visibleRecords = filteredRecords.slice((tablePage - 1) * pageSize, tablePage * pageSize);
  const selectedPartner = partners.find((partner) => String(partner.id) === partnerId);
  const knownDuplicate = records.some((record) => record.partnerId === Number(partnerId) && record.currencyId === Number(currencyId) && record.openingDate === openingDate);

  function setFormValue(field: "partnerId" | "currencyId" | "amount" | "openingDate" | "notes", value: string) {
    if (field === "partnerId") setPartnerId(value);
    if (field === "currencyId") setCurrencyId(value);
    if (field === "amount") setAmount(value);
    if (field === "openingDate") setOpeningDate(value);
    if (field === "notes") setNotes(value);
    setFormFields((current) => ({ ...current, [field]: undefined }));
    setFormError(null);
    setSuccess(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const fields: FieldErrors = {};
    if (!partnerId) fields.partnerId = `Select a ${partnerType.toLowerCase()}.`;
    if (!currencyId) fields.currencyId = "Select a currency.";
    if (!/^\d{1,16}(?:\.\d{1,4})?$/.test(amount.trim()) || Number(amount) <= 0) fields.amount = "Enter a positive amount with up to 4 decimal places.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(openingDate) || Number.isNaN(new Date(`${openingDate}T00:00:00`).getTime())) fields.openingDate = "Enter a valid opening date.";
    setFormFields(fields);
    if (Object.keys(fields).length) { setFormError("Check the highlighted fields."); return; }
    if (knownDuplicate) { setFormError("An opening balance already exists for this partner, currency, and date."); return; }

    setSaving(true);
    setFormError(null);
    setSuccess(null);
    try {
      const response = await api.post<unknown>("/api/partner-opening-balances", {
        business_partner_id: Number(partnerId),
        currency_id: Number(currencyId),
        amount: amount.trim(),
        opening_date: openingDate,
        notes: notes.trim() || null,
      });
      const message = isRecord(response.data) && typeof response.data.message === "string" ? response.data.message : "Opening balance recorded successfully.";
      setSuccess(message);
      setAmount("");
      setNotes("");
      setFormFields({});
      setRecordsRetry((value) => value + 1);
    } catch (error: unknown) {
      const details = errorDetails(error);
      setFormFields(details.fields);
      setFormError(details.message);
    } finally {
      setSaving(false);
    }
  }

  const totals = useMemo(() => {
    const result = new Map<string, bigint>();
    for (const record of records) {
      if (record.partnerType === "Unknown") continue;
      const key = `${record.partnerType}:${record.currencyCode}`;
      try { result.set(key, (result.get(key) ?? 0n) + amountUnits(record.amount)); } catch { /* Invalid amounts are excluded from display totals. */ }
    }
    return result;
  }, [records]);

  return <div className="purchases-page partner-opening-page" dir={direction}>
    <header className="purchases-heading">
      <div><p className="overview-eyebrow">{t("PARTNERS")}</p><h1>{t("Opening Balances")}</h1><p className="overview-heading__description">{t("Record starting amounts owed by customers or owed to suppliers.")}</p></div>
    </header>

    {success && <p className="purchase-success-message" role="status">{t(success)}</p>}

    <section className="purchases-panel partner-opening-form-panel" aria-labelledby="partner-opening-form-title">
      <header className="partner-opening-section-heading"><div><h2 id="partner-opening-form-title">{t("Record opening balance")}</h2><p>{t("Each partner can have one opening balance per currency and date.")}</p></div></header>
      {formError && <p className="create-purchase-alert" role="alert">{t(formError)}</p>}
      {currenciesError && <p className="create-purchase-alert" role="alert">{t("Could not load currencies:")} {t(currenciesError)}</p>}
      <form className="partner-opening-form" onSubmit={(event) => void submit(event)} noValidate>
        <label className="purchase-field"><span>{t("Partner type")} <i>*</i></span><select value={partnerType} onChange={(event) => setPartnerType(event.target.value as PartnerType)} disabled={saving}><option value="Customer">{t("Customer")} — {t("Receivable")}</option><option value="Supplier">{t("Supplier")} — {t("Payable")}</option></select></label>
        <label className="purchase-field"><span>{t(partnerType)} <i>*</i></span><select value={partnerId} onChange={(event) => setFormValue("partnerId", event.target.value)} disabled={saving || partnerLoading || Boolean(partnersError)} aria-invalid={Boolean(formFields.partnerId)}><option value="">{partnerLoading ? t("Loading partners…") : t("Select {partner}").replace("{partner}", t(partnerType))}</option>{partners.map((partner) => <option value={partner.id} key={partner.id}>{partner.name}{partner.businessName ? ` · ${partner.businessName}` : ""}</option>)}</select>{formFields.partnerId && <small className="purchase-field__error">{t(formFields.partnerId)}</small>}{partnersError && <small className="purchase-field__error">{t(partnersError)}</small>}{!partnerLoading && !partnersError && partners.length === 0 && <small>{t("No active {partner} records are available.").replace("{partner}", t(partnerType))}</small>}</label>
        <label className="purchase-field"><span>{t("Currency")} <i>*</i></span><select value={currencyId} onChange={(event) => setFormValue("currencyId", event.target.value)} disabled={saving || currencyLoading || Boolean(currenciesError)} aria-invalid={Boolean(formFields.currencyId)}><option value="">{currencyLoading ? t("Loading currencies…") : t("Select currency")}</option>{currencies.map((currency) => <option value={currency.id} key={currency.id}>{currency.code} — {currency.name}</option>)}</select>{formFields.currencyId && <small className="purchase-field__error">{t(formFields.currencyId)}</small>}{!currencyLoading && !currenciesError && currencies.length === 0 && <small>{t("No active AFN, USD, or PKR currencies are configured.")}</small>}</label>
        <label className="purchase-field"><span>{t("Opening amount")} <i>*</i></span><input type="number" inputMode="decimal" min="0.0001" step="0.0001" max="9999999999999999.9999" value={amount} onChange={(event) => setFormValue("amount", event.target.value)} placeholder="0.00" disabled={saving} aria-invalid={Boolean(formFields.amount)} />{formFields.amount && <small className="purchase-field__error">{t(formFields.amount)}</small>}</label>
        <label className="purchase-field"><span>{t("Opening date")} <i>*</i></span><input type="date" value={openingDate} onChange={(event) => setFormValue("openingDate", event.target.value)} disabled={saving} aria-invalid={Boolean(formFields.openingDate)} />{formFields.openingDate && <small className="purchase-field__error">{t(formFields.openingDate)}</small>}</label>
        <label className="purchase-field partner-opening-form__notes"><span>{t("Notes")}</span><textarea rows={2} maxLength={5000} value={notes} onChange={(event) => setFormValue("notes", event.target.value)} disabled={saving} placeholder={t("Optional note")} /></label>
        {knownDuplicate && <p className="partner-opening-duplicate" role="status"><AlertCircle size={15} /> {t("A balance already exists for this partner, currency, and date.")}</p>}
        <div className="partner-opening-form__actions"><span>{selectedPartner ? t(partnerType === "Customer" ? "Receivable from {name}" : "Payable to {name}").replace("{name}", selectedPartner.name) : t("Customer balances are receivable; supplier balances are payable.")}</span><button type="submit" className="purchase-save-button" disabled={saving || recordsLoading || Boolean(recordsError) || partnerLoading || currencyLoading || !currencies.length || !partners.length || knownDuplicate}><Plus size={16} aria-hidden="true" />{t(saving ? "Saving…" : "Record opening balance")}</button></div>
      </form>
    </section>

    <section className="purchases-panel partner-opening-totals" aria-label={t("Opening balance totals by partner type and currency")}>
      <div className="partner-opening-section-heading"><div><h2>{t("Opening balance totals")}</h2><p>{t("Totals include all loaded opening-balance records. Currencies are not converted or combined.")}</p></div>{recordsLoading && <span className="partner-opening-loading"><span className="loading-spinner" /> {t("Updating")}</span>}</div>
      {recordsError ? <div className="purchases-state purchases-state--error" role="alert"><AlertCircle size={19} />{t(recordsError)}<button type="button" className="purchases-retry" onClick={() => setRecordsRetry((value) => value + 1)}>{t("Try again")}</button></div> : <div className="partner-opening-total-grid">{(["Customer", "Supplier"] as const).flatMap((type) => (["AFN", "USD", "PKR"] as const).map((code) => {
        const currency = currencies.find((item) => item.code === code);
        const value = totals.get(`${type}:${code}`) ?? 0n;
        return <article className={`partner-opening-total partner-opening-total--${type.toLowerCase()}`} key={`${type}-${code}`}><span>{t(type === "Customer" ? "Customer receivable" : "Supplier payable")}</span><strong>{formatUnits(value, currency?.symbol ?? code)}</strong><small>{code}</small></article>;
      }))}</div>}
    </section>

    <section className="purchases-panel partner-opening-list" aria-label={t("Opening balance records")}>
      <div className="partner-opening-list__toolbar"><div><h2>{t("Recorded opening balances")}</h2><p>{t("{count} records").replace("{count}", filteredRecords.length.toLocaleString())}</p></div><div className="partner-opening-list__controls"><label><span>{t("Partner type")}</span><select value={listFilter} onChange={(event) => { setListFilter(event.target.value as PartnerTypeFilter); setTablePage(1); }}><option value="All">{t("All")}</option><option value="Customer">{t("Customer")}</option><option value="Supplier">{t("Supplier")}</option></select></label><button type="button" className="overview-refresh" onClick={() => setRecordsRetry((value) => value + 1)} disabled={recordsLoading} aria-label={t("Refresh opening balances")}><RefreshCw size={15} className={recordsLoading ? "overview-refresh__spinning" : ""} />{t("Refresh")}</button></div></div>
      {recordsLoading ? <div className="purchases-state" role="status"><span className="loading-spinner" /> {t("Loading opening balances…")}</div> : recordsError ? <div className="purchases-state purchases-state--error" role="alert"><AlertCircle size={19} />{t(recordsError)}<button type="button" className="purchases-retry" onClick={() => setRecordsRetry((value) => value + 1)}>{t("Try again")}</button></div> : visibleRecords.length === 0 ? <div className="purchases-state purchases-state--empty"><strong>{t("No opening balances yet")}</strong><span>{t("Recorded balances will appear here.")}</span></div> : <><div className="purchases-table-scroll"><table className="purchases-table partner-opening-table"><thead><tr><th>{t("Date")}</th><th>{t("Partner")}</th><th>{t("Type")}</th><th>{t("Amount")}</th><th>{t("Notes")}</th><th>{t("Recorded by")}</th></tr></thead><tbody>{visibleRecords.map((record) => <tr key={record.id}><td>{formatDate(record.openingDate, language)}</td><td><strong>{record.partnerName}</strong></td><td><span className={`partner-opening-type partner-opening-type--${record.partnerType.toLowerCase()}`}>{t(record.partnerType === "Customer" ? "Receivable" : record.partnerType === "Supplier" ? "Payable" : "Partner unavailable")}</span></td><td><strong>{formatUnits(amountUnits(record.amount), record.currencySymbol || record.currencyCode)}</strong><small className="partner-opening-table__currency">{record.currencyCode}</small></td><td>{record.notes || "—"}</td><td>{record.creator || "—"}</td></tr>)}</tbody></table></div><footer className="purchases-pagination"><span>{t("Showing {start}–{end} of {total} records").replace("{start}", String((tablePage - 1) * pageSize + 1)).replace("{end}", String(Math.min(tablePage * pageSize, filteredRecords.length))).replace("{total}", filteredRecords.length.toLocaleString())}</span><div className="purchases-pagination__controls"><button type="button" onClick={() => setTablePage((value) => value - 1)} disabled={tablePage <= 1} aria-label={t("Previous page")}><ChevronLeft size={16} /> {t("Previous")}</button><span>{t("Page")} <strong>{tablePage}</strong> {t("of")} <strong>{lastPage}</strong></span><button type="button" onClick={() => setTablePage((value) => value + 1)} disabled={tablePage >= lastPage} aria-label={t("Next page")}>{t("Next")} <ChevronRight size={16} /></button></div></footer></>}
    </section>
  </div>;
}
