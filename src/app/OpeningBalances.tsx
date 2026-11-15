import { useEffect, useState, type FormEvent } from "react";
import axios from "axios";
import { AlertCircle, Banknote, LoaderCircle, Plus, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { formatCurrency, getErrorMessage, getValidationResult, isRecord, numberValue, optionalText, parseId, todayValue } from "@/app/InventoryShared";

interface AccountOption {
  id: number;
  name: string;
  accountType: string;
  currencyId: number;
  currencyCode: string;
  balance: number;
}

interface OpeningBalanceRecord {
  id: number;
  accountId: number;
  accountName: string;
  accountType: string;
  currencyCode: string;
  amount: number;
  openingDate: string;
  notes: string | null;
  creator: string | null;
}

function parseAccount(value: unknown): AccountOption {
  if (!isRecord(value) || !isRecord(value.currency) || typeof value.name !== "string" || typeof value.account_type !== "string" || typeof value.currency.code !== "string") {
    throw new Error("The financial accounts response contains an incomplete record.");
  }
  return {
    id: parseId(value.id, "financial account ID"),
    name: value.name,
    accountType: value.account_type,
    currencyId: parseId(value.currency.id, "currency ID"),
    currencyCode: value.currency.code.toUpperCase(),
    balance: numberValue(value.current_balance, "account balance"),
  };
}

function parseOpeningBalance(value: unknown): OpeningBalanceRecord {
  if (!isRecord(value) || !isRecord(value.financial_account) || !isRecord(value.financial_account.currency) || typeof value.opening_date !== "string") {
    throw new Error("The opening balance history contains an incomplete record.");
  }
  const account = value.financial_account;
  const currency = account.currency;
  const currencyCode = isRecord(currency) && typeof currency.code === "string" ? currency.code.toUpperCase() : "—";
  return {
    id: parseId(value.id, "opening balance ID"),
    accountId: parseId(account.id, "financial account ID"),
    accountName: typeof account.name === "string" ? account.name : "Financial account",
    accountType: typeof account.account_type === "string" ? account.account_type : "—",
    currencyCode,
    amount: numberValue(value.amount, "opening balance amount"),
    openingDate: value.opening_date.slice(0, 10),
    notes: optionalText(value.notes),
    creator: isRecord(value.creator) ? optionalText(value.creator.name) : null,
  };
}

function formatDate(value: string): string {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(parsed);
}

export default function OpeningBalances() {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [records, setRecords] = useState<OpeningBalanceRecord[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [openingDate, setOpeningDate] = useState(todayValue);
  const [notes, setNotes] = useState("");
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setAccountsLoading(true); setHistoryLoading(true); setAccountsError(null); setHistoryError(null);
    void api.get<unknown>("/api/financial-accounts/balances", { signal: controller.signal })
      .then(({ data }) => {
        if (!isRecord(data) || !Array.isArray(data.data)) throw new Error("The financial accounts response is incomplete.");
        setAccounts(data.data.map(parseAccount));
      })
      .catch((error: unknown) => { if (!controller.signal.aborted) { setAccounts([]); setAccountsError(getErrorMessage(error)); } })
      .finally(() => { if (!controller.signal.aborted) setAccountsLoading(false); });
    void api.get<unknown>("/api/opening-balances", { signal: controller.signal })
      .then(({ data }) => {
        if (!isRecord(data) || !Array.isArray(data.data)) throw new Error("The opening balance history response is incomplete.");
        setRecords(data.data.map(parseOpeningBalance));
      })
      .catch((error: unknown) => { if (!controller.signal.aborted) { setRecords([]); setHistoryError(getErrorMessage(error)); } })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [retry]);

  const selectedAccount = accounts.find((account) => String(account.id) === selectedAccountId);
  const knownDuplicate = records.some((record) => record.accountId === Number(selectedAccountId) && record.openingDate === openingDate);

  function clearFieldError(field: string) {
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setFormError(null); setSuccess(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const nextErrors: Record<string, string> = {};
    if (!selectedAccountId) nextErrors.financial_account_id = "Select a financial account.";
    if (!amount.trim()) nextErrors.amount = "Opening amount is required.";
    else if (!Number.isFinite(Number(amount)) || Number(amount) < 0) nextErrors.amount = "Enter a numeric amount of zero or more.";
    if (!openingDate || !/^\d{4}-\d{2}-\d{2}$/.test(openingDate) || Number.isNaN(new Date(`${openingDate}T00:00:00`).getTime())) nextErrors.opening_date = "Select a valid opening date.";
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) { setFormError("Check the highlighted fields."); return; }
    if (knownDuplicate) { setFormError("An opening balance already exists for this account and date."); return; }

    setSaving(true); setFormError(null); setSuccess(null);
    try {
      await api.post("/api/opening-balances", {
        financial_account_id: Number(selectedAccountId),
        amount: amount.trim(),
        opening_date: openingDate,
        notes: notes.trim() || null,
      });
      setSuccess("Opening balance recorded successfully.");
      setSelectedAccountId(""); setAmount(""); setOpeningDate(todayValue()); setNotes(""); setFieldErrors({});
      setRetry((value) => value + 1);
    } catch (error: unknown) {
      const validation = getValidationResult(error);
      setFieldErrors(validation.fields);
      setFormError(axios.isAxiosError(error) && error.response?.status === 409
        ? "An opening balance already exists for this account and date. Choose a different date or account."
        : validation.message);
    } finally { setSaving(false); }
  }

  return (
    <main className="account-opening-page">
      <header className="account-opening-heading"><div><p className="overview-eyebrow">FINANCE</p><h1>Opening Balances</h1><p>Record starting balances for cash and bank accounts.</p></div></header>
      {success && <p className="account-opening-notice" role="status">{success}</p>}
      {accountsError && <p className="account-opening-notice account-opening-notice--error" role="alert">Could not load financial accounts: {accountsError}</p>}

      <section className="account-opening-panel" aria-labelledby="account-opening-form-title">
        <header className="account-opening-panel-heading"><span><Banknote size={18} /></span><div><h2 id="account-opening-form-title">Record opening balance</h2><p>Opening amounts are kept in the account’s own currency.</p></div></header>
        <form className="account-opening-form" onSubmit={(event) => void submit(event)} noValidate>
          <label><span>Financial account <b>*</b></span><select value={selectedAccountId} disabled={accountsLoading || Boolean(accountsError) || saving} onChange={(event) => { setSelectedAccountId(event.target.value); clearFieldError("financial_account_id"); }} aria-invalid={Boolean(fieldErrors.financial_account_id)}><option value="">{accountsLoading ? "Loading accounts…" : "Select an active account"}</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.accountType} · {account.currencyCode}</option>)}</select>{fieldErrors.financial_account_id && <small>{fieldErrors.financial_account_id}</small>}{!accountsLoading && !accountsError && accounts.length === 0 && <small>No active financial accounts are available.</small>}</label>
          <label><span>Opening amount <b>*</b></span><div className="account-opening-amount"><input type="number" inputMode="decimal" min="0" step="0.0001" value={amount} onChange={(event) => { setAmount(event.target.value); clearFieldError("amount"); }} disabled={saving} aria-invalid={Boolean(fieldErrors.amount)} placeholder="0.00" />{selectedAccount && <strong>{selectedAccount.currencyCode}</strong>}</div>{fieldErrors.amount && <small>{fieldErrors.amount}</small>}</label>
          <label><span>Opening date <b>*</b></span><input type="date" value={openingDate} onChange={(event) => { setOpeningDate(event.target.value); clearFieldError("opening_date"); }} disabled={saving} aria-invalid={Boolean(fieldErrors.opening_date)} />{fieldErrors.opening_date && <small>{fieldErrors.opening_date}</small>}</label>
          <label className="account-opening-field--wide"><span>Notes</span><textarea rows={3} maxLength={5000} value={notes} onChange={(event) => { setNotes(event.target.value); clearFieldError("notes"); }} disabled={saving} placeholder="Optional note" />{fieldErrors.notes && <small>{fieldErrors.notes}</small>}</label>
          {knownDuplicate && <p className="account-opening-duplicate"><AlertCircle size={15} /> An opening balance already exists for this account and date.</p>}
          {formError && <p className="account-opening-form-error" role="alert">{formError}</p>}
          <footer className="account-opening-form-actions"><span>{selectedAccount ? `Amount will be recorded in ${selectedAccount.currencyCode}.` : "Each account can have one opening balance per date."}</span><button type="submit" disabled={saving || accountsLoading || historyLoading || Boolean(accountsError || historyError) || !accounts.length || knownDuplicate}>{saving ? <><LoaderCircle className="account-opening-spin" size={16} /> Saving…</> : <><Plus size={16} /> Record opening balance</>}</button></footer>
        </form>
      </section>

      <section className="account-opening-panel account-opening-history" aria-labelledby="account-opening-history-title">
        <header className="account-opening-panel-heading"><span><Banknote size={18} /></span><div><h2 id="account-opening-history-title">Opening balance history</h2><p>{historyLoading ? "Loading records…" : `${records.length} recorded balance${records.length === 1 ? "" : "s"}`}</p></div><button type="button" className="account-opening-refresh" aria-label="Refresh opening balances and account balances" onClick={() => setRetry((value) => value + 1)} disabled={historyLoading || accountsLoading}><RefreshCw size={16} /></button></header>
        {historyLoading ? <div className="account-opening-state" role="status"><LoaderCircle className="account-opening-spin" size={18} /> Loading opening balance history…</div>
          : historyError ? <div className="account-opening-state account-opening-state--error" role="alert">{historyError}<button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div>
          : records.length === 0 ? <div className="account-opening-state account-opening-state--empty"><strong>No opening balances recorded</strong><span>Recorded account opening balances will appear here.</span></div>
          : <div className="account-opening-table-wrap"><table className="account-opening-table"><thead><tr><th>Opening date</th><th>Account</th><th>Type</th><th>Currency</th><th>Amount</th><th>Notes</th><th>Created by</th></tr></thead><tbody>{records.map((record) => <tr key={record.id}><td>{formatDate(record.openingDate)}</td><td><strong>{record.accountName}</strong></td><td>{record.accountType}</td><td><span className="account-opening-currency">{record.currencyCode}</span></td><td><strong>{formatCurrency(record.amount, record.currencyCode)}</strong></td><td>{record.notes || "—"}</td><td>{record.creator || "—"}</td></tr>)}</tbody></table></div>}
      </section>
    </main>
  );
}
