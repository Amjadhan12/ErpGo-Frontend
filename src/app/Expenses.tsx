import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Eye, Plus, RefreshCw, X } from "lucide-react";
import { api } from "@/lib/api";
import {
  fetchAllPages,
  getErrorMessage,
  getValidationResult,
  isRecord,
  numberValue,
  optionalText,
  parseId,
  parseLaravelPage,
  todayValue,
  type LaravelPage,
} from "@/app/InventoryShared";
import { useLocale } from "@/lib/locale";

interface CategoryOption { id: number; name: string; active: boolean }
interface CurrencyOption { id: number; code: string; name: string; active: boolean }
interface AccountOption { id: number; name: string; currencyId: number; currencyCode: string; balance: number }
interface Expense {
  id: number;
  expenseNumber: string;
  expenseDate: string;
  category: string;
  account: string;
  currency: string;
  amount: number;
  exchangeRate: number;
  description: string | null;
  creator: string | null;
}

type Translate = (text: string) => string;
type Language = "en" | "ps";

function formatExpenseCurrency(value: number, currency: string, language: Language): string {
  return `${currency} ${new Intl.NumberFormat(language === "ps" ? "ps-AF" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value)}`;
}

function formatExpenseNumber(value: number, language: Language): string {
  return new Intl.NumberFormat(language === "ps" ? "ps-AF" : "en-US", { maximumFractionDigits: 8 }).format(value);
}

function formatExpenseDate(value: string, language: Language): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(language === "ps" ? "ps-AF" : "en-US", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function localizeMessage(message: string, t: Translate, language: "en" | "ps"): string {
  const translated = t(message);
  return translated !== message || language === "en"
    ? translated
    : t("The expense request could not be completed. Please try again.");
}

function localizeValidation(message: string, t: Translate, language: "en" | "ps"): string {
  const translated = t(message);
  if (translated !== message || language === "en") return translated;
  if (/required/i.test(message)) return t("This field is required.");
  if (/must be.*number|numeric/i.test(message)) return t("Enter a valid number.");
  if (/must be greater than 0|positive/i.test(message)) return t("Enter a value greater than zero.");
  if (/selected .* is invalid|does not exist/i.test(message)) return t("Choose a valid option.");
  if (/must be a date|valid date/i.test(message)) return t("Enter a valid date.");
  return t("Please check this field and try again.");
}

function parseCategory(value: unknown): CategoryOption {
  if (!isRecord(value) || typeof value.name !== "string") throw new Error("The expense category list contains an incomplete record.");
  return { id: parseId(value.id, "expense category ID"), name: value.name, active: value.is_active === true };
}
function parseCurrency(value: unknown): CurrencyOption {
  if (!isRecord(value) || typeof value.code !== "string" || typeof value.name !== "string") throw new Error("The currency list contains an incomplete record.");
  return { id: parseId(value.id, "currency ID"), code: value.code, name: value.name, active: value.is_active === true };
}
function parseAccount(value: unknown, t: Translate): AccountOption {
  if (!isRecord(value) || !isRecord(value.currency)) throw new Error("The financial account list contains an incomplete record.");
  return { id: parseId(value.id, "financial account ID"), name: typeof value.name === "string" ? value.name : t("Account"), currencyId: parseId(value.currency.id, "account currency ID"), currencyCode: typeof value.currency.code === "string" ? value.currency.code : "", balance: numberValue(value.current_balance, "account balance") };
}
function relationName(value: unknown, field: string): string {
  return isRecord(value) && typeof value[field] === "string" ? value[field] as string : "";
}
function parseExpense(value: unknown, t: Translate): Expense {
  if (!isRecord(value)) throw new Error("The expense response contains an invalid record.");
  const currency = relationName(value.currency, "code");
  if (typeof value.expense_number !== "string" || typeof value.expense_date !== "string" || !currency) throw new Error("The expense response is missing its reference, date, or currency.");
  return {
    id: parseId(value.id, "expense ID"),
    expenseNumber: value.expense_number,
    expenseDate: value.expense_date.slice(0, 10),
    category: relationName(value.category, "name") || t("Expense category"),
    account: relationName(value.financial_account, "name") || t("Financial account"),
    currency,
    amount: numberValue(value.amount, "expense amount"),
    exchangeRate: numberValue(value.exchange_rate_to_afn, "exchange rate"),
    description: optionalText(value.description),
    creator: isRecord(value.creator) ? optionalText(value.creator.name) : null,
  };
}
function makeExpenseNumber(): string {
  return `EXP-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;
}

export default function Expenses() {
  const { direction, language, t } = useLocale();
  const location = useLocation();
  const navigate = useNavigate();
  const isCreate = location.pathname.endsWith("/create");
  const [rows, setRows] = useState<LaravelPage<Expense> | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [listRetry, setListRetry] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Expense | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRetry, setDetailRetry] = useState(0);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [expenseNumber, setExpenseNumber] = useState(makeExpenseNumber);
  const [categoryId, setCategoryId] = useState("");
  const [currencyId, setCurrencyId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayValue);
  const [description, setDescription] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (isCreate || !isRecord(location.state) || typeof location.state.expenseCreated !== "number") return;
    setSuccess(t("Expense recorded successfully."));
    setSelectedId(location.state.expenseCreated);
    navigate(location.pathname, { replace: true, state: null });
  }, [isCreate, location.pathname, location.state, navigate, t]);

  useEffect(() => {
    if (isCreate) return;
    const controller = new AbortController();
    setListLoading(true); setListError(null);
    void api.get<unknown>("/api/expenses", { params: { page: pageNumber }, signal: controller.signal })
      .then(({ data }) => setRows(parseLaravelPage(data, (value) => parseExpense(value, t))))
      .catch((error: unknown) => { if (!controller.signal.aborted) { setListError(localizeMessage(getErrorMessage(error), t, language)); setRows(null); } })
      .finally(() => { if (!controller.signal.aborted) setListLoading(false); });
    return () => controller.abort();
  }, [isCreate, listRetry, pageNumber, t, language]);

  useEffect(() => {
    if (!isCreate) return;
    const controller = new AbortController();
    const signal = controller.signal;
    setOptionsLoading(true); setOptionsError(null);
    void Promise.all([
      fetchAllPages("/api/expense-categories", { per_page: 100 }, parseCategory, signal).then((items) => setCategories(items.filter((item) => item.active))),
      fetchAllPages("/api/currencies", { is_active: "true", per_page: 100 }, parseCurrency, signal).then((items) => setCurrencies(items.filter((item) => item.active))),
      api.get<unknown>("/api/financial-accounts/balances", { signal }).then(({ data }) => {
        if (!isRecord(data) || !Array.isArray(data.data)) throw new Error("The financial account balances response is incomplete.");
        setAccounts(data.data.map((value) => parseAccount(value, t)));
      }),
    ]).catch((error: unknown) => { if (!signal.aborted) setOptionsError(localizeMessage(getErrorMessage(error), t, language)); })
      .finally(() => { if (!signal.aborted) setOptionsLoading(false); });
    return () => controller.abort();
  }, [isCreate, optionsRetry, t, language]);

  useEffect(() => {
    if (!currencyId) {
      setExchangeRate("");
    } else if (currencies.find((item) => String(item.id) === currencyId)?.code.toUpperCase() === "AFN") {
      setExchangeRate("1");
    } else {
      setExchangeRate("");
    }
    setAccountId("");
  }, [currencyId, currencies]);

  useEffect(() => {
    if (selectedId === null) { setDetail(null); return; }
    const controller = new AbortController();
    setDetail(null); setDetailError(null);
    void api.get<unknown>(`/api/expenses/${selectedId}`, { signal: controller.signal })
      .then(({ data }) => {
        if (!isRecord(data) || !isRecord(data.data)) throw new Error("The expense details response is incomplete.");
        setDetail(parseExpense(data.data, t));
      })
      .catch((error: unknown) => { if (!controller.signal.aborted) setDetailError(localizeMessage(getErrorMessage(error), t, language)); });
    return () => controller.abort();
  }, [selectedId, detailRetry, t, language]);

  const selectedCurrency = currencies.find((item) => String(item.id) === currencyId);
  const selectedAccount = accounts.find((item) => String(item.id) === accountId);

  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!expenseNumber.trim()) errors.expense_number = t("Expense number is required.");
    if (!categoryId) errors.expense_category_id = t("Select an expense category.");
    if (!currencyId) errors.currency_id = t("Select a currency.");
    if (!accountId) errors.financial_account_id = t("Select a financial account.");
    else if (selectedAccount && selectedAccount.currencyId !== Number(currencyId)) errors.financial_account_id = t("Account currency must match the expense currency.");
    if (!(Number(amount) > 0)) errors.amount = t("Amount must be greater than zero.");
    if (!(Number(exchangeRate) > 0)) errors.exchange_rate_to_afn = t("Enter a positive exchange rate.");
    else if (selectedCurrency?.code.toUpperCase() === "AFN" && Number(exchangeRate) !== 1) errors.exchange_rate_to_afn = t("The AFN exchange rate must be 1.");
    if (!expenseDate) errors.expense_date = t("Expense date is required.");
    return errors;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const errors = validate();
    setFieldErrors(errors);
    setFormError(Object.keys(errors).length ? t("Review the highlighted fields before saving.") : null);
    if (Object.keys(errors).length) return;
    setSaving(true); setFormError(null);
    try {
      const { data } = await api.post<unknown>("/api/expenses", {
        expense_number: expenseNumber.trim(),
        expense_category_id: Number(categoryId),
        financial_account_id: Number(accountId),
        currency_id: Number(currencyId),
        amount: Number(amount),
        exchange_rate_to_afn: Number(exchangeRate),
        expense_date: expenseDate,
        description: description.trim() || null,
      });
      if (!isRecord(data) || !isRecord(data.data)) throw new Error("The server saved the expense but returned incomplete details.");
      const saved = parseExpense(data.data, t);
      navigate("/secretary/expenses", { replace: true, state: { expenseCreated: saved.id } });
    } catch (error: unknown) {
      const result = getValidationResult(error);
      const translatedFields: Record<string, string> = {};
      for (const [field, message] of Object.entries(result.fields)) {
        translatedFields[field] = localizeValidation(message, t, language);
      }
      setFieldErrors(translatedFields);
      setFormError(Object.values(translatedFields)[0] || localizeMessage(result.message, t, language));
    } finally {
      setSaving(false);
    }
  }

  const numberFormat = new Intl.NumberFormat(language === "ps" ? "ps-AF" : "en-US");
  return (
    <main className="expense-redesign__root" dir={direction} lang={language}>
      <style>{`
        .expense-redesign__root{--er-ink:#182431;--er-muted:#687786;--er-line:#e1e8ed;--er-primary:#126c68;--er-soft:#f4f8f8;color:var(--er-ink);font-family:inherit}
        .expense-redesign__root *{box-sizing:border-box}.expense-redesign__heading{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin:0 0 24px}
        .expense-redesign__eyebrow{margin:0 0 8px;color:var(--er-primary);font-size:11px;font-weight:800;letter-spacing:.11em;text-transform:uppercase}
        .expense-redesign__heading h1{margin:0;font-size:clamp(25px,3vw,34px);line-height:1.2}.expense-redesign__heading p:not(.expense-redesign__eyebrow){margin:8px 0 0;color:var(--er-muted)}
        .expense-redesign__actions,.expense-redesign__form-actions{display:flex;align-items:center;gap:10px}
        .expense-redesign__button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:9px 14px;border:1px solid var(--er-line);border-radius:9px;background:#fff;color:var(--er-ink);font:inherit;font-weight:700;cursor:pointer}
        .expense-redesign__button--primary{border-color:var(--er-primary);background:var(--er-primary);color:#fff}.expense-redesign__button:disabled{opacity:.55;cursor:not-allowed}
        .expense-redesign__card{overflow:hidden;border:1px solid var(--er-line);border-radius:14px;background:#fff;box-shadow:0 5px 20px #18243108}
        .expense-redesign__notice,.expense-redesign__state,.expense-redesign__form-card{margin-bottom:18px;padding:16px;border:1px solid var(--er-line);border-radius:12px;background:#fff}
        .expense-redesign__notice{display:flex;align-items:center;justify-content:space-between;gap:12px}.expense-redesign__notice--success{border-color:#b9ded5;background:#f0faf6;color:#175d4f}.expense-redesign__notice--error,.expense-redesign__field-error{color:#a53636}
        .expense-redesign__form-card{padding:0}.expense-redesign__form-heading,.expense-redesign__list-heading{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:18px 20px;border-bottom:1px solid var(--er-line)}
        .expense-redesign__form-heading h2,.expense-redesign__list-heading h2{margin:0;font-size:18px}.expense-redesign__form-heading p,.expense-redesign__list-heading p{margin:5px 0 0;color:var(--er-muted);font-size:13px}
        .expense-redesign__form{padding:20px}.expense-redesign__section-title{margin:0 0 16px;font-size:16px}.expense-redesign__fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
        .expense-redesign__field{display:flex;min-width:0;flex-direction:column;gap:7px;color:var(--er-ink);font-size:13px;font-weight:700}.expense-redesign__field--wide{grid-column:1/-1}
        .expense-redesign__field input,.expense-redesign__field select,.expense-redesign__field textarea{width:100%;min-height:42px;padding:10px 12px;border:1px solid #d6e0e5;border-radius:8px;background:#fff;color:var(--er-ink);font:inherit;font-weight:400}
        .expense-redesign__field textarea{resize:vertical}.expense-redesign__field input:focus,.expense-redesign__field select:focus,.expense-redesign__field textarea:focus{outline:2px solid #126c6833;border-color:var(--er-primary)}
        .expense-redesign__hint,.expense-redesign__field-error{font-size:12px;font-weight:500}.expense-redesign__hint{color:var(--er-muted)}
        .expense-redesign__balance-note{margin:18px 0 0;padding:12px;border-radius:8px;background:var(--er-soft);color:#4d626a;font-size:13px}
        .expense-redesign__form-actions{justify-content:flex-end;margin-top:18px}.expense-redesign__table-scroll{overflow:auto}
        .expense-redesign__table{width:100%;border-collapse:collapse;text-align:start}.expense-redesign__table th,.expense-redesign__table td{padding:13px 15px;border-bottom:1px solid #edf1f3;text-align:start;white-space:nowrap}
        .expense-redesign__table th{background:#f7f9fa;color:#657481;font-size:11px;letter-spacing:.05em;text-transform:uppercase}.expense-redesign__table tbody tr:last-child td{border-bottom:0}
        .expense-redesign__pagination{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-top:1px solid var(--er-line);color:var(--er-muted);font-size:13px}
        .expense-redesign__pagination-controls{display:flex;align-items:center;gap:10px}.expense-redesign__pagination button{padding:7px 10px;border:1px solid var(--er-line);border-radius:7px;background:white;color:var(--er-ink);font:inherit;cursor:pointer}.expense-redesign__pagination button:disabled{opacity:.5;cursor:not-allowed}
        .expense-redesign__empty{text-align:center;color:var(--er-muted)}.expense-redesign__empty strong,.expense-redesign__empty span{display:block}.expense-redesign__empty strong{margin-bottom:5px;color:var(--er-ink)}
        .expense-redesign__details-button{padding:6px 9px;border:1px solid var(--er-line);border-radius:7px;background:white;color:var(--er-primary);font:inherit;font-weight:700;cursor:pointer}
        .expense-redesign__backdrop{position:fixed;z-index:1000;inset:0;display:grid;place-items:center;padding:20px;background:#11202c88}.expense-redesign__dialog{width:min(700px,100%);max-height:90vh;overflow:auto;border-radius:14px;background:white;box-shadow:0 20px 70px #0003}
        .expense-redesign__dialog-heading{display:flex;align-items:flex-start;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--er-line)}.expense-redesign__dialog-heading h2{margin:0;font-size:20px}
        .expense-redesign__icon-button{width:34px;height:34px;border:1px solid var(--er-line);border-radius:8px;background:white;color:var(--er-ink);font:inherit;font-size:22px;cursor:pointer}
        .expense-redesign__details{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 18px;padding:20px}.expense-redesign__details div{padding:12px 0;border-bottom:1px solid #edf1f3}
        .expense-redesign__details dt{color:var(--er-muted);font-size:12px}.expense-redesign__details dd{margin:5px 0 0;font-weight:700;overflow-wrap:anywhere}
        .expense-redesign__description{margin:0 20px 20px;padding:14px;border-radius:8px;background:var(--er-soft)}.expense-redesign__description h3{margin:0 0 7px;font-size:14px}.expense-redesign__description p{margin:0;white-space:pre-wrap}
        @media(max-width:700px){.expense-redesign__heading{align-items:flex-start;flex-direction:column}.expense-redesign__actions{width:100%}.expense-redesign__actions .expense-redesign__button{flex:1}.expense-redesign__fields{grid-template-columns:1fr}.expense-redesign__field--wide{grid-column:auto}.expense-redesign__pagination{align-items:flex-start;flex-direction:column}.expense-redesign__details{grid-template-columns:1fr}}
      `}</style>
      {isCreate ? (
        <>
          <header className="expense-redesign__heading">
            <div><p className="expense-redesign__eyebrow">{t("Operations / Expenses")}</p><h1>{t("Record Expense")}</h1><p>{t("Record a business expense against an active financial account.")}</p></div>
            <button className="expense-redesign__button" type="button" onClick={() => navigate("/secretary/expenses")}><ArrowLeft size={16} aria-hidden="true" />{t("Back to Expenses")}</button>
          </header>
          {optionsLoading && <div className="expense-redesign__state" role="status">{t("Loading categories, currencies, and financial accounts…")}</div>}
          {optionsError && <div className="expense-redesign__notice expense-redesign__notice--error" role="alert"><span>{optionsError}</span><button className="expense-redesign__button" type="button" onClick={() => setOptionsRetry((value) => value + 1)}>{t("Retry")}</button></div>}
          <section className="expense-redesign__form-card">
            <header className="expense-redesign__form-heading"><div><p className="expense-redesign__eyebrow">{t("New Expense")}</p><h2>{t("Expense information")}</h2><p>{t("Enter the expense and account information below.")}</p></div></header>
            <form className="expense-redesign__form" onSubmit={(event) => void submit(event)} noValidate>
              {formError && <div className="expense-redesign__notice expense-redesign__notice--error" role="alert">{formError}</div>}
              <div className="expense-redesign__fields">
                <ExpenseField t={t} label={t("Expense number")} error={fieldErrors.expense_number}><input required maxLength={50} value={expenseNumber} onChange={(event) => setExpenseNumber(event.target.value)} aria-invalid={Boolean(fieldErrors.expense_number)} /></ExpenseField>
                <ExpenseField t={t} label={t("Expense date")} error={fieldErrors.expense_date}><input required type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} aria-invalid={Boolean(fieldErrors.expense_date)} /></ExpenseField>
                <ExpenseField t={t} label={t("Category")} error={fieldErrors.expense_category_id}><select required value={categoryId} disabled={optionsLoading} onChange={(event) => setCategoryId(event.target.value)} aria-invalid={Boolean(fieldErrors.expense_category_id)}><option value="">{t("Select category")}</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></ExpenseField>
                <ExpenseField t={t} label={t("Currency")} error={fieldErrors.currency_id}><select required value={currencyId} disabled={optionsLoading} onChange={(event) => setCurrencyId(event.target.value)} aria-invalid={Boolean(fieldErrors.currency_id)}><option value="">{t("Select currency")}</option>{currencies.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></ExpenseField>
                <ExpenseField t={t} label={t("Financial account")} error={fieldErrors.financial_account_id} hint={selectedAccount ? `${t("Current balance")}: ${formatExpenseCurrency(selectedAccount.balance, selectedAccount.currencyCode, language)}` : undefined}><select required value={accountId} disabled={optionsLoading || !currencyId} onChange={(event) => setAccountId(event.target.value)} aria-invalid={Boolean(fieldErrors.financial_account_id)}><option value="">{currencyId ? t("Select matching account") : t("Select currency first")}</option>{accounts.filter((item) => item.currencyId === Number(currencyId)).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.currencyCode} · {formatExpenseCurrency(item.balance, item.currencyCode, language)}</option>)}</select></ExpenseField>
                <ExpenseField t={t} label={t("Amount")} error={fieldErrors.amount}><input required type="number" min="0.0001" step="0.0001" value={amount} onChange={(event) => setAmount(event.target.value)} aria-invalid={Boolean(fieldErrors.amount)} /></ExpenseField>
                <ExpenseField t={t} label={t("Exchange rate to AFN")} error={fieldErrors.exchange_rate_to_afn}><input required type="number" min="0.00000001" step="0.00000001" value={exchangeRate} readOnly={selectedCurrency?.code.toUpperCase() === "AFN"} onChange={(event) => setExchangeRate(event.target.value)} aria-invalid={Boolean(fieldErrors.exchange_rate_to_afn)} /></ExpenseField>
                <ExpenseField t={t} label={t("Description / notes")} className="expense-redesign__field--wide"><textarea rows={4} maxLength={5000} value={description} onChange={(event) => setDescription(event.target.value)} /></ExpenseField>
              </div>
              <p className="expense-redesign__balance-note">{t("The server validates available account balance for the selected expense date.")}</p>
              <div className="expense-redesign__form-actions"><button className="expense-redesign__button expense-redesign__button--primary" type="submit" disabled={saving || optionsLoading || Boolean(optionsError)}>{saving ? t("Saving expense…") : t("Record Expense")}</button></div>
            </form>
          </section>
        </>
      ) : (
        <>
          <header className="expense-redesign__heading">
            <div><p className="expense-redesign__eyebrow">{t("Operations")}</p><h1>{t("Expenses")}</h1><p>{t("Review recorded expenses and their account details.")}</p></div>
            <div className="expense-redesign__actions"><button className="expense-redesign__button" type="button" disabled={listLoading} onClick={() => setListRetry((value) => value + 1)}><RefreshCw size={15} aria-hidden="true" />{t("Refresh")}</button><button className="expense-redesign__button expense-redesign__button--primary" type="button" onClick={() => navigate("/secretary/expenses/create")}><Plus size={16} aria-hidden="true" />{t("Record Expense")}</button></div>
          </header>
          {success && <p className="expense-redesign__notice expense-redesign__notice--success" role="status">{success}</p>}
          {listLoading ? <section className="expense-redesign__card expense-redesign__state" role="status">{t("Loading expenses…")}</section>
            : listError ? <section className="expense-redesign__card expense-redesign__state expense-redesign__notice--error" role="alert"><span>{listError}</span><button className="expense-redesign__button" type="button" onClick={() => setListRetry((value) => value + 1)}>{t("Try again")}</button></section>
              : rows?.data.length ? <section className="expense-redesign__card" aria-label={t("Expense history")}><header className="expense-redesign__list-heading"><div><h2>{t("Expense history")}</h2><p>{t(rows.total === 1 ? "{count} recorded expense" : "{count} recorded expenses").replace("{count}", numberFormat.format(rows.total))}</p></div></header><div className="expense-redesign__table-scroll"><table className="expense-redesign__table"><thead><tr><th>{t("Expense")}</th><th>{t("Date")}</th><th>{t("Category")}</th><th>{t("Financial account")}</th><th>{t("Amount")}</th><th>{t("Created by")}</th><th>{t("Details")}</th></tr></thead><tbody>{rows.data.map((expense) => <tr key={expense.id}><td><strong>{expense.expenseNumber}</strong></td><td>{formatExpenseDate(expense.expenseDate, language)}</td><td>{expense.category}</td><td>{expense.account}</td><td>{formatExpenseCurrency(expense.amount, expense.currency, language)}</td><td>{expense.creator || "—"}</td><td><button className="expense-redesign__details-button" type="button" onClick={() => setSelectedId(expense.id)}><Eye size={14} aria-hidden="true" /> {t("Details")}</button></td></tr>)}</tbody></table></div><ExpensePagination page={rows} pageNumber={pageNumber} setPage={setPageNumber} t={t} numberFormat={numberFormat} /></section>
                : <section className="expense-redesign__card expense-redesign__state expense-redesign__empty"><strong>{t("No expenses recorded")}</strong><span>{t("Expenses will appear here after they are recorded.")}</span></section>}
          {selectedId !== null && <div className="expense-redesign__backdrop" role="presentation"><section className="expense-redesign__dialog" role="dialog" aria-modal="true" aria-label={t("Expense details")}><header className="expense-redesign__dialog-heading"><div><p className="expense-redesign__eyebrow">{t("Expense details")}</p><h2>{detail?.expenseNumber || t("Loading expense…")}</h2></div><button className="expense-redesign__icon-button" type="button" aria-label={t("Close details")} onClick={() => setSelectedId(null)}><X size={18} aria-hidden="true" /></button></header>{detailError ? <div className="expense-redesign__state expense-redesign__notice--error" role="alert">{detailError}<button className="expense-redesign__button" type="button" onClick={() => setDetailRetry((value) => value + 1)}>{t("Retry")}</button></div>           : detail ? <ExpenseDetails expense={detail} t={t} language={language} /> : <div className="expense-redesign__state" role="status">{t("Loading expense details…")}</div>}</section></div>}
        </>
      )}
    </main>
  );
}

function ExpenseField({ label, error, hint, className = "", children }: { label: string; error?: string; hint?: string; className?: string; children: ReactNode; t?: Translate }) {
  return <label className={`expense-redesign__field ${className}`}><span>{label}</span>{children}{hint && <small className="expense-redesign__hint">{hint}</small>}{error && <small className="expense-redesign__field-error" role="alert">{error}</small>}</label>;
}
function ExpensePagination({ page, pageNumber, setPage, t, numberFormat }: { page: LaravelPage<Expense>; pageNumber: number; setPage: (page: number) => void; t: Translate; numberFormat: Intl.NumberFormat }) {
  return <footer className="expense-redesign__pagination"><span>{t(page.total === 1 ? "{count} expense" : "{count} expenses").replace("{count}", numberFormat.format(page.total))}</span><div className="expense-redesign__pagination-controls"><button type="button" disabled={pageNumber <= 1} onClick={() => setPage(pageNumber - 1)}>{t("Previous")}</button><span>{t("Page {current} of {total}").replace("{current}", numberFormat.format(pageNumber)).replace("{total}", numberFormat.format(page.lastPage))}</span><button type="button" disabled={pageNumber >= page.lastPage} onClick={() => setPage(pageNumber + 1)}>{t("Next")}</button></div></footer>;
}
function ExpenseDetails({ expense, t, language }: { expense: Expense; t: Translate; language: Language }) {
  return <><dl className="expense-redesign__details"><div><dt>{t("Expense number")}</dt><dd>{expense.expenseNumber}</dd></div><div><dt>{t("Expense date")}</dt><dd>{formatExpenseDate(expense.expenseDate, language)}</dd></div><div><dt>{t("Category")}</dt><dd>{expense.category}</dd></div><div><dt>{t("Financial account")}</dt><dd>{expense.account}</dd></div><div><dt>{t("Amount")}</dt><dd>{formatExpenseCurrency(expense.amount, expense.currency, language)}</dd></div><div><dt>{t("Exchange rate to AFN")}</dt><dd>{formatExpenseNumber(expense.exchangeRate, language)}</dd></div>{expense.creator && <div><dt>{t("Recorded by")}</dt><dd>{expense.creator}</dd></div>}</dl>{expense.description && <section className="expense-redesign__description"><h3>{t("Description / notes")}</h3><p>{expense.description}</p></section>}</>;
}
