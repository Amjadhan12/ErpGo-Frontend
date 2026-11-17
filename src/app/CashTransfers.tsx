import { useEffect, useMemo, useState, type FormEvent } from "react";
import axios from "axios";
import { AlertCircle, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Eye, RefreshCw, X } from "lucide-react";
import { api } from "@/lib/api";
import { getErrorMessage, isRecord, numberValue, parseId, parseLaravelPage } from "@/app/InventoryShared";
import { useLocale } from "@/lib/locale";

interface Currency {
  id: number;
  code: string;
  name: string;
  symbol: string;
}

interface Account {
  id: number;
  name: string;
  type: string;
  currency: Currency;
  balance: number;
}

interface CashTransfer {
  id: number;
  number: string;
  fromAccount: Account;
  toAccount: Account;
  currency: Currency;
  amount: number;
  date: string;
  description: string | null;
  creator: string | null;
}

type FieldErrors = Record<string, string>;

function dateInputValue(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function makeTransferNumber(): string {
  const date = dateInputValue().replaceAll("-", "");
  const suffix = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()
    : `${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  return `CT-${date}-${suffix}`;
}

function parseCurrency(value: unknown): Currency {
  if (!isRecord(value) || typeof value.code !== "string") throw new Error("The transfer response contains an incomplete currency.");
  return {
    id: parseId(value.id, "currency ID"),
    code: value.code.toUpperCase(),
    name: typeof value.name === "string" ? value.name : value.code,
    symbol: typeof value.symbol === "string" ? value.symbol : value.code,
  };
}

function parseAccount(value: unknown): Account {
  if (!isRecord(value) || !isRecord(value.currency) || typeof value.name !== "string") throw new Error("The transfer response contains an incomplete account.");
  return {
    id: parseId(value.id, "account ID"),
    name: value.name,
    type: typeof value.account_type === "string" ? value.account_type : "Account",
    currency: parseCurrency(value.currency),
    balance: typeof value.current_balance === "number" || typeof value.current_balance === "string" ? numberValue(value.current_balance, "account balance") : 0,
  };
}

function parseTransfer(value: unknown): CashTransfer {
  if (!isRecord(value) || !isRecord(value.from_account) || !isRecord(value.to_account) || !isRecord(value.currency)) {
    throw new Error("The cash transfer response is incomplete.");
  }
  return {
    id: parseId(value.id, "transfer ID"),
    number: typeof value.transfer_number === "string" ? value.transfer_number : `CT-${String(value.id)}`,
    fromAccount: parseAccount(value.from_account),
    toAccount: parseAccount(value.to_account),
    currency: parseCurrency(value.currency),
    amount: numberValue(value.amount, "transfer amount"),
    date: typeof value.transfer_date === "string" ? value.transfer_date.slice(0, 10) : "",
    description: typeof value.description === "string" && value.description.trim() ? value.description : null,
    creator: isRecord(value.creator) && typeof value.creator.name === "string" ? value.creator.name : null,
  };
}

function validationDetails(error: unknown): { message: string; fields: FieldErrors } {
  const message = getErrorMessage(error);
  const fields: FieldErrors = {};
  if (!axios.isAxiosError(error) || !isRecord(error.response?.data) || !isRecord(error.response.data.errors)) return { message, fields };
  for (const [field, messages] of Object.entries(error.response.data.errors)) {
    if (Array.isArray(messages) && typeof messages[0] === "string") fields[field] = messages[0];
  }
  return { message, fields };
}

function formatMoney(amount: number, currency: Currency): string {
  return `${currency.code} ${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(amount)}`;
}

function formatDate(value: string): string {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export default function CashTransfers() {
  const { direction, t } = useLocale();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [accountsRetry, setAccountsRetry] = useState(0);
  const [transfers, setTransfers] = useState<CashTransfer[]>([]);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [transferNumber, setTransferNumber] = useState(makeTransferNumber);
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [transferDate, setTransferDate] = useState(dateInputValue());
  const [description, setDescription] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState<CashTransfer | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setAccountsLoading(true);
    setAccountsError(null);
    api.get<unknown>("/api/financial-accounts/balances", { signal: controller.signal })
      .then(({ data }) => {
        if (!isRecord(data) || !Array.isArray(data.data)) throw new Error("The financial account list response is incomplete.");
        setAccounts(data.data.map(parseAccount));
      })
      .catch((error: unknown) => { if (!controller.signal.aborted) { setAccounts([]); setAccountsError(getErrorMessage(error)); } })
      .finally(() => { if (!controller.signal.aborted) setAccountsLoading(false); });
    return () => controller.abort();
  }, [accountsRetry]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setListError(null);
    api.get<unknown>("/api/cash-transfers", { params: { page }, signal: controller.signal })
      .then(({ data }) => {
        const result = parseLaravelPage(data, parseTransfer);
        setTransfers(result.data);
        setLastPage(result.lastPage);
        setTotal(result.total);
      })
      .catch((error: unknown) => { if (!controller.signal.aborted) { setTransfers([]); setListError(getErrorMessage(error)); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, retry]);

  const sourceAccount = accounts.find((account) => String(account.id) === fromAccountId);
  const destinationAccounts = useMemo(
    () => accounts.filter((account) => account.id !== sourceAccount?.id && account.currency.id === sourceAccount?.currency.id),
    [accounts, sourceAccount],
  );

  function updateField(field: string, value: string) {
    if (field === "from_account_id") {
      setFromAccountId(value);
      const source = accounts.find((account) => String(account.id) === value);
      if (!source || !accounts.some((account) => String(account.id) === toAccountId && account.currency.id === source.currency.id && account.id !== source.id)) setToAccountId("");
    } else if (field === "to_account_id") setToAccountId(value);
    else if (field === "amount") setAmount(value);
    else if (field === "transfer_date") setTransferDate(value);
    else if (field === "description") setDescription(value);
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setFormError(null);
    setSuccess(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const errors: FieldErrors = {};
    if (!sourceAccount) errors.from_account_id = "Select a source account.";
    const destination = accounts.find((account) => String(account.id) === toAccountId);
    if (!destination) errors.to_account_id = "Select a destination account.";
    if (sourceAccount && destination && sourceAccount.id === destination.id) errors.to_account_id = "Choose a different destination account.";
    if (sourceAccount && destination && sourceAccount.currency.id !== destination.currency.id) errors.to_account_id = "Both accounts must use the same currency.";
    if (!/^\d+(?:\.\d{1,4})?$/.test(amount.trim()) || Number(amount) <= 0) errors.amount = "Enter a positive amount with up to 4 decimal places.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(transferDate) || Number.isNaN(new Date(`${transferDate}T00:00:00`).getTime())) errors.transfer_date = "Enter a valid transfer date.";
    setFieldErrors(errors);
    if (Object.keys(errors).length) { setFormError("Check the highlighted fields."); return; }

    setSaving(true);
    setFormError(null);
    setSuccess(null);
    try {
      const { data } = await api.post<unknown>("/api/cash-transfers", {
        transfer_number: transferNumber,
        from_account_id: sourceAccount!.id,
        to_account_id: destination!.id,
        currency_id: sourceAccount!.currency.id,
        amount: amount.trim(),
        transfer_date: transferDate,
        description: description.trim() || null,
      });
      const message = isRecord(data) && typeof data.message === "string" ? data.message : "Cash transfer created successfully.";
      setSuccess(message);
      setTransferNumber(makeTransferNumber());
      setFromAccountId("");
      setToAccountId("");
      setAmount("");
      setDescription("");
      setPage(1);
      setRetry((value) => value + 1);
      setAccountsRetry((value) => value + 1);
    } catch (error: unknown) {
      const result = validationDetails(error);
      setFieldErrors(result.fields);
      setFormError(result.message);
    } finally {
      setSaving(false);
    }
  }

  async function openDetails(transfer: CashTransfer) {
    setSelectedTransfer(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const { data } = await api.get<unknown>(`/api/cash-transfers/${transfer.id}`);
      if (!isRecord(data) || !isRecord(data.data)) throw new Error("The transfer details response is incomplete.");
      setSelectedTransfer(parseTransfer(data.data));
    } catch (error: unknown) {
      setDetailError(getErrorMessage(error));
      setSelectedTransfer(transfer);
    } finally {
      setDetailLoading(false);
    }
  }

  return <div className="cash-transfers-page" dir={direction}>
    <header className="cash-transfers-heading"><div><p className="cash-transfers-eyebrow">{t("FINANCE")}</p><h1>{t("Cash Transfers")}</h1><p>{t("Move funds between financial accounts in the same currency.")}</p></div><button type="button" className="cash-transfers-refresh" onClick={() => { setRetry((value) => value + 1); setAccountsRetry((value) => value + 1); }} disabled={loading || accountsLoading}><RefreshCw size={16} className={loading || accountsLoading ? "overview-refresh__spinning" : ""} /> {t("Refresh")}</button></header>
    {success && <p className="cash-transfers-success" role="status">{t(success)}</p>}
    {accountsError && <div className="cash-transfers-alert" role="alert"><AlertCircle size={18} />{t(accountsError)}<button type="button" onClick={() => setAccountsRetry((value) => value + 1)}>{t("Reload accounts")}</button></div>}

    <section className="cash-transfers-panel" aria-labelledby="cash-transfer-form-title">
      <header className="cash-transfers-panel-heading"><span><ArrowLeftRight size={18} /></span><div><h2 id="cash-transfer-form-title">{t("Record a transfer")}</h2><p>{t("Transfers reduce one account and increase the other by the same amount.")}</p></div></header>
      {formError && <p className="cash-transfers-form-error" role="alert">{t(formError)}</p>}
      <form className="cash-transfers-form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="cash-transfers-number"><span>{t("Transfer number")}</span><strong>{transferNumber}</strong><small>{t("Generated automatically to prevent duplicate submissions.")}</small></div>
        <label><span>{t("Source account")} <i>*</i></span><select value={fromAccountId} onChange={(event) => updateField("from_account_id", event.target.value)} disabled={saving || accountsLoading || Boolean(accountsError)} aria-invalid={Boolean(fieldErrors.from_account_id)}><option value="">{accountsLoading ? t("Loading accounts…") : t("Select source account")}</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency.code} · {t("Balance")} {formatMoney(account.balance, account.currency)}</option>)}</select>{fieldErrors.from_account_id && <small className="cash-transfers-field-error">{t(fieldErrors.from_account_id)}</small>}</label>
        <label><span>{t("Destination account")} <i>*</i></span><select value={toAccountId} onChange={(event) => updateField("to_account_id", event.target.value)} disabled={saving || !sourceAccount || !destinationAccounts.length} aria-invalid={Boolean(fieldErrors.to_account_id)}><option value="">{t("Select destination account")}</option>{destinationAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency.code}</option>)}</select>{fieldErrors.to_account_id && <small className="cash-transfers-field-error">{t(fieldErrors.to_account_id)}</small>}{sourceAccount && !destinationAccounts.length && <small>{t("No other active account uses {currency}.").replace("{currency}", sourceAccount.currency.code)}</small>}</label>
        <label><span>{t("Amount")} <i>*</i>{sourceAccount && <small> ({sourceAccount.currency.code})</small>}</span><input type="number" inputMode="decimal" min="0.0001" step="0.0001" value={amount} onChange={(event) => updateField("amount", event.target.value)} placeholder="0.00" disabled={saving || !sourceAccount} aria-invalid={Boolean(fieldErrors.amount)} />{fieldErrors.amount && <small className="cash-transfers-field-error">{t(fieldErrors.amount)}</small>}</label>
        <label><span>{t("Transfer date")} <i>*</i></span><input type="date" value={transferDate} onChange={(event) => updateField("transfer_date", event.target.value)} disabled={saving} aria-invalid={Boolean(fieldErrors.transfer_date)} />{fieldErrors.transfer_date && <small className="cash-transfers-field-error">{t(fieldErrors.transfer_date)}</small>}</label>
        <label className="cash-transfers-description"><span>{t("Notes")}</span><textarea rows={2} maxLength={5000} value={description} onChange={(event) => updateField("description", event.target.value)} disabled={saving} placeholder={t("Optional transfer note")} aria-invalid={Boolean(fieldErrors.description)} />{fieldErrors.description && <small className="cash-transfers-field-error">{t(fieldErrors.description)}</small>}</label>
        {sourceAccount && <p className="cash-transfers-currency-note">{t("Currency")}: <strong>{sourceAccount.currency.code}</strong>. {t("Both accounts must use this currency; no conversion is applied.")}</p>}
        <div className="cash-transfers-form-actions"><span>{t("Cash transfers are account movements, not income or expenses.")}</span><button type="submit" className="cash-transfers-submit" disabled={saving || accountsLoading || Boolean(accountsError) || !accounts.length}><ArrowLeftRight size={16} />{t(saving ? "Recording…" : "Record transfer")}</button></div>
      </form>
    </section>

    <section className="cash-transfers-panel" aria-label={t("Cash transfer history")}>
      <div className="cash-transfers-list-heading"><div><h2>{t("Transfer history")}</h2><p>{t("{count} transfers").replace("{count}", total.toLocaleString())}</p></div><button type="button" className="cash-transfers-small-refresh" onClick={() => setRetry((value) => value + 1)} disabled={loading} aria-label={t("Refresh transfer history")}><RefreshCw size={15} /></button></div>
      {loading ? <div className="cash-transfers-state" role="status"><span className="loading-spinner" /> {t("Loading transfers…")}</div> : listError ? <div className="cash-transfers-state cash-transfers-error" role="alert"><AlertCircle size={19} />{t(listError)}<button type="button" onClick={() => setRetry((value) => value + 1)}>{t("Try again")}</button></div> : !transfers.length ? <div className="cash-transfers-state cash-transfers-empty"><span><ArrowLeftRight size={21} /></span><strong>{t("No cash transfers yet")}</strong><small>{t("Recorded transfers will appear here.")}</small></div> : <><div className="cash-transfers-table-scroll"><table className="cash-transfers-table"><thead><tr><th>{t("Date")}</th><th>{t("Transfer")}</th><th>{t("From account")}</th><th>{t("To account")}</th><th>{t("Currency")}</th><th>{t("Amount")}</th><th>{t("Action")}</th></tr></thead><tbody>{transfers.map((transfer) => <tr key={transfer.id}><td>{formatDate(transfer.date)}</td><td><strong>{transfer.number}</strong>{transfer.description && <small>{transfer.description}</small>}</td><td><span className="cash-transfer-account"><ArrowUpRight size={14} />{transfer.fromAccount.name}</span></td><td><span className="cash-transfer-account"><ArrowDownLeft size={14} />{transfer.toAccount.name}</span></td><td><span className="cash-transfer-currency">{transfer.currency.code}</span></td><td><strong>{formatMoney(transfer.amount, transfer.currency)}</strong></td><td><button type="button" className="cash-transfer-view" onClick={() => void openDetails(transfer)} aria-label={t("View transfer {number}").replace("{number}", transfer.number)}><Eye size={15} /> {t("Details")}</button></td></tr>)}</tbody></table></div><footer className="cash-transfers-pagination"><span>{t("Showing {start}–{end} of {total}").replace("{start}", String((page - 1) * 20 + 1)).replace("{end}", String(Math.min(page * 20, total))).replace("{total}", total.toLocaleString())}</span><div><button type="button" onClick={() => setPage((value) => value - 1)} disabled={page <= 1}>{t("Previous")}</button><span>{t("Page")} <strong>{page}</strong> {t("of")} <strong>{lastPage}</strong></span><button type="button" onClick={() => setPage((value) => value + 1)} disabled={page >= lastPage}>{t("Next")}</button></div></footer></>}
    </section>

    {(selectedTransfer || detailLoading || detailError) && <div className="cash-transfer-modal-backdrop" role="presentation"><section className="cash-transfer-modal" role="dialog" aria-modal="true" aria-labelledby="cash-transfer-detail-title"><header><div><p className="cash-transfers-eyebrow">{t("TRANSFER DETAILS")}</p><h2 id="cash-transfer-detail-title">{selectedTransfer?.number ?? t("Cash transfer")}</h2></div><button type="button" onClick={() => { setSelectedTransfer(null); setDetailError(null); }} disabled={detailLoading} aria-label={t("Close transfer details")}><X size={19} /></button></header>{detailLoading ? <div className="cash-transfers-state" role="status"><span className="loading-spinner" /> {t("Loading transfer details…")}</div> : detailError ? <div className="cash-transfers-state cash-transfers-error" role="alert">{t(detailError)}</div> : selectedTransfer && <dl><div><dt>{t("Transfer date")}</dt><dd>{formatDate(selectedTransfer.date)}</dd></div><div><dt>{t("Amount")}</dt><dd>{formatMoney(selectedTransfer.amount, selectedTransfer.currency)}</dd></div><div><dt>{t("From account")}</dt><dd>{selectedTransfer.fromAccount.name}</dd></div><div><dt>{t("To account")}</dt><dd>{selectedTransfer.toAccount.name}</dd></div><div><dt>{t("Currency")}</dt><dd>{selectedTransfer.currency.code}</dd></div><div><dt>{t("Recorded by")}</dt><dd>{selectedTransfer.creator || "—"}</dd></div><div className="cash-transfer-detail-notes"><dt>{t("Notes")}</dt><dd>{selectedTransfer.description || "—"}</dd></div></dl>}</section></div>}
  </div>;
}
