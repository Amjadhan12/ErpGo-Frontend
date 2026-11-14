import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowDownLeft, ArrowUpRight, Building2, CirclePlus, Eye, Landmark, RefreshCw, Wallet, X } from "lucide-react";
import { api } from "@/lib/api";
import { fetchAllPages, getErrorMessage, getValidationResult, isRecord, numberValue, optionalText, parseId } from "@/app/InventoryShared";

type Currency = { id: number; code: string; name: string; symbol: string; decimals: number; active: boolean };
type Account = { id: number; name: string; accountType: string; holderType: string | null; currency: Currency; opening: number; totalIn: number; totalOut: number; balance: number };
type LedgerRow = { id: number; date: string; type: string; direction: "in" | "out"; amount: number; description: string | null; reference: string; balance: number };
type Ledger = { rows: LedgerRow[]; page: number; lastPage: number; total: number; opening: number; totalIn: number; totalOut: number; closing: number; currency: string };

function parseCurrency(value: unknown): Currency {
  if (!isRecord(value) || typeof value.code !== "string" || typeof value.name !== "string") throw new Error("The currency response contains an incomplete record.");
  return { id: parseId(value.id, "currency ID"), code: value.code.toUpperCase(), name: value.name, symbol: typeof value.symbol === "string" ? value.symbol : value.code, decimals: typeof value.decimal_places === "number" ? value.decimal_places : 2, active: value.is_active === true };
}
function parseAccount(value: unknown): Account {
  if (!isRecord(value) || !isRecord(value.currency)) throw new Error("The financial account response contains an incomplete record.");
  return { id: parseId(value.id, "account ID"), name: typeof value.name === "string" ? value.name : "Account", accountType: typeof value.account_type === "string" ? value.account_type : "—", holderType: optionalText(value.holder_type), currency: parseCurrency(value.currency), opening: numberValue(value.opening_balance, "opening balance"), totalIn: numberValue(value.total_in, "incoming total"), totalOut: numberValue(value.total_out, "outgoing total"), balance: numberValue(value.current_balance, "current balance") };
}
function formatMoney(amount: number, code: string, decimals = 2): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: code, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(amount);
}
function parseLedger(value: unknown): Ledger {
  if (!isRecord(value) || !isRecord(value.data) || !isRecord(value.data.transactions) || !Array.isArray(value.data.transactions.data) || !isRecord(value.data.summary)) throw new Error("The account ledger response is incomplete.");
  const summary = value.data.summary;
  const transactions = value.data.transactions;
  const transactionRows = transactions.data as unknown[];
  return {
    rows: transactionRows.map((item): LedgerRow => {
      if (!isRecord(item) || (item.direction !== "in" && item.direction !== "out")) throw new Error("The account ledger contains an invalid transaction.");
      const reference = [optionalText(item.reference_type), item.reference_id === null || item.reference_id === undefined ? null : String(item.reference_id)].filter(Boolean).join(" #");
      return { id: parseId(item.id, "transaction ID"), date: typeof item.transaction_date === "string" ? item.transaction_date : "", type: typeof item.transaction_type === "string" ? item.transaction_type : "Transaction", direction: item.direction, amount: numberValue(item.amount, "transaction amount"), description: optionalText(item.description), reference: reference || (typeof item.transaction_group === "string" ? item.transaction_group : "—"), balance: numberValue(item.running_balance, "running balance") };
    }),
    page: typeof transactions.current_page === "number" ? transactions.current_page : 1,
    lastPage: typeof transactions.last_page === "number" ? transactions.last_page : 1,
    total: typeof transactions.total === "number" ? transactions.total : 0,
    opening: numberValue(summary.opening_balance, "ledger opening balance"), totalIn: numberValue(summary.total_in, "ledger incoming total"), totalOut: numberValue(summary.total_out, "ledger outgoing total"), closing: numberValue(summary.closing_balance, "ledger closing balance"), currency: typeof summary.currency === "string" ? summary.currency : "",
  };
}

export default function FinancialAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [currencyId, setCurrencyId] = useState("");
  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState("cash");
  const [holderType, setHolderType] = useState("company");
  const [location, setLocation] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [selected, setSelected] = useState<Account | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerRetry, setLedgerRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    void Promise.all([
      api.get<unknown>("/api/financial-accounts/balances", { signal: controller.signal }).then(({ data }) => {
        if (!isRecord(data) || !Array.isArray(data.data)) throw new Error("The financial account list response is incomplete.");
        setAccounts(data.data.map(parseAccount));
      }),
      fetchAllPages("/api/currencies", { is_active: "true", per_page: 100 }, parseCurrency, controller.signal).then((result) => setCurrencies(result.filter((item) => item.active))),
    ]).catch((requestError: unknown) => { if (!controller.signal.aborted) setError(getErrorMessage(requestError)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);

  useEffect(() => {
    if (!selected) { setLedger(null); return; }
    const controller = new AbortController();
    setLedgerLoading(true); setLedgerError(null); setLedger(null);
    void api.get<unknown>("/api/reports/financial-account-ledger", { params: { financial_account_id: selected.id, page: ledgerPage, per_page: 10 }, signal: controller.signal })
      .then(({ data }) => setLedger(parseLedger(data)))
      .catch((requestError: unknown) => { if (!controller.signal.aborted) setLedgerError(getErrorMessage(requestError)); })
      .finally(() => { if (!controller.signal.aborted) setLedgerLoading(false); });
    return () => controller.abort();
  }, [selected, ledgerPage, ledgerRetry]);

  const currencyTotals = useMemo(() => {
    const totals = new Map<string, { currency: Currency; balance: number; count: number }>();
    for (const account of accounts) {
      const current = totals.get(account.currency.code) ?? { currency: account.currency, balance: 0, count: 0 };
      current.balance += account.balance; current.count += 1; totals.set(account.currency.code, current);
    }
    return ["AFN", "USD", "PKR"].map((code) => totals.get(code) ?? { currency: currencies.find((item) => item.code === code) ?? { id: 0, code, name: code, symbol: code, decimals: 2, active: true }, balance: 0, count: 0 });
  }, [accounts, currencies]);

  function resetForm() {
    setCurrencyId(""); setName(""); setAccountType("cash"); setHolderType("company"); setLocation(""); setAccountNumber(""); setNotes(""); setIsActive(true); setFieldErrors({}); setFormError(null);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return;
    setSaving(true); setFormError(null); setFieldErrors({}); setSuccess(null);
    try {
      await api.post("/api/financial-accounts", { currency_id: Number(currencyId), name: name.trim(), account_type: accountType, holder_type: holderType || null, location: location.trim() || null, account_number: accountNumber.trim() || null, notes: notes.trim() || null, is_active: isActive });
      setCreating(false); resetForm(); setSuccess("Financial account created."); setRetry((value) => value + 1);
    } catch (requestError) {
      const result = getValidationResult(requestError); setFieldErrors(result.fields); setFormError(result.message);
    } finally { setSaving(false); }
  }

  return <div className="financial-accounts-page">
    <header className="financial-accounts-heading"><div><p className="financial-accounts-eyebrow">FINANCE</p><h1>Financial Accounts</h1><p>Manage cash and bank accounts and review their transaction history.</p></div><button className="financial-primary-button" type="button" onClick={() => { resetForm(); setCreating(true); }}><CirclePlus size={17} /> New account</button></header>
    {success && <div className="financial-notice financial-notice--success" role="status">{success}</div>}
    <section className="financial-currency-grid" aria-label="Balances by currency">{currencyTotals.map(({ currency, balance, count }) => <article className="financial-currency-card" key={currency.code}><span className="financial-currency-icon"><Wallet size={18} /></span><div><span>{currency.code} balance</span><strong>{formatMoney(balance, currency.code, currency.decimals)}</strong><small>{count} {count === 1 ? "account" : "accounts"}</small></div></article>)}</section>
    <section className="financial-account-panel"><div className="financial-section-heading"><div><h2>Accounts</h2><p>{accounts.length} active {accounts.length === 1 ? "account" : "accounts"}</p></div><button className="financial-icon-button" type="button" aria-label="Refresh accounts" onClick={() => setRetry((value) => value + 1)}><RefreshCw size={17} /></button></div>
      {loading ? <div className="financial-state" role="status">Loading financial accounts…</div> : error ? <div className="financial-state financial-state--error" role="alert">{error}<button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div> : accounts.length ? <div className="financial-table-scroll"><table className="financial-table"><thead><tr><th>Account</th><th>Type</th><th>Holder</th><th>Currency</th><th>Current balance</th><th>Status</th><th aria-label="Actions" /></tr></thead><tbody>{accounts.map((account) => <tr key={account.id}><td><strong>{account.name}</strong></td><td><span className={`financial-type-badge financial-type-badge--${account.accountType.toLowerCase()}`}>{account.accountType}</span></td><td>{account.holderType ? account.holderType.replaceAll("_", " ") : "—"}</td><td><span className="financial-currency-tag">{account.currency.code}</span></td><td className="financial-balance">{formatMoney(account.balance, account.currency.code, account.currency.decimals)}</td><td><span className="financial-status-active">Active</span></td><td><button className="financial-details-button" type="button" onClick={() => { setSelected(account); setLedgerPage(1); }}><Eye size={15} /> Ledger</button></td></tr>)}</tbody></table></div> : <div className="financial-state financial-state--empty"><Building2 size={25} /><strong>No active accounts</strong><span>Create an account to start viewing balances and transaction history.</span></div>}
    </section>

    {creating && <div className="financial-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setCreating(false); }}><section className="financial-modal" role="dialog" aria-modal="true" aria-labelledby="financial-create-title"><header className="financial-modal-header"><div><span className="financial-modal-icon"><Landmark size={19} /></span><div><h2 id="financial-create-title">Create financial account</h2><p>Account details and balance currency</p></div></div><button className="financial-icon-button" type="button" aria-label="Close" onClick={() => setCreating(false)} disabled={saving}><X size={18} /></button></header><form onSubmit={submit} noValidate><div className="financial-form-grid">
      <label className="financial-field"><span>Account name <b>*</b></span><input value={name} maxLength={150} onChange={(event) => setName(event.target.value)} required aria-invalid={Boolean(fieldErrors.name)} />{fieldErrors.name && <small>{fieldErrors.name}</small>}</label>
      <label className="financial-field"><span>Currency <b>*</b></span><select value={currencyId} onChange={(event) => setCurrencyId(event.target.value)} required aria-invalid={Boolean(fieldErrors.currency_id)}><option value="">Select currency</option>{currencies.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select>{fieldErrors.currency_id && <small>{fieldErrors.currency_id}</small>}</label>
      <label className="financial-field"><span>Account type <b>*</b></span><select value={accountType} onChange={(event) => setAccountType(event.target.value)} required><option value="cash">Cash</option><option value="bank">Bank</option></select>{fieldErrors.account_type && <small>{fieldErrors.account_type}</small>}</label>
      <label className="financial-field"><span>Holder type</span><select value={holderType} onChange={(event) => setHolderType(event.target.value)}><option value="company">Company</option><option value="individual">Individual</option></select>{fieldErrors.holder_type && <small>{fieldErrors.holder_type}</small>}</label>
      <label className="financial-field"><span>Location</span><input value={location} maxLength={150} onChange={(event) => setLocation(event.target.value)} placeholder="Branch or location" />{fieldErrors.location && <small>{fieldErrors.location}</small>}</label>
      <label className="financial-field"><span>Account number</span><input value={accountNumber} maxLength={100} onChange={(event) => setAccountNumber(event.target.value)} />{fieldErrors.account_number && <small>{fieldErrors.account_number}</small>}</label>
      <label className="financial-field financial-field--wide"><span>Notes</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />{fieldErrors.notes && <small>{fieldErrors.notes}</small>}</label>
      <label className="financial-checkbox"><input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} /> Active account</label>
    </div>{formError && <div className="financial-notice financial-notice--error" role="alert">{formError}</div>}<footer className="financial-modal-actions"><button type="button" className="financial-secondary-button" onClick={() => setCreating(false)} disabled={saving}>Cancel</button><button type="submit" className="financial-primary-button" disabled={saving || currencies.length === 0}>{saving ? "Saving…" : "Create account"}</button></footer></form></section></div>}

    {selected && <div className="financial-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><section className="financial-modal financial-modal--ledger" role="dialog" aria-modal="true" aria-labelledby="financial-ledger-title"><header className="financial-modal-header"><div><span className="financial-modal-icon"><Landmark size={19} /></span><div><h2 id="financial-ledger-title">{selected.name}</h2><p>{selected.accountType} · {selected.currency.code} · Transaction ledger</p></div></div><button className="financial-icon-button" type="button" aria-label="Close" onClick={() => setSelected(null)}><X size={18} /></button></header>
      {ledgerLoading ? <div className="financial-state" role="status">Loading transaction history…</div> : ledgerError ? <div className="financial-state financial-state--error" role="alert">{ledgerError}<button type="button" onClick={() => setLedgerRetry((value) => value + 1)}>Try again</button></div> : ledger ? <><div className="financial-ledger-summary"><div><span>Opening balance</span><strong>{formatMoney(ledger.opening, ledger.currency || selected.currency.code, selected.currency.decimals)}</strong></div><div><span>Money in</span><strong className="financial-positive">{formatMoney(ledger.totalIn, ledger.currency || selected.currency.code, selected.currency.decimals)}</strong></div><div><span>Money out</span><strong>{formatMoney(ledger.totalOut, ledger.currency || selected.currency.code, selected.currency.decimals)}</strong></div><div><span>Closing balance</span><strong>{formatMoney(ledger.closing, ledger.currency || selected.currency.code, selected.currency.decimals)}</strong></div></div>{ledger.rows.length ? <div className="financial-table-scroll"><table className="financial-table financial-ledger-table"><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Direction</th><th>Amount</th><th>Running balance</th></tr></thead><tbody>{ledger.rows.map((row) => <tr key={row.id}><td>{row.date.replace("T", " ").slice(0, 16)}</td><td><strong>{row.type}</strong>{row.description && <small>{row.description}</small>}</td><td>{row.reference}</td><td><span className={`financial-direction financial-direction--${row.direction}`}>{row.direction === "in" ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}{row.direction === "in" ? "In" : "Out"}</span></td><td>{formatMoney(row.amount, ledger.currency || selected.currency.code, selected.currency.decimals)}</td><td className="financial-balance">{formatMoney(row.balance, ledger.currency || selected.currency.code, selected.currency.decimals)}</td></tr>)}</tbody></table></div> : <div className="financial-state financial-state--empty">No transactions recorded for this account.</div>}<footer className="financial-pagination"><span>{ledger.total} transactions</span><div><button type="button" disabled={ledgerPage <= 1} onClick={() => setLedgerPage((page) => page - 1)}>Previous</button><span>Page {ledgerPage} of {ledger.lastPage}</span><button type="button" disabled={ledgerPage >= ledger.lastPage} onClick={() => setLedgerPage((page) => page + 1)}>Next</button></div></footer></> : null}</section></div>}
  </div>;
}
