import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Eye, Plus } from "lucide-react";
import { api } from "@/lib/api";
import {
  fetchAllPages,
  formatCurrency,
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

function parseCategory(value: unknown): CategoryOption {
  if (!isRecord(value) || typeof value.name !== "string") throw new Error("The expense category list contains an incomplete record.");
  return { id: parseId(value.id, "expense category ID"), name: value.name, active: value.is_active === true };
}
function parseCurrency(value: unknown): CurrencyOption {
  if (!isRecord(value) || typeof value.code !== "string" || typeof value.name !== "string") throw new Error("The currency list contains an incomplete record.");
  return { id: parseId(value.id, "currency ID"), code: value.code, name: value.name, active: value.is_active === true };
}
function parseAccount(value: unknown): AccountOption {
  if (!isRecord(value) || !isRecord(value.currency)) throw new Error("The financial account list contains an incomplete record.");
  return { id: parseId(value.id, "financial account ID"), name: typeof value.name === "string" ? value.name : "Account", currencyId: parseId(value.currency.id, "account currency ID"), currencyCode: typeof value.currency.code === "string" ? value.currency.code : "", balance: numberValue(value.current_balance, "account balance") };
}
function relationName(value: unknown, field: string): string {
  return isRecord(value) && typeof value[field] === "string" ? value[field] as string : "";
}
function parseExpense(value: unknown): Expense {
  if (!isRecord(value)) throw new Error("The expense response contains an invalid record.");
  const currency = relationName(value.currency, "code");
  if (typeof value.expense_number !== "string" || typeof value.expense_date !== "string" || !currency) throw new Error("The expense response is missing its reference, date, or currency.");
  return {
    id: parseId(value.id, "expense ID"),
    expenseNumber: value.expense_number,
    expenseDate: value.expense_date.slice(0, 10),
    category: relationName(value.category, "name") || "Expense category",
    account: relationName(value.financial_account, "name") || "Financial account",
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
    setSuccess("Expense recorded successfully.");
    setSelectedId(location.state.expenseCreated);
    navigate(location.pathname, { replace: true, state: null });
  }, [isCreate, location.pathname, location.state, navigate]);

  useEffect(() => {
    if (isCreate) return;
    const controller = new AbortController();
    setListLoading(true); setListError(null);
    void api.get<unknown>("/api/expenses", { params: { page: pageNumber }, signal: controller.signal })
      .then(({ data }) => setRows(parseLaravelPage(data, parseExpense)))
      .catch((error: unknown) => { if (!controller.signal.aborted) { setListError(getErrorMessage(error)); setRows(null); } })
      .finally(() => { if (!controller.signal.aborted) setListLoading(false); });
    return () => controller.abort();
  }, [isCreate, listRetry, pageNumber]);

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
        setAccounts(data.data.map(parseAccount));
      }),
    ]).catch((error: unknown) => { if (!signal.aborted) setOptionsError(getErrorMessage(error)); })
      .finally(() => { if (!signal.aborted) setOptionsLoading(false); });
    return () => controller.abort();
  }, [isCreate, optionsRetry]);

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
        setDetail(parseExpense(data.data));
      })
      .catch((error: unknown) => { if (!controller.signal.aborted) setDetailError(getErrorMessage(error)); });
    return () => controller.abort();
  }, [selectedId, detailRetry]);

  const selectedCurrency = currencies.find((item) => String(item.id) === currencyId);
  const selectedAccount = accounts.find((item) => String(item.id) === accountId);

  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!expenseNumber.trim()) errors.expense_number = "Expense number is required.";
    if (!categoryId) errors.expense_category_id = "Select an expense category.";
    if (!currencyId) errors.currency_id = "Select a currency.";
    if (!accountId) errors.financial_account_id = "Select a financial account.";
    else if (selectedAccount && selectedAccount.currencyId !== Number(currencyId)) errors.financial_account_id = "Account currency must match the expense currency.";
    if (!(Number(amount) > 0)) errors.amount = "Amount must be greater than zero.";
    if (!(Number(exchangeRate) > 0)) errors.exchange_rate_to_afn = "Enter a positive exchange rate.";
    else if (selectedCurrency?.code.toUpperCase() === "AFN" && Number(exchangeRate) !== 1) errors.exchange_rate_to_afn = "The AFN exchange rate must be 1.";
    if (!expenseDate) errors.expense_date = "Expense date is required.";
    return errors;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const errors = validate();
    setFieldErrors(errors);
    setFormError(Object.keys(errors).length ? "Review the highlighted fields before saving." : null);
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
      const saved = parseExpense(data.data);
      navigate("/secretary/expenses", { replace: true, state: { expenseCreated: saved.id } });
    } catch (error: unknown) {
      const result = getValidationResult(error);
      setFieldErrors(result.fields);
      setFormError(Object.values(result.fields)[0] || result.message);
    } finally {
      setSaving(false);
    }
  }

  if (isCreate) return <div className="purchases-page expenses-page"><header className="purchases-heading"><div><p className="overview-eyebrow">OPERATIONS</p><h1>Record Expense</h1><p className="overview-heading__description">Record a business expense against an active financial account.</p></div><button className="overview-refresh" type="button" onClick={() => navigate("/secretary/expenses")}><ArrowLeft size={16} />Back to Expenses</button></header>
    {optionsLoading && <div className="purchases-panel purchases-state" role="status">Loading categories, currencies, and financial accounts…</div>}
    {optionsError && <p className="create-purchase-alert" role="alert">{optionsError}<button type="button" onClick={() => setOptionsRetry((value) => value + 1)}>Retry</button></p>}
    <form className="create-purchase-form expense-form" onSubmit={(event) => void submit(event)} noValidate>
      {formError && <p className="create-purchase-alert" role="alert">{formError}</p>}
      <section className="purchase-form-section expense-form-section"><header className="purchase-form-section__heading"><h2>Expense information</h2></header><div className="purchase-form-grid">
        <ExpenseField label="Expense number" error={fieldErrors.expense_number}><input required maxLength={50} value={expenseNumber} onChange={(event) => setExpenseNumber(event.target.value)} /></ExpenseField>
        <ExpenseField label="Expense date" error={fieldErrors.expense_date}><input required type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} /></ExpenseField>
        <ExpenseField label="Category" error={fieldErrors.expense_category_id}><select required value={categoryId} disabled={optionsLoading} onChange={(event) => setCategoryId(event.target.value)}><option value="">Select category</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></ExpenseField>
        <ExpenseField label="Currency" error={fieldErrors.currency_id}><select required value={currencyId} disabled={optionsLoading} onChange={(event) => setCurrencyId(event.target.value)}><option value="">Select currency</option>{currencies.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></ExpenseField>
        <ExpenseField label="Financial account" error={fieldErrors.financial_account_id} hint={selectedAccount ? `Current balance: ${formatCurrency(selectedAccount.balance, selectedAccount.currencyCode)}` : undefined}><select required value={accountId} disabled={optionsLoading || !currencyId} onChange={(event) => setAccountId(event.target.value)}><option value="">{currencyId ? "Select matching account" : "Select currency first"}</option>{accounts.filter((item) => item.currencyId === Number(currencyId)).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.currencyCode} · {formatCurrency(item.balance, item.currencyCode)}</option>)}</select></ExpenseField>
        <ExpenseField label="Amount" error={fieldErrors.amount}><input required type="number" min="0.0001" step="0.0001" value={amount} onChange={(event) => setAmount(event.target.value)} /></ExpenseField>
        <ExpenseField label="Exchange rate to AFN" error={fieldErrors.exchange_rate_to_afn}><input required type="number" min="0.00000001" step="0.00000001" value={exchangeRate} readOnly={selectedCurrency?.code.toUpperCase() === "AFN"} onChange={(event) => setExchangeRate(event.target.value)} /></ExpenseField>
        <ExpenseField label="Description / notes" className="expense-description"><textarea rows={4} maxLength={5000} value={description} onChange={(event) => setDescription(event.target.value)} /></ExpenseField>
      </div><p className="expense-balance-note">The server validates available account balance for the selected expense date.</p><div className="expense-form-actions"><button className="purchase-save-button" type="submit" disabled={saving || optionsLoading || Boolean(optionsError)}>{saving ? "Saving expense…" : "Record Expense"}</button></div></section>
    </form>
  </div>;

  return <div className="purchases-page expenses-page"><header className="purchases-heading"><div><p className="overview-eyebrow">OPERATIONS</p><h1>Expenses</h1><p className="overview-heading__description">Review recorded expenses and their account details.</p></div><div className="expense-page-actions"><button className="overview-refresh" type="button" disabled={listLoading} onClick={() => setListRetry((value) => value + 1)}>Refresh</button><button className="purchase-create-button" type="button" onClick={() => navigate("/secretary/expenses/create")}><Plus size={16} />Record Expense</button></div></header>
    {success && <p className="purchase-success-message" role="status">{success}</p>}
    {listLoading ? <section className="purchases-panel purchases-state" role="status">Loading expenses…</section> : listError ? <section className="purchases-panel purchases-state purchases-state--error" role="alert">{listError}<button className="purchases-retry" type="button" onClick={() => setListRetry((value) => value + 1)}>Try again</button></section> : rows?.data.length ? <section className="purchases-panel expense-list-panel"><div className="purchases-table-scroll"><table className="purchases-table expense-table"><thead><tr><th>Expense</th><th>Date</th><th>Category</th><th>Financial account</th><th>Amount</th><th>Created by</th><th>Details</th></tr></thead><tbody>{rows.data.map((expense) => <tr key={expense.id}><td><strong>{expense.expenseNumber}</strong></td><td>{expense.expenseDate}</td><td>{expense.category}</td><td>{expense.account}</td><td>{formatCurrency(expense.amount, expense.currency)}</td><td>{expense.creator || "—"}</td><td><button className="purchase-view-button" type="button" onClick={() => setSelectedId(expense.id)}><Eye size={14} />Details</button></td></tr>)}</tbody></table></div><ExpensePagination page={rows} pageNumber={pageNumber} setPage={setPageNumber} /></section> : <section className="purchases-panel purchases-state purchases-state--empty"><strong>No expenses recorded</strong><span>Expenses will appear here after they are recorded.</span></section>}
    {selectedId !== null && <div className="purchase-modal-backdrop expense-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedId(null); }}><section className="purchase-modal expense-modal" role="dialog" aria-modal="true" aria-label="Expense details"><header className="purchase-modal__header"><div><p className="overview-eyebrow">EXPENSE DETAILS</p><h2>{detail?.expenseNumber || "Loading expense…"}</h2></div><button className="purchase-modal__close" type="button" aria-label="Close details" onClick={() => setSelectedId(null)}>×</button></header><div className="purchase-modal__body expense-detail-body">{detailError ? <div className="purchases-state purchases-state--error" role="alert">{detailError}<button className="purchases-retry" type="button" onClick={() => setDetailRetry((value) => value + 1)}>Retry</button></div> : detail ? <ExpenseDetails expense={detail} /> : <div className="purchases-state" role="status">Loading expense details…</div>}</div></section></div>}
  </div>;
}

function ExpenseField({ label, error, hint, className = "", children }: { label: string; error?: string; hint?: string; className?: string; children: ReactNode }) {
  return <label className={`purchase-field ${className}`}><span>{label}</span>{children}{hint && <small className="expense-field-hint">{hint}</small>}{error && <small className="expense-field-error" role="alert">{error}</small>}</label>;
}
function ExpensePagination({ page, pageNumber, setPage }: { page: LaravelPage<Expense>; pageNumber: number; setPage: (page: number) => void }) {
  return <footer className="purchases-pagination"><span>{page.total} expenses</span><div className="purchases-pagination__controls"><button type="button" disabled={pageNumber <= 1} onClick={() => setPage(pageNumber - 1)}>Previous</button><span>Page {pageNumber} of {page.lastPage}</span><button type="button" disabled={pageNumber >= page.lastPage} onClick={() => setPage(pageNumber + 1)}>Next</button></div></footer>;
}
function ExpenseDetails({ expense }: { expense: Expense }) {
  return <><dl className="expense-detail-grid"><div><dt>Expense number</dt><dd>{expense.expenseNumber}</dd></div><div><dt>Expense date</dt><dd>{expense.expenseDate}</dd></div><div><dt>Category</dt><dd>{expense.category}</dd></div><div><dt>Financial account</dt><dd>{expense.account}</dd></div><div><dt>Amount</dt><dd>{formatCurrency(expense.amount, expense.currency)}</dd></div><div><dt>Exchange rate to AFN</dt><dd>{expense.exchangeRate}</dd></div>{expense.creator && <div><dt>Recorded by</dt><dd>{expense.creator}</dd></div>}</dl>{expense.description && <section className="expense-description-detail"><h3>Description / notes</h3><p>{expense.description}</p></section>}</>;
}
