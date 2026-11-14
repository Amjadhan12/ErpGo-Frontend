import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, BookOpen, Filter, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { fetchAllPages, getErrorMessage, isRecord, numberValue, parseId } from "@/app/InventoryShared";

type Currency = { id: number; code: string; name: string; decimals: number; active: boolean };
type AccountOption = { id: number; name: string; accountType: string; currency: Currency; balance: number };
type CurrencySummary = { currency: string; opening: number; totalIn: number; totalOut: number; closing: number };
type AccountSummary = { id: number; name: string; type: string; currency: string; opening: number; totalIn: number; totalOut: number; closing: number };
type Transaction = { id: number; accountId: number; account: string; currency: string; date: string; type: string; direction: "in" | "out"; amount: number; description: string | null; reference: string; balance: number };
type Report = { summaries: CurrencySummary[]; accountSummaries: AccountSummary[]; transactions: Transaction[]; page: number; lastPage: number; total: number };
type AppliedFilters = { fromDate: string; toDate: string; accountId: string; currencyId: string };

const currencyCodes = ["AFN", "USD", "PKR"];

function currencyParse(value: unknown): Currency {
  if (!isRecord(value) || typeof value.code !== "string" || typeof value.name !== "string") throw new Error("The currency options response is incomplete.");
  return { id: parseId(value.id, "currency ID"), code: value.code.toUpperCase(), name: value.name, decimals: typeof value.decimal_places === "number" ? value.decimal_places : 2, active: value.is_active === true };
}
function parseAccountOption(value: unknown): AccountOption {
  if (!isRecord(value) || !isRecord(value.currency)) throw new Error("The financial account options response is incomplete.");
  const currency = currencyParse(value.currency);
  return { id: parseId(value.id, "account ID"), name: typeof value.name === "string" ? value.name : "Account", accountType: typeof value.account_type === "string" ? value.account_type : "—", currency, balance: numberValue(value.current_balance, "account balance") };
}
function parseReport(value: unknown): Report {
  if (!isRecord(value) || !isRecord(value.data) || !Array.isArray(value.data.summary_by_currency) || !Array.isArray(value.data.account_summaries) || !isRecord(value.data.transactions) || !Array.isArray(value.data.transactions.data)) throw new Error("The Cash Book response is incomplete.");
  const data = value.data;
  const page = data.transactions as Record<string, unknown>;
  const summaryRows = data.summary_by_currency as unknown[];
  const accountRows = data.account_summaries as unknown[];
  const transactionRows = page.data as unknown[];
  const summaries = summaryRows.map((row): CurrencySummary => {
    if (!isRecord(row) || typeof row.currency !== "string") throw new Error("The Cash Book currency summary is invalid.");
    return { currency: row.currency.toUpperCase(), opening: numberValue(row.opening_balance, "opening balance"), totalIn: numberValue(row.total_in, "total in"), totalOut: numberValue(row.total_out, "total out"), closing: numberValue(row.closing_balance, "closing balance") };
  });
  const accountSummaries = accountRows.map((row): AccountSummary => {
    if (!isRecord(row)) throw new Error("The Cash Book account summary is invalid.");
    return { id: parseId(row.financial_account_id, "account ID"), name: typeof row.account_name === "string" ? row.account_name : "Account", type: typeof row.account_type === "string" ? row.account_type : "—", currency: typeof row.currency === "string" ? row.currency.toUpperCase() : "—", opening: numberValue(row.opening_balance, "opening balance"), totalIn: numberValue(row.total_in, "total in"), totalOut: numberValue(row.total_out, "total out"), closing: numberValue(row.closing_balance, "closing balance") };
  });
  const transactions = transactionRows.map((row): Transaction => {
    if (!isRecord(row) || (row.direction !== "in" && row.direction !== "out")) throw new Error("The Cash Book contains an invalid transaction row.");
    const reference = [typeof row.reference_type === "string" ? row.reference_type : null, row.reference_id === null || row.reference_id === undefined ? null : String(row.reference_id)].filter(Boolean).join(" #");
    return { id: parseId(row.id, "transaction ID"), accountId: parseId(row.financial_account_id, "account ID"), account: typeof row.account_name === "string" ? row.account_name : "Account", currency: typeof row.currency === "string" ? row.currency.toUpperCase() : "—", date: typeof row.transaction_date === "string" ? row.transaction_date : "", type: typeof row.transaction_type === "string" ? row.transaction_type : "Transaction", direction: row.direction, amount: numberValue(row.amount, "transaction amount"), description: typeof row.description === "string" && row.description.trim() ? row.description : null, reference: reference || "—", balance: numberValue(row.running_balance, "running balance") };
  });
  return { summaries, accountSummaries, transactions, page: typeof page.current_page === "number" ? page.current_page : 1, lastPage: typeof page.last_page === "number" ? page.last_page : 1, total: typeof page.total === "number" ? page.total : 0 };
}
function formatMoney(amount: number, code: string, decimals: number): string {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: code, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(amount); }
  catch { return `${amount.toLocaleString(undefined, { maximumFractionDigits: decimals })} ${code}`; }
}
export default function CashBook() {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [draft, setDraft] = useState<AppliedFilters>({ fromDate: "", toDate: "", accountId: "", currencyId: "" });
  const [filters, setFilters] = useState<AppliedFilters>({ fromDate: "", toDate: "", accountId: "", currencyId: "" });
  const [page, setPage] = useState(1);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [filterError, setFilterError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController(); const signal = controller.signal;
    setOptionsLoading(true); setOptionsError(null);
    void Promise.all([
      api.get<unknown>("/api/financial-accounts/balances", { signal }).then(({ data }) => {
        if (!isRecord(data) || !Array.isArray(data.data)) throw new Error("The financial account options response is incomplete.");
        setAccounts(data.data.map(parseAccountOption));
      }),
      fetchAllPages("/api/currencies", { is_active: "true", per_page: 100 }, currencyParse, signal).then((rows) => setCurrencies(rows.filter((row) => row.active))),
    ]).catch((requestError: unknown) => { if (!signal.aborted) setOptionsError(getErrorMessage(requestError)); })
      .finally(() => { if (!signal.aborted) setOptionsLoading(false); });
    return () => controller.abort();
  }, [optionsRetry]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    const params = { from_date: filters.fromDate || undefined, to_date: filters.toDate || undefined, financial_account_id: filters.accountId || undefined, currency_id: filters.currencyId || undefined, page, per_page: 20 };
    void api.get<unknown>("/api/reports/cash-book", { params, signal: controller.signal })
      .then(({ data }) => setReport(parseReport(data)))
      .catch((requestError: unknown) => { if (!controller.signal.aborted) { setError(getErrorMessage(requestError)); setReport(null); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, page, retry]);

  const summaries = useMemo(() => currencyCodes.map((code) => report?.summaries.find((row) => row.currency === code) ?? { currency: code, opening: 0, totalIn: 0, totalOut: 0, closing: 0 }), [report]);
  const currencyFor = (code: string) => currencies.find((item) => item.code === code)?.decimals ?? 2;
  const filteredAccounts = useMemo(() => draft.currencyId ? accounts.filter((item) => String(item.currency.id) === draft.currencyId) : accounts, [accounts, draft.currencyId]);

  function applyFilters() {
    if (draft.fromDate && draft.toDate && draft.toDate < draft.fromDate) { setFilterError("To date must be on or after the from date."); return; }
    setFilterError(null); setPage(1); setFilters({ ...draft });
  }
  function resetFilters() {
    const cleared = { fromDate: "", toDate: "", accountId: "", currencyId: "" };
    setDraft(cleared); setFilters(cleared); setPage(1); setFilterError(null);
  }

  return <div className="cash-book-page">
    <header className="cash-book-heading"><div><p className="cash-book-eyebrow">FINANCE</p><h1>Cash Book</h1><p>Review account movements and balances by currency.</p></div><button type="button" className="cash-book-refresh" aria-label="Refresh report" onClick={() => { setRetry((value) => value + 1); setOptionsRetry((value) => value + 1); }}><RefreshCw size={16} /> Refresh</button></header>
    <section className="cash-book-filters"><div className="cash-book-panel-heading"><div><span className="cash-book-panel-icon"><Filter size={17} /></span><div><h2>Report filters</h2><p>Choose a date range, account, or currency.</p></div></div></div><div className="cash-book-filter-grid">
      <label><span>From date</span><input type="date" value={draft.fromDate} max={draft.toDate || undefined} onChange={(event) => setDraft((value) => ({ ...value, fromDate: event.target.value }))} /></label>
      <label><span>To date</span><input type="date" value={draft.toDate} min={draft.fromDate || undefined} onChange={(event) => setDraft((value) => ({ ...value, toDate: event.target.value }))} /></label>
      <label><span>Currency</span><select value={draft.currencyId} onChange={(event) => setDraft((value) => ({ ...value, currencyId: event.target.value, accountId: "" }))}><option value="">All currencies</option>{currencies.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
      <label><span>Financial account</span><select value={draft.accountId} onChange={(event) => setDraft((value) => ({ ...value, accountId: event.target.value }))}><option value="">All accounts</option>{filteredAccounts.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.currency.code}</option>)}</select></label>
    </div>{filterError && <p className="cash-book-inline-error" role="alert">{filterError}</p>}{optionsError && <div className="cash-book-options-error" role="alert">{optionsError}<button type="button" onClick={() => setOptionsRetry((value) => value + 1)}>Reload options</button></div>}<div className="cash-book-filter-actions"><span>{optionsLoading ? "Loading filter options…" : `${accounts.length} active accounts available`}</span><div><button type="button" className="cash-book-reset" onClick={resetFilters}>Reset</button><button type="button" className="cash-book-apply" onClick={applyFilters}>Apply filters</button></div></div></section>
    <section className="cash-book-summary-grid" aria-label="Cash book summary by currency">{summaries.map((summary) => { const decimals = currencyFor(summary.currency); return <article className="cash-book-summary-card" key={summary.currency}><div className="cash-book-summary-top"><span>{summary.currency}</span><BookOpen size={17} /></div><div className="cash-book-summary-values"><div><span>Opening balance</span><strong>{formatMoney(summary.opening, summary.currency, decimals)}</strong></div><div><span>Total in</span><strong className="cash-book-in-value">{formatMoney(summary.totalIn, summary.currency, decimals)}</strong></div><div><span>Total out</span><strong>{formatMoney(summary.totalOut, summary.currency, decimals)}</strong></div><div className="cash-book-closing"><span>Closing balance</span><strong>{formatMoney(summary.closing, summary.currency, decimals)}</strong></div></div></article>; })}</section>
    <section className="cash-book-panel"><div className="cash-book-panel-heading"><div><div className="cash-book-panel-icon"><BookOpen size={17} /></div><div><h2>Account summary</h2><p>Balances for the selected accounts and period.</p></div></div></div>{loading ? <div className="cash-book-state" role="status">Loading account summary…</div> : error ? <div className="cash-book-state cash-book-error" role="alert">{error}<button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div> : report?.accountSummaries.length ? <div className="cash-book-table-scroll"><table className="cash-book-table"><thead><tr><th>Account</th><th>Type</th><th>Currency</th><th>Opening</th><th>Total in</th><th>Total out</th><th>Closing</th></tr></thead><tbody>{report.accountSummaries.map((row) => { const decimals = currencyFor(row.currency); return <tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.type}</td><td><span className="cash-book-currency-pill">{row.currency}</span></td><td>{formatMoney(row.opening, row.currency, decimals)}</td><td className="cash-book-in-value">{formatMoney(row.totalIn, row.currency, decimals)}</td><td>{formatMoney(row.totalOut, row.currency, decimals)}</td><td className="cash-book-strong-value">{formatMoney(row.closing, row.currency, decimals)}</td></tr>; })}</tbody></table></div> : !error && !loading ? <div className="cash-book-state">No active accounts match these filters.</div> : null}</section>
    <section className="cash-book-panel cash-book-transactions"><div className="cash-book-panel-heading"><div><div className="cash-book-panel-icon"><ArrowDownLeft size={17} /></div><div><h2>Transaction ledger</h2><p>{report?.total ?? 0} transactions for the selected report.</p></div></div></div>{loading ? <div className="cash-book-state" role="status">Loading transactions…</div> : error ? <div className="cash-book-state cash-book-error" role="alert">{error}<button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div> : report?.transactions.length ? <><div className="cash-book-table-scroll"><table className="cash-book-table cash-book-ledger-table"><thead><tr><th>Date</th><th>Account</th><th>Type</th><th>Direction</th><th>Description</th><th>Reference</th><th>Amount</th><th>Running balance</th></tr></thead><tbody>{report.transactions.map((row) => { const decimals = currencyFor(row.currency); return <tr key={row.id}><td>{row.date.replace("T", " ").slice(0, 16)}</td><td><strong>{row.account}</strong><small>{row.currency}</small></td><td>{row.type}</td><td><span className={`cash-book-direction cash-book-direction--${row.direction}`}>{row.direction === "in" ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}{row.direction === "in" ? "In" : "Out"}</span></td><td className="cash-book-description" title={row.description || undefined}>{row.description || "—"}</td><td>{row.reference}</td><td className={row.direction === "in" ? "cash-book-in-value" : ""}>{formatMoney(row.amount, row.currency, decimals)}</td><td className="cash-book-strong-value">{formatMoney(row.balance, row.currency, decimals)}</td></tr>; })}</tbody></table></div><footer className="cash-book-pagination"><span>{report.total} transactions</span><div><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} of {report.lastPage}</span><button type="button" disabled={page >= report.lastPage} onClick={() => setPage((value) => value + 1)}>Next</button></div></footer></> : <div className="cash-book-state cash-book-empty">No transactions found for this report.</div>}</section>
  </div>;
}
