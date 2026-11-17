import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, RefreshCw, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { fetchAllPages, getErrorMessage, getValidationResult, isRecord, numberValue, optionalText, parseId, parseLaravelPage, todayValue } from "@/app/InventoryShared";
import { useLocale } from "@/lib/locale";

interface SaleOption {
  id: number;
  number: string;
  date: string;
  customer: string;
  currencyId: number;
  currency: string;
  total: number;
  paid: number;
  remaining: number;
  status: string;
}

interface AccountOption {
  id: number;
  name: string;
  currencyId: number;
  currency: string;
  balance: number;
}

interface Receipt {
  id: number;
  number: string;
  date: string;
  saleNumber: string;
  customer: string;
  account: string;
  currency: string;
  amount: number;
  exchangeRate: number;
  creator: string | null;
  notes: string | null;
}

interface Page<T> { data: T[]; currentPage: number; lastPage: number; perPage: number; total: number }

function paymentNumber(): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const suffix = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase() : Math.random().toString(36).slice(2, 10).toUpperCase();
  return `PAY-${stamp}-${suffix}`;
}

function relationName(value: unknown, ...fields: string[]): string {
  if (!isRecord(value)) return "—";
  for (const field of fields) if (typeof value[field] === "string" && value[field].trim()) return value[field];
  return "—";
}

function parseSale(value: unknown): SaleOption {
  if (!isRecord(value) || !isRecord(value.currency) || typeof value.sale_number !== "string" || typeof value.sale_date !== "string") throw new Error("The sale list contains an incomplete record.");
  const currency = value.currency;
  const total = numberValue(value.grand_total, "sale total");
  const payments = Array.isArray(value.payments) ? value.payments : [];
  const paid = payments.reduce((sum, item) => sum + (isRecord(item) ? numberValue(item.amount, "sale payment amount") : 0), 0);
  return {
    id: parseId(value.id, "sale ID"), number: value.sale_number, date: value.sale_date.slice(0, 10),
    customer: relationName(value.customer, "business_name", "name"), currencyId: parseId(currency.id, "currency ID"),
    currency: String(currency.code ?? "").toUpperCase(), total, paid, remaining: Math.max(0, total - paid),
    status: typeof value.status === "string" ? value.status : "unknown",
  };
}

function parseAccount(value: unknown): AccountOption {
  if (!isRecord(value) || !isRecord(value.currency) || typeof value.name !== "string") throw new Error("The financial account list contains an incomplete record.");
  return { id: parseId(value.id, "account ID"), name: value.name, currencyId: parseId(value.currency.id, "account currency ID"), currency: String(value.currency.code ?? "").toUpperCase(), balance: numberValue(value.current_balance, "account balance") };
}

function parseReceipt(value: unknown): Receipt {
  if (!isRecord(value) || !isRecord(value.sale) || !isRecord(value.financial_account) || !isRecord(value.currency)) throw new Error("The receipt response is missing sale, account, or currency data.");
  const sale = value.sale;
  const customer = sale.customer;
  const currency = value.currency;
  if (typeof value.payment_number !== "string" || typeof value.payment_date !== "string" || typeof currency.code !== "string") throw new Error("The receipt response is missing its number, date, or currency.");
  return {
    id: parseId(value.id, "receipt ID"), number: value.payment_number, date: value.payment_date.slice(0, 10),
    saleNumber: typeof sale.sale_number === "string" ? sale.sale_number : "—",
    customer: relationName(customer, "business_name", "name"),
    account: typeof value.financial_account.name === "string" ? value.financial_account.name : "Account",
    currency: currency.code.toUpperCase(), amount: numberValue(value.amount, "receipt amount"),
    exchangeRate: numberValue(value.exchange_rate_to_afn, "exchange rate"),
    creator: isRecord(value.creator) && typeof value.creator.name === "string" ? value.creator.name : null,
    notes: optionalText(value.notes),
  };
}

function money(amount: number, currency: string): string {
  return `${currency} ${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(amount)}`;
}

function dateLabel(value: string): string {
  if (!value) return "—";
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(parsed);
}

export default function CustomerReceipts() {
  const { direction, t } = useLocale();
  const [sales, setSales] = useState<SaleOption[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [page, setPage] = useState<Page<Receipt> | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [listRetry, setListRetry] = useState(0);
  const [saleId, setSaleId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [number, setNumber] = useState(paymentNumber);
  const [date, setDate] = useState(todayValue);
  const [amount, setAmount] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [notes, setNotes] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setOptionsLoading(true); setOptionsError(null);
    Promise.all([
      fetchAllPages("/api/sales", {}, parseSale, controller.signal),
      api.get<unknown>("/api/financial-accounts/balances", { signal: controller.signal }).then(({ data }) => {
        if (!isRecord(data) || !Array.isArray(data.data)) throw new Error("The financial account response is incomplete.");
        return data.data.map(parseAccount);
      }),
    ]).then(([saleRows, accountRows]) => { setSales(saleRows.filter((sale) => sale.status === "posted" && sale.remaining > 0)); setAccounts(accountRows); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setOptionsError(getErrorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setOptionsLoading(false); });
    return () => controller.abort();
  }, [optionsRetry]);

  useEffect(() => {
    const controller = new AbortController();
    setListLoading(true); setListError(null);
    api.get<unknown>("/api/sale-payments", { params: { page: pageNumber }, signal: controller.signal })
      .then(({ data }) => setPage(parseLaravelPage(data, parseReceipt)))
      .catch((error: unknown) => { if (!controller.signal.aborted) { setPage(null); setListError(getErrorMessage(error)); } })
      .finally(() => { if (!controller.signal.aborted) setListLoading(false); });
    return () => controller.abort();
  }, [pageNumber, listRetry]);

  const selectedSale = sales.find((sale) => String(sale.id) === saleId) ?? null;
  const selectedAccount = accounts.find((account) => String(account.id) === accountId) ?? null;
  const accountOptions = useMemo(() => selectedSale ? accounts.filter((account) => account.currencyId === selectedSale.currencyId) : [], [accounts, selectedSale]);

  function selectSale(value: string) {
    setSaleId(value); setAccountId(""); setAmount(""); setFieldErrors({}); setFormError(null); setSuccess(null);
    const selected = sales.find((sale) => String(sale.id) === value);
    setExchangeRate(selected?.currency === "AFN" ? "1" : "");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return;
    const errors: Record<string, string> = {};
    if (!selectedSale) errors.sale_id = "Select an eligible posted sale.";
    if (!selectedAccount) errors.financial_account_id = "Select a financial account.";
    if (selectedSale && selectedAccount && selectedSale.currencyId !== selectedAccount.currencyId) errors.financial_account_id = "The financial account currency must match the sale currency.";
    const numericAmount = Number(amount);
    if (!/^\d+(?:\.\d{1,4})?$/.test(amount.trim()) || !Number.isFinite(numericAmount) || numericAmount <= 0) errors.amount = "Enter a positive amount with up to 4 decimal places.";
    else if (selectedSale && numericAmount > selectedSale.remaining) errors.amount = `Amount cannot exceed the remaining sale balance of ${money(selectedSale.remaining, selectedSale.currency)}.`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00`).getTime())) errors.payment_date = "Enter a valid receipt date.";
    else if (selectedSale && date < selectedSale.date) errors.payment_date = "Receipt date cannot be before the sale date.";
    if (!/^\d+(?:\.\d{1,8})?$/.test(exchangeRate.trim()) || !Number.isFinite(Number(exchangeRate)) || Number(exchangeRate) <= 0) errors.exchange_rate_to_afn = "Enter a positive exchange rate with up to 8 decimal places.";
    else if (selectedSale?.currency === "AFN" && Number(exchangeRate) !== 1) errors.exchange_rate_to_afn = "AFN exchange rate must be 1.";
    setFieldErrors(errors);
    if (Object.keys(errors).length) { setFormError("Review the highlighted fields."); return; }
    setSaving(true); setFormError(null); setSuccess(null);
    try {
      const { data } = await api.post<unknown>("/api/sale-payments", {
        payment_number: number.trim(), sale_id: selectedSale!.id, financial_account_id: selectedAccount!.id,
        currency_id: selectedSale!.currencyId, amount: amount.trim(), exchange_rate_to_afn: exchangeRate.trim(),
        payment_date: date, notes: notes.trim() || null,
      });
      setSuccess(isRecord(data) && typeof data.message === "string" ? data.message : "Customer receipt recorded successfully.");
      setSaleId(""); setAccountId(""); setAmount(""); setExchangeRate(""); setNotes(""); setNumber(paymentNumber()); setFieldErrors({});
      setPageNumber(1); setListRetry((value) => value + 1); setOptionsRetry((value) => value + 1);
    } catch (error: unknown) { const result = getValidationResult(error); setFormError(result.message); setFieldErrors(result.fields); }
    finally { setSaving(false); }
  }

  const first = page && page.total > 0 ? (page.currentPage - 1) * page.perPage + 1 : 0;
  const last = page ? Math.min((page.currentPage - 1) * page.perPage + page.data.length, page.total) : 0;

  return <div className="customer-receipts-page" dir={direction}>
    <header className="customer-receipts-heading"><div><p className="overview-eyebrow">{t("FINANCE & TOOLS")}</p><h1>{t("Customer Receipts")}</h1><p>{t("Record and review amounts received for posted sales. The backend updates the sale balance and account transaction.")}</p></div><button className="overview-refresh" type="button" onClick={() => { setOptionsRetry((value) => value + 1); setListRetry((value) => value + 1); }} disabled={optionsLoading || listLoading}><RefreshCw size={16} /> {t("Refresh")}</button></header>
    {success && <p className="customer-receipts-success" role="status">{t(success)}</p>}
    {optionsError && <div className="customer-receipts-error" role="alert"><AlertCircle size={17} />{t(optionsError)}<button type="button" onClick={() => setOptionsRetry((value) => value + 1)}>{t("Reload sales and accounts")}</button></div>}
    <section className="customer-receipts-panel" aria-labelledby="customer-receipt-form-title"><header className="customer-receipts-panel-heading"><span><Wallet size={18} /></span><div><h2 id="customer-receipt-form-title">{t("Record receipt")}</h2><p>{t("Select an unpaid or partially paid posted sale and receive funds into a matching account.")}</p></div></header>{formError && <p className="customer-receipts-form-error" role="alert">{t(formError)}</p>}
      <form className="customer-receipts-form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="customer-receipts-number"><small>{t("Receipt number")}</small><strong>{number}</strong><span>{t("Unique PAY reference")}</span></div>
        <label><span>{t("Posted sale")} <i>*</i></span><select value={saleId} onChange={(event) => selectSale(event.target.value)} disabled={saving || optionsLoading || Boolean(optionsError)} aria-invalid={Boolean(fieldErrors.sale_id)}><option value="">{optionsLoading ? t("Loading sales…") : t("Select a sale")}</option>{sales.map((sale) => <option value={sale.id} key={sale.id}>{sale.number} · {sale.customer} · {sale.currency} {new Intl.NumberFormat().format(sale.remaining)} {t("due")}</option>)}</select>{fieldErrors.sale_id && <small className="customer-receipts-field-error">{t(fieldErrors.sale_id)}</small>}</label>
        {selectedSale && <div className="customer-receipts-sale-summary"><div><small>{t("Sale")}</small><strong>{selectedSale.number}</strong></div><div><small>{t("Customer")}</small><strong>{selectedSale.customer}</strong></div><div><small>{t("Sale date")}</small><strong>{dateLabel(selectedSale.date)}</strong></div><div><small>{t("Currency")}</small><strong>{selectedSale.currency}</strong></div><div><small>{t("Grand total")}</small><strong>{money(selectedSale.total, selectedSale.currency)}</strong></div><div><small>{t("Already paid")}</small><strong>{money(selectedSale.paid, selectedSale.currency)}</strong></div><div><small>{t("Remaining balance")}</small><strong>{money(selectedSale.remaining, selectedSale.currency)}</strong></div></div>}
        <label><span>{t("Financial account")} <i>*</i></span><select value={accountId} onChange={(event) => { setAccountId(event.target.value); setFieldErrors((current) => { const next = { ...current }; delete next.financial_account_id; return next; }); }} disabled={saving || !selectedSale || !accountOptions.length} aria-invalid={Boolean(fieldErrors.financial_account_id)}><option value="">{t("Select same-currency account")}</option>{accountOptions.map((account) => <option value={account.id} key={account.id}>{account.name} · {account.currency} · {t("Current balance")} {money(account.balance, account.currency)}</option>)}</select>{fieldErrors.financial_account_id && <small className="customer-receipts-field-error">{t(fieldErrors.financial_account_id)}</small>}{selectedSale && !accountOptions.length && <small className="customer-receipts-field-error">{t("No active financial account uses {currency}.").replace("{currency}", selectedSale.currency)}</small>}</label>
        <label><span>{t("Receipt amount")} <i>*</i>{selectedSale && <small> ({selectedSale.currency})</small>}</span><input type="number" min="0.0001" step="0.0001" inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setFieldErrors((current) => { const next = { ...current }; delete next.amount; return next; }); }} disabled={saving || !selectedSale} placeholder="0.00" aria-invalid={Boolean(fieldErrors.amount)} />{fieldErrors.amount && <small className="customer-receipts-field-error">{t(fieldErrors.amount)}</small>}</label>
        <label><span>{t("Receipt date")} <i>*</i></span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} disabled={saving} aria-invalid={Boolean(fieldErrors.payment_date)} />{fieldErrors.payment_date && <small className="customer-receipts-field-error">{t(fieldErrors.payment_date)}</small>}</label>
        <label><span>{t("Exchange rate to AFN")} <i>*</i></span><input type="number" min="0.00000001" step="0.00000001" value={exchangeRate} onChange={(event) => setExchangeRate(event.target.value)} disabled={saving || selectedSale?.currency === "AFN"} placeholder={selectedSale?.currency === "AFN" ? "1" : t("Rate per currency unit")} aria-invalid={Boolean(fieldErrors.exchange_rate_to_afn)} />{fieldErrors.exchange_rate_to_afn && <small className="customer-receipts-field-error">{t(fieldErrors.exchange_rate_to_afn)}</small>}{selectedSale?.currency === "AFN" && <small>{t("AFN rate is fixed at 1.")}</small>}</label>
        <label className="customer-receipts-notes"><span>{t("Notes (optional)")}</span><textarea rows={2} maxLength={5000} value={notes} onChange={(event) => setNotes(event.target.value)} disabled={saving} placeholder={t("Optional receipt note")} aria-invalid={Boolean(fieldErrors.notes)} />{fieldErrors.notes && <small className="customer-receipts-field-error">{t(fieldErrors.notes)}</small>}</label>
        <div className="customer-receipts-form-actions"><span>{t("Backend validation checks the sale balance, currency, account funds, and payment date.")}</span><button type="submit" className="customer-receipts-submit" disabled={saving || optionsLoading || Boolean(optionsError) || !selectedSale || !selectedAccount}>{t(saving ? "Recording…" : "Record receipt")}</button></div>
      </form>
    </section>
    <section className="customer-receipts-panel" aria-label={t("Receipt history")}><div className="customer-receipts-list-heading"><div><h2>{t("Receipt history")}</h2><p>{t("{count} receipts").replace("{count}", String(page?.total.toLocaleString() ?? 0))}</p></div></div>
      {listLoading ? <div className="customer-receipts-state" role="status"><span className="loading-spinner" />{t("Loading receipts…")}</div> : listError ? <div className="customer-receipts-state customer-receipts-state--error" role="alert">{t(listError)}<button type="button" onClick={() => setListRetry((value) => value + 1)}>{t("Try again")}</button></div> : page && !page.data.length ? <div className="customer-receipts-state customer-receipts-state--empty"><strong>{t("No customer receipts recorded")}</strong><small>{t("Receipts will appear here after they are recorded.")}</small></div> : page && <><div className="customer-receipts-table-scroll"><table className="customer-receipts-table"><thead><tr><th>{t("Receipt number")}</th><th>{t("Date")}</th><th>{t("Sale number")}</th><th>{t("Customer")}</th><th>{t("Financial account")}</th><th>{t("Currency")}</th><th>{t("Amount")}</th><th>{t("Creator")}</th></tr></thead><tbody>{page.data.map((receipt) => <tr key={receipt.id}><td><strong>{receipt.number}</strong>{receipt.notes && <small>{receipt.notes}</small>}</td><td>{dateLabel(receipt.date)}</td><td>{receipt.saleNumber}</td><td>{receipt.customer}</td><td>{receipt.account}</td><td><span className="customer-receipts-currency">{receipt.currency}</span></td><td><strong>{money(receipt.amount, receipt.currency)}</strong></td><td>{receipt.creator ?? "—"}</td></tr>)}</tbody></table></div><footer className="customer-receipts-pagination"><span>{t("Showing {start}–{end} of {total}").replace("{start}", String(first)).replace("{end}", String(last)).replace("{total}", page.total.toLocaleString())}</span><div><button type="button" onClick={() => setPageNumber((value) => value - 1)} disabled={page.currentPage <= 1}><ChevronLeft size={15} /> {t("Previous")}</button><span>{t("Page")} <strong>{page.currentPage}</strong> {t("of")} <strong>{page.lastPage}</strong></span><button type="button" onClick={() => setPageNumber((value) => value + 1)} disabled={page.currentPage >= page.lastPage}>{t("Next")} <ChevronRight size={15} /></button></div></footer></>}
    </section>
  </div>;
}
