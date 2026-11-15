import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, RefreshCw, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { fetchAllPages, getErrorMessage, getValidationResult, isRecord, numberValue, optionalText, parseId, parseLaravelPage, todayValue } from "@/app/InventoryShared";

export type SettlementKind = "sale" | "purchase";

interface ReturnOption {
  id: number;
  number: string;
  date: string;
  partner: string;
  currencyId: number;
  currency: string;
  total: number;
  status: string;
}

interface AccountOption {
  id: number;
  name: string;
  currencyId: number;
  currency: string;
  balance: number;
}

interface Settlement {
  id: number;
  number: string;
  date: string;
  returnId: number;
  returnNumber: string;
  partner: string;
  account: string;
  currencyId: number;
  currency: string;
  amount: number;
  exchangeRate: number;
  notes: string | null;
  creator: string | null;
}

interface Page<T> { data: T[]; currentPage: number; lastPage: number; perPage: number; total: number }

function settlementNumber(kind: SettlementKind): string {
  const date = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const suffix = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase() : Math.random().toString(36).slice(2, 12).toUpperCase();
  return `${kind === "sale" ? "SRF" : "PRF"}-${date}-${suffix}`;
}

function relationName(value: unknown, ...fields: string[]): string {
  if (!isRecord(value)) return "—";
  for (const field of fields) if (typeof value[field] === "string" && value[field].trim()) return value[field];
  return "—";
}

function parseReturn(value: unknown, kind: SettlementKind): ReturnOption {
  if (!isRecord(value) || !isRecord(value.currency)) throw new Error("The return list contains an incomplete record.");
  const currency = value.currency;
  const sale = kind === "sale";
  const number = value.return_number;
  const date = value.return_date;
  if (typeof number !== "string" || typeof date !== "string" || typeof currency.code !== "string") throw new Error("The return record is missing its reference, date, or currency.");
  return {
    id: parseId(value.id, "return ID"), number, date: date.slice(0, 10),
    partner: relationName(sale ? value.customer : value.supplier, "business_name", "name"),
    currencyId: parseId(currency.id, "currency ID"), currency: currency.code.toUpperCase(),
    total: numberValue(value.grand_total, "return total"), status: typeof value.status === "string" ? value.status : "unknown",
  };
}

function parseAccount(value: unknown): AccountOption {
  if (!isRecord(value) || !isRecord(value.currency) || typeof value.name !== "string") throw new Error("The financial accounts response contains an incomplete account.");
  return { id: parseId(value.id, "account ID"), name: value.name, currencyId: parseId(value.currency.id, "account currency ID"), currency: String(value.currency.code ?? "").toUpperCase(), balance: numberValue(value.current_balance, "account balance") };
}

function parseSettlement(value: unknown, kind: SettlementKind): Settlement {
  if (!isRecord(value) || !isRecord(value.currency) || !isRecord(value.financial_account)) throw new Error("The settlement history contains an incomplete record.");
  const sale = kind === "sale";
  const original = value[sale ? "sale_return" : "purchase_return"];
  const currency = value.currency;
  return {
    id: parseId(value.id, "settlement ID"), number: typeof value.settlement_number === "string" ? value.settlement_number : `Settlement ${String(value.id)}`,
    date: typeof value.settlement_date === "string" ? value.settlement_date.slice(0, 10) : "",
    returnId: parseId(value[sale ? "sale_return_id" : "purchase_return_id"], "return ID"),
    returnNumber: relationName(original, "return_number"), partner: isRecord(original) ? relationName(original[sale ? "customer" : "supplier"], "business_name", "name") : "—",
    account: typeof value.financial_account.name === "string" ? value.financial_account.name : "Account",
    currencyId: parseId(currency.id, "currency ID"), currency: String(currency.code ?? "").toUpperCase(),
    amount: numberValue(value.amount, "settlement amount"), exchangeRate: numberValue(value.exchange_rate_to_afn, "exchange rate"),
    notes: optionalText(value.notes), creator: isRecord(value.creator) && typeof value.creator.name === "string" ? value.creator.name : null,
  };
}

function money(amount: number, currency: string): string {
  return `${currency} ${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(amount)}`;
}

function dateLabel(value: string): string {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export default function ReturnSettlements({ kind }: { kind: SettlementKind }) {
  const sale = kind === "sale";
  const config = sale
    ? { title: "Sale Return Settlements", endpoint: "/api/sale-return-settlements", returnEndpoint: "/api/sale-returns", returnKey: "sale_return_id", partner: "Customer", emptyTitle: "No customer refunds recorded" }
    : { title: "Purchase Return Settlements", endpoint: "/api/purchase-return-settlements", returnEndpoint: "/api/purchase-returns", returnKey: "purchase_return_id", partner: "Supplier", emptyTitle: "No supplier refunds recorded" };
  const [returns, setReturns] = useState<ReturnOption[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [page, setPage] = useState<Page<Settlement> | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [listRetry, setListRetry] = useState(0);
  const [returnId, setReturnId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [number, setNumber] = useState(() => settlementNumber(kind));
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
      fetchAllPages(config.returnEndpoint, {}, (row) => parseReturn(row, kind), controller.signal),
      fetchAllPages(config.endpoint, {}, (row) => parseSettlement(row, kind), controller.signal),
      api.get<unknown>("/api/financial-accounts/balances", { signal: controller.signal }).then(({ data }) => {
        if (!isRecord(data) || !Array.isArray(data.data)) throw new Error("The financial account list response is incomplete.");
        return data.data.map(parseAccount);
      }),
    ]).then(([returnRows, settlementRows, accountRows]) => {
      setReturns(returnRows.filter((record) => record.status === "posted"));
      setSettlements(settlementRows);
      setAccounts(accountRows);
    }).catch((error: unknown) => { if (!controller.signal.aborted) setOptionsError(getErrorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setOptionsLoading(false); });
    return () => controller.abort();
  }, [config.endpoint, config.returnEndpoint, kind, optionsRetry]);

  useEffect(() => {
    const controller = new AbortController();
    setListLoading(true); setListError(null);
    api.get<unknown>(config.endpoint, { params: { page: pageNumber, ...(returnId ? { [config.returnKey]: Number(returnId) } : {}) }, signal: controller.signal })
      .then(({ data }) => setPage(parseLaravelPage(data, (row) => parseSettlement(row, kind))))
      .catch((error: unknown) => { if (!controller.signal.aborted) { setPage(null); setListError(getErrorMessage(error)); } })
      .finally(() => { if (!controller.signal.aborted) setListLoading(false); });
    return () => controller.abort();
  }, [config.endpoint, config.returnKey, kind, pageNumber, returnId, listRetry]);

  const selectedReturn = returns.find((record) => String(record.id) === returnId) ?? null;
  const selectedAccount = accounts.find((account) => String(account.id) === accountId) ?? null;
  const relatedSettlements = useMemo(() => settlements.filter((item) => item.returnId === selectedReturn?.id), [settlements, selectedReturn]);
  const settled = relatedSettlements.reduce((sum, item) => sum + item.amount, 0);
  const remaining = selectedReturn ? Math.max(0, selectedReturn.total - settled) : 0;
  const accountOptions = selectedReturn ? accounts.filter((account) => account.currencyId === selectedReturn.currencyId) : [];
  const eligibleReturns = returns.filter((item) => item.total - settlements.filter((settlement) => settlement.returnId === item.id).reduce((sum, settlement) => sum + settlement.amount, 0) > 0);

  function selectReturn(value: string) {
    setReturnId(value); setAccountId(""); setAmount(""); setFieldErrors({}); setFormError(null); setSuccess(null);
    const selectedOption = returns.find((item) => String(item.id) === value);
    setExchangeRate(selectedOption?.currency === "AFN" ? "1" : "");
    setPageNumber(1);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return;
    const errors: Record<string, string> = {};
    if (!selectedReturn) errors[config.returnKey] = `Select a posted ${config.title.includes("Sale") ? "sale return" : "purchase return"}.`;
    if (!selectedAccount) errors.financial_account_id = "Select a financial account.";
    if (selectedReturn && selectedAccount && selectedReturn.currencyId !== selectedAccount.currencyId) errors.financial_account_id = "Choose an account in the return currency.";
    const numericAmount = Number(amount);
    if (!/^\d+(?:\.\d{1,4})?$/.test(amount.trim()) || !Number.isFinite(numericAmount) || numericAmount <= 0) errors.amount = "Enter a positive amount with up to 4 decimal places.";
    else if (numericAmount > remaining) errors.amount = `Amount cannot exceed the unsettled return balance of ${money(remaining, selectedReturn?.currency ?? "")} .`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00`).getTime())) errors.settlement_date = "Enter a valid settlement date.";
    else if (selectedReturn && date < selectedReturn.date) errors.settlement_date = "Settlement date cannot be before the return date.";
    if (!/^\d+(?:\.\d{1,8})?$/.test(exchangeRate.trim()) || !Number.isFinite(Number(exchangeRate)) || Number(exchangeRate) <= 0) errors.exchange_rate_to_afn = "Enter a positive exchange rate with up to 8 decimal places.";
    else if (selectedReturn?.currency === "AFN" && Number(exchangeRate) !== 1) errors.exchange_rate_to_afn = "The AFN exchange rate must be 1.";
    setFieldErrors(errors);
    if (Object.keys(errors).length) { setFormError("Review the highlighted fields."); return; }
    setSaving(true); setFormError(null); setSuccess(null);
    try {
      const payload = { settlement_number: number.trim(), [config.returnKey]: selectedReturn!.id, financial_account_id: selectedAccount!.id, currency_id: selectedReturn!.currencyId, amount: amount.trim(), exchange_rate_to_afn: exchangeRate.trim(), settlement_date: date, notes: notes.trim() || null };
      const { data } = await api.post<unknown>(config.endpoint, payload);
      setSuccess(isRecord(data) && typeof data.message === "string" ? data.message : "Settlement recorded successfully.");
      setReturnId(""); setAccountId(""); setAmount(""); setExchangeRate(""); setNotes(""); setNumber(settlementNumber(kind)); setFieldErrors({}); setPageNumber(1); setListRetry((value) => value + 1); setOptionsRetry((value) => value + 1);
    } catch (error: unknown) {
      const result = getValidationResult(error); setFormError(result.message); setFieldErrors(result.fields);
    } finally { setSaving(false); }
  }

  const start = page && page.total > 0 ? (page.currentPage - 1) * page.perPage + 1 : 0;
  const end = page ? Math.min((page.currentPage - 1) * page.perPage + page.data.length, page.total) : 0;
  const historyReturn = returnId ? selectedReturn : null;

  return <div className="settlements-page">
    <header className="settlements-heading"><div><p className="overview-eyebrow">FINANCE</p><h1>{config.title}</h1><p>{sale ? "Refund customers from sale returns." : "Record refunds received from suppliers for purchase returns."} Backend validation checks partner credit, account funds, and settlement limits.</p></div><button className="overview-refresh" type="button" onClick={() => { setListRetry((value) => value + 1); setOptionsRetry((value) => value + 1); }} disabled={listLoading || optionsLoading}><RefreshCw size={16} /> Refresh</button></header>
    {success && <p className="settlements-success" role="status">{success}</p>}
    {optionsError && <div className="settlements-error" role="alert"><AlertCircle size={17} />{optionsError}<button type="button" onClick={() => setOptionsRetry((value) => value + 1)}>Reload data</button></div>}
    <section className="settlements-panel" aria-labelledby="settlement-form-title"><header className="settlements-panel-heading"><span><Wallet size={18} /></span><div><h2 id="settlement-form-title">Record {sale ? "customer refund" : "supplier refund"}</h2><p>Choose a return with an unsettled balance. Currency must match the financial account.</p></div></header>{formError && <p className="settlements-form-error" role="alert">{formError}</p>}
      <form className="settlements-form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="settlements-number"><small>Settlement number</small><strong>{number}</strong><span>Generated unique reference</span></div>
        <label><span>Eligible {sale ? "sale" : "purchase"} return <i>*</i></span><select value={returnId} onChange={(event) => selectReturn(event.target.value)} disabled={saving || optionsLoading || Boolean(optionsError)} aria-invalid={Boolean(fieldErrors[config.returnKey])}><option value="">{optionsLoading ? "Loading returns…" : "Select return"}</option>{eligibleReturns.map((item) => { const already = settlements.filter((record) => record.returnId === item.id).reduce((sum, record) => sum + record.amount, 0); return <option key={item.id} value={item.id}>{item.number} · {item.partner} · {item.currency} {new Intl.NumberFormat().format(item.total - already)} remaining</option>; })}</select>{fieldErrors[config.returnKey] && <small className="settlements-field-error">{fieldErrors[config.returnKey]}</small>}</label>
        {selectedReturn && <div className="settlements-return-summary"><div><small>Return</small><strong>{selectedReturn.number}</strong></div><div><small>{config.partner}</small><strong>{selectedReturn.partner}</strong></div><div><small>Currency</small><strong>{selectedReturn.currency}</strong></div><div><small>Return total</small><strong>{money(selectedReturn.total, selectedReturn.currency)}</strong></div><div><small>Already settled</small><strong>{money(settled, selectedReturn.currency)}</strong></div><div><small>Remaining</small><strong>{money(remaining, selectedReturn.currency)}</strong></div></div>}
        <label><span>Financial account <i>*</i></span><select value={accountId} onChange={(event) => { setAccountId(event.target.value); setFieldErrors((current) => { const next = { ...current }; delete next.financial_account_id; return next; }); }} disabled={saving || !selectedReturn || !accountOptions.length} aria-invalid={Boolean(fieldErrors.financial_account_id)}><option value="">Select same-currency account</option>{accountOptions.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency} · Current balance {money(account.balance, account.currency)}</option>)}</select>{fieldErrors.financial_account_id && <small className="settlements-field-error">{fieldErrors.financial_account_id}</small>}{selectedReturn && !accountOptions.length && <small className="settlements-field-error">No active financial account uses {selectedReturn.currency}.</small>}</label>
        <label><span>Amount <i>*</i>{selectedReturn && <small> ({selectedReturn.currency}; remaining {money(remaining, selectedReturn.currency)})</small>}</span><input type="number" min="0.0001" step="0.0001" inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setFieldErrors((current) => { const next = { ...current }; delete next.amount; return next; }); }} disabled={saving || !selectedReturn || remaining <= 0} placeholder="0.00" aria-invalid={Boolean(fieldErrors.amount)} />{fieldErrors.amount && <small className="settlements-field-error">{fieldErrors.amount}</small>}</label>
        <label><span>Settlement date <i>*</i></span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} disabled={saving} aria-invalid={Boolean(fieldErrors.settlement_date)} />{fieldErrors.settlement_date && <small className="settlements-field-error">{fieldErrors.settlement_date}</small>}</label>
        <label><span>Exchange rate to AFN <i>*</i></span><input type="number" min="0.00000001" step="0.00000001" value={exchangeRate} onChange={(event) => setExchangeRate(event.target.value)} disabled={saving || selectedReturn?.currency === "AFN"} placeholder={selectedReturn?.currency === "AFN" ? "1" : "Rate per currency unit"} aria-invalid={Boolean(fieldErrors.exchange_rate_to_afn)} />{fieldErrors.exchange_rate_to_afn && <small className="settlements-field-error">{fieldErrors.exchange_rate_to_afn}</small>}{selectedReturn?.currency === "AFN" && <small>AFN rate is fixed at 1.</small>}</label>
        <label className="settlements-notes"><span>Notes (optional)</span><textarea rows={2} maxLength={5000} value={notes} onChange={(event) => setNotes(event.target.value)} disabled={saving} placeholder="Optional settlement note" aria-invalid={Boolean(fieldErrors.notes)} />{fieldErrors.notes && <small className="settlements-field-error">{fieldErrors.notes}</small>}</label>
        <div className="settlements-form-actions"><span>{sale ? "Refunds reduce account funds; the backend also checks customer credit." : "Supplier refunds increase account funds; the backend also checks supplier credit."}</span><button type="submit" className="settlements-submit" disabled={saving || optionsLoading || Boolean(optionsError) || !selectedReturn || !selectedAccount || remaining <= 0}>{saving ? "Processing…" : sale ? "Record customer refund" : "Record supplier refund"}</button></div>
      </form>
    </section>
    <section className="settlements-panel" aria-label="Settlement history"><div className="settlements-list-heading"><div><h2>Settlement history</h2><p>{page?.total.toLocaleString() ?? 0} records{historyReturn ? ` for ${historyReturn.number}` : ""}</p></div><div>{returnId && <button className="settlements-clear-filter" type="button" onClick={() => selectReturn("")}>Clear return filter</button>}</div></div>
      {listLoading ? <div className="settlements-state" role="status"><span className="loading-spinner" />Loading settlements…</div> : listError ? <div className="settlements-state settlements-state--error" role="alert">{listError}<button type="button" onClick={() => setListRetry((value) => value + 1)}>Try again</button></div> : page && !page.data.length ? <div className="settlements-state settlements-state--empty"><strong>{config.emptyTitle}</strong><small>Recorded settlements will appear here.</small></div> : page && <><div className="settlements-table-scroll"><table className="settlements-table"><thead><tr><th>Settlement</th><th>Date</th><th>Return</th><th>{config.partner}</th><th>Financial account</th><th>Currency</th><th>Amount</th><th>Exchange rate</th></tr></thead><tbody>{page.data.map((record) => <tr key={record.id}><td><strong>{record.number}</strong>{record.notes && <small>{record.notes}</small>}</td><td>{dateLabel(record.date)}</td><td>{record.returnNumber}</td><td>{record.partner}</td><td>{record.account}</td><td><span className="settlements-currency">{record.currency}</span></td><td><strong>{money(record.amount, record.currency)}</strong></td><td>{record.exchangeRate}</td></tr>)}</tbody></table></div><footer className="settlements-pagination"><span>Showing {start}–{end} of {page.total.toLocaleString()}</span><div><button type="button" onClick={() => setPageNumber((value) => value - 1)} disabled={page.currentPage <= 1}><ChevronLeft size={15} /> Previous</button><span>Page <strong>{page.currentPage}</strong> of <strong>{page.lastPage}</strong></span><button type="button" onClick={() => setPageNumber((value) => value + 1)} disabled={page.currentPage >= page.lastPage}>Next <ChevronRight size={15} /></button></div></footer></>}
    </section>
  </div>;
}
