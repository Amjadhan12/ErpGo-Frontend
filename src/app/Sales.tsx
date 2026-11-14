import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Eye, Plus, Printer, Trash2 } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { api, getPublicStorageUrl } from "@/lib/api";
import {
  fetchAllPages,
  formatCurrency,
  formatQuantity,
  getErrorMessage,
  getValidationResult,
  isRecord,
  loadProducts,
  loadWarehouses,
  numberValue,
  optionalText,
  parseId,
  parseLaravelPage,
  todayValue,
  type InventoryProductOption,
  type InventoryWarehouseOption,
  type LaravelPage,
} from "@/app/InventoryShared";

interface CustomerOption { id: number; name: string; businessName: string | null; phone: string | null; address: string | null; active: boolean }
interface CurrencyOption { id: number; code: string; name: string; symbol: string; active: boolean }
interface AccountOption { id: number; name: string; currencyId: number; currencyCode: string; balance: number }
interface SaleItem { id: number; productId: number; productName: string; sku: string | null; unit: string; quantity: number; unitPrice: number; discount: number; lineTotal: number; notes: string | null }
interface Sale { id: number; saleNumber: string; invoiceNumber: string | null; saleDate: string; customer: string; customerPhone: string | null; customerEmail: string | null; customerAddress: string | null; warehouse: string; currency: string; subtotal: number; discount: number; grandTotal: number; paymentStatus: string; status: string; notes: string | null; items: SaleItem[]; paidAmount: number }
interface SaleLine { key: number; productId: string; quantity: string; unitPrice: string; discount: string; notes: string }
interface CompanyInfo { name: string; logo: string | null; phone: string | null; address: string | null; billText: string | null }

function parseCustomer(value: unknown): CustomerOption {
  if (!isRecord(value) || typeof value.name !== "string") throw new Error("The customer list contains an incomplete record.");
  return { id: parseId(value.id, "customer ID"), name: value.name, businessName: optionalText(value.business_name), phone: optionalText(value.phone), address: optionalText(value.address), active: value.is_active === true };
}
function parseCurrency(value: unknown): CurrencyOption {
  if (!isRecord(value) || typeof value.code !== "string" || typeof value.name !== "string") throw new Error("The currency list contains an incomplete record.");
  return { id: parseId(value.id, "currency ID"), code: value.code, name: value.name, symbol: typeof value.symbol === "string" ? value.symbol : value.code, active: value.is_active === true };
}
function parseAccount(value: unknown): AccountOption {
  if (!isRecord(value) || !isRecord(value.currency)) throw new Error("The account balances contain an incomplete record.");
  return { id: parseId(value.id, "account ID"), name: typeof value.name === "string" ? value.name : "Account", currencyId: parseId(value.currency.id, "account currency ID"), currencyCode: String(value.currency.code ?? ""), balance: numberValue(value.current_balance, "account balance") };
}
function relationName(value: unknown, fields: string[]): string {
  if (!isRecord(value)) return "";
  for (const field of fields) if (typeof value[field] === "string" && value[field]) return value[field] as string;
  return "";
}
function parseSale(value: unknown): Sale {
  if (!isRecord(value) || !Array.isArray(value.items)) throw new Error("The sale response is incomplete.");
  const currency = relationName(value.currency, ["code"]);
  if (typeof value.sale_number !== "string" || typeof value.sale_date !== "string" || !currency) throw new Error("The sale response is missing invoice information.");
  const items = value.items.map((entry): SaleItem => {
    if (!isRecord(entry)) throw new Error("The sale contains an invalid item.");
    const product = isRecord(entry.product) ? entry.product : {};
    return { id: parseId(entry.id, "sale item ID"), productId: parseId(entry.product_id, "product ID"), productName: typeof product.name === "string" ? product.name : "", sku: optionalText(product.sku), unit: typeof product.unit === "string" ? product.unit : "", quantity: numberValue(entry.quantity, "sale quantity"), unitPrice: numberValue(entry.unit_price, "unit price"), discount: numberValue(entry.discount_amount ?? 0, "item discount"), lineTotal: numberValue(entry.line_total, "line total"), notes: optionalText(entry.notes) };
  });
  const payments = Array.isArray(value.payments) ? value.payments : [];
  const paidAmount = payments.reduce((sum, entry) => sum + (isRecord(entry) ? numberValue(entry.amount, "payment amount") : 0), 0);
  const customer = isRecord(value.customer) ? value.customer : {};
  return { id: parseId(value.id, "sale ID"), saleNumber: value.sale_number, invoiceNumber: optionalText(value.invoice_number), saleDate: value.sale_date.slice(0, 10), customer: relationName(customer, ["business_name", "name"]) || "Customer", customerPhone: optionalText(customer.phone), customerEmail: optionalText(customer.email), customerAddress: optionalText(customer.address), warehouse: relationName(value.warehouse, ["name"]) || "Warehouse", currency, subtotal: numberValue(value.subtotal, "subtotal"), discount: numberValue(value.discount_amount ?? 0, "total discount"), grandTotal: numberValue(value.grand_total, "grand total"), paymentStatus: typeof value.payment_status === "string" ? value.payment_status : "unknown", status: typeof value.status === "string" ? value.status : "unknown", notes: optionalText(value.notes), items, paidAmount };
}
function parseNumeric(value: string): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function round4(value: number): number { return Math.round((value + Number.EPSILON) * 10000) / 10000; }
function dateTimeNumber(prefix: string): string { return `${prefix}-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`; }
function statusText(value: string): string { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }

export default function Sales() {
  const location = useLocation();
  const navigate = useNavigate();
  const { companyBranding } = useAuth();
  const isCreate = location.pathname.endsWith("/create");
  const [page, setPage] = useState<LaravelPage<Sale> | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [listRetry, setListRetry] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Sale | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRetry, setDetailRetry] = useState(0);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [products, setProducts] = useState<InventoryProductOption[]>([]);
  const [warehouses, setWarehouses] = useState<InventoryWarehouseOption[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [company, setCompany] = useState<CompanyInfo>({ name: companyBranding?.titleEn || "", logo: companyBranding?.logoUrl || null, phone: null, address: null, billText: null });
  const [saleNumber, setSaleNumber] = useState(() => dateTimeNumber("SAL"));
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [currencyId, setCurrencyId] = useState("");
  const [saleDate, setSaleDate] = useState(todayValue);
  const [exchangeRate, setExchangeRate] = useState("");
  const [headerDiscount, setHeaderDiscount] = useState("0");
  const [notes, setNotes] = useState("");
  const [paymentType, setPaymentType] = useState<"credit" | "cash" | "partial">("credit");
  const [paidAmount, setPaidAmount] = useState("0");
  const [paymentNumber, setPaymentNumber] = useState(() => dateTimeNumber("PAY"));
  const [accountId, setAccountId] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayValue);
  const [lines, setLines] = useState<SaleLine[]>([{ key: 1, productId: "", quantity: "", unitPrice: "", discount: "0", notes: "" }]);
  const [nextKey, setNextKey] = useState(2);
  const [availableStock, setAvailableStock] = useState<Record<string, number>>({});
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);
  const [stockRetry, setStockRetry] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (isCreate || !isRecord(location.state) || typeof location.state.saleCreated !== "number") return;
    setSuccess("Sale recorded successfully.");
    setSelectedId(location.state.saleCreated);
    navigate(location.pathname, { replace: true, state: null });
  }, [isCreate, location.pathname, location.state, navigate]);

  useEffect(() => {
    if (isCreate) return;
    const controller = new AbortController();
    setListLoading(true); setListError(null);
    void api.get<unknown>("/api/sales", { params: { page: pageNumber }, signal: controller.signal }).then(({ data }) => setPage(parseLaravelPage(data, parseSale))).catch((error: unknown) => { if (!controller.signal.aborted) { setListError(getErrorMessage(error)); setPage(null); } }).finally(() => { if (!controller.signal.aborted) setListLoading(false); });
    return () => controller.abort();
  }, [isCreate, listRetry, pageNumber]);

  useEffect(() => {
    if (!isCreate) return;
    const controller = new AbortController();
    setOptionsLoading(true); setOptionsError(null);
    const signal = controller.signal;
    void Promise.all([
      fetchAllPages("/api/business-partners", { partner_type: "Customer", per_page: 100 }, parseCustomer, signal).then((rows) => rows.filter((row) => row.active)).then(setCustomers),
      loadProducts(signal).then(setProducts),
      loadWarehouses(signal).then(setWarehouses),
      fetchAllPages("/api/currencies", { is_active: "true", per_page: 100 }, parseCurrency, signal).then((rows) => rows.filter((row) => row.active)).then(setCurrencies),
      api.get<unknown>("/api/financial-accounts/balances", { signal }).then(({ data }) => { if (!isRecord(data) || !Array.isArray(data.data)) throw new Error("The financial account response is incomplete."); setAccounts(data.data.map(parseAccount)); }),
    ]).catch((error: unknown) => { if (!signal.aborted) setOptionsError(getErrorMessage(error)); }).finally(() => { if (!signal.aborted) setOptionsLoading(false); });
    return () => controller.abort();
  }, [isCreate, optionsRetry]);

  useEffect(() => {
    const controller = new AbortController();
    void api.get<unknown>("/api/settings", { signal: controller.signal }).then(({ data }) => {
      if (!isRecord(data) || !Array.isArray(data.data) || !isRecord(data.data[0])) return;
      const row = data.data[0];
      setCompany({ name: companyBranding?.titleEn || optionalText(row.title_en) || "", logo: companyBranding?.logoUrl || (typeof row.image_path === "string" && row.image_path ? getPublicStorageUrl(row.image_path) : null), phone: optionalText(row.phone1), address: optionalText(row.address), billText: optionalText(row.bill_text) });
    }).catch(() => undefined);
    return () => controller.abort();
  }, [companyBranding]);

  const currency = currencies.find((row) => String(row.id) === currencyId);
  const selectedAccount = accounts.find((row) => String(row.id) === accountId);
  const lineAmounts = useMemo(() => lines.map((line) => {
    const gross = round4(parseNumeric(line.quantity) * parseNumeric(line.unitPrice));
    const discount = round4(parseNumeric(line.discount));
    return { key: line.key, gross, discount, total: round4(gross - discount) };
  }), [lines]);
  const subtotal = round4(lineAmounts.reduce((sum, row) => sum + row.gross, 0));
  const itemDiscountTotal = round4(lineAmounts.reduce((sum, row) => sum + row.discount, 0));
  const discountValue = round4(parseNumeric(headerDiscount));
  const grandTotal = round4(subtotal - itemDiscountTotal - discountValue);
  const balanceDue = round4(grandTotal - parseNumeric(paidAmount));
  const productKey = lines.map((line) => line.productId).filter(Boolean).sort().join(",");

  useEffect(() => {
    if (!warehouseId || !saleDate || !productKey) { setAvailableStock({}); setStockError(null); setStockLoading(false); return; }
    const controller = new AbortController();
    setStockLoading(true); setStockError(null);
    const ids = [...new Set(productKey.split(","))];
    void Promise.all(ids.map(async (id) => {
      const batches = await fetchAllPages("/api/reports/batch-expiry", { warehouse_id: Number(warehouseId), product_id: Number(id), status: "all", days: 365, per_page: 100 }, (value) => {
        if (!isRecord(value)) throw new Error("The batch report contains an invalid record.");
        return { remaining: numberValue(value.remaining_quantity, "eligible stock"), expiryDate: optionalText(value.expiry_date) };
      }, controller.signal);
      const eligible = batches.filter((batch) => !batch.expiryDate || batch.expiryDate.slice(0, 10) >= saleDate).reduce((sum, batch) => sum + batch.remaining, 0);
      return [id, round4(eligible)] as const;
    })).then((entries) => setAvailableStock(Object.fromEntries(entries))).catch((error: unknown) => { if (!controller.signal.aborted) setStockError(getErrorMessage(error)); }).finally(() => { if (!controller.signal.aborted) setStockLoading(false); });
    return () => controller.abort();
  }, [productKey, saleDate, stockRetry, warehouseId]);

  useEffect(() => {
    if (currency?.code.toUpperCase() === "AFN") setExchangeRate("1");
    setAccountId("");
  }, [currencyId, currency?.code]);
  useEffect(() => { if (paymentType === "cash") setPaidAmount(String(grandTotal > 0 ? grandTotal : 0)); if (paymentType === "credit") setPaidAmount("0"); }, [grandTotal, paymentType]);

  useEffect(() => {
    if (selectedId === null) { setDetail(null); return; }
    const controller = new AbortController();
    setDetail(null); setDetailError(null);
    void api.get<unknown>(`/api/sales/${selectedId}`, { signal: controller.signal }).then(({ data }) => {
      if (!isRecord(data) || !isRecord(data.data)) throw new Error("The sale details response is incomplete.");
      setDetail(parseSale(data.data));
    }).catch((error: unknown) => { if (!controller.signal.aborted) setDetailError(getErrorMessage(error)); });
    return () => controller.abort();
  }, [selectedId, detailRetry]);

  function updateLine(key: number, field: keyof Omit<SaleLine, "key">, value: string) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, [field]: value } : line));
    const errorField = field === "productId" ? "product_id" : field === "unitPrice" ? "unit_price" : field === "discount" ? "discount_amount" : field;
    setFieldErrors((current) => { const next = { ...current }; delete next[`items.${lines.findIndex((line) => line.key === key)}.${errorField}`]; delete next[`items.${lines.findIndex((line) => line.key === key)}.${field}`]; return next; });
    setFormError(null);
  }
  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!saleNumber.trim()) errors.sale_number = "Sale number is required.";
    if (!customerId) errors.business_partner_id = "Select a customer.";
    if (!warehouseId) errors.warehouse_id = "Select a warehouse.";
    if (!currencyId) errors.currency_id = "Select a currency.";
    const rate = Number(exchangeRate);
    if (!Number.isFinite(rate) || rate <= 0) errors.exchange_rate_to_afn = "Enter a positive exchange rate.";
    else if (currency?.code.toUpperCase() === "AFN" && rate !== 1) errors.exchange_rate_to_afn = "The AFN exchange rate must be 1.";
    if (!saleDate) errors.sale_date = "Sale date is required.";
    if (lines.length < 1) errors.items = "Add at least one product.";
    if (new Set(lines.map((line) => line.productId).filter(Boolean)).size !== lines.filter((line) => line.productId).length) errors.items = "A product can only be selected once.";
    lines.forEach((line, index) => {
      const quantity = Number(line.quantity), price = Number(line.unitPrice), discount = Number(line.discount || "0");
      if (!line.productId) errors[`items.${index}.product_id`] = "Select a product.";
      if (!Number.isFinite(quantity) || quantity <= 0) errors[`items.${index}.quantity`] = "Quantity must be greater than zero.";
      if (!Number.isFinite(price) || price < 0) errors[`items.${index}.unit_price`] = "Price must be zero or greater.";
      if (!Number.isFinite(discount) || discount < 0 || discount > round4(quantity * price)) errors[`items.${index}.discount_amount`] = "Discount must be within the item gross amount.";
      const eligible = availableStock[line.productId];
      if (line.productId && Number.isFinite(quantity) && eligible !== undefined && quantity > eligible) errors[`items.${index}.quantity`] = `Only ${formatQuantity(eligible)} eligible units are available.`;
    });
    const itemDiscounts = lines.reduce((sum, line) => sum + parseNumeric(line.discount), 0);
    if (!Number.isFinite(discountValue) || discountValue < 0 || discountValue > round4(subtotal - itemDiscounts)) errors.discount_amount = "Header discount cannot exceed the amount after item discounts.";
    if (grandTotal <= 0) errors.discount_amount = "Sale total must be greater than zero.";
    const paid = Number(paidAmount);
    if (!Number.isFinite(paid) || paid < 0 || paid > grandTotal) errors.paid_amount = "Paid amount must be between zero and the grand total.";
    else if (paymentType === "credit" && paid !== 0) errors.paid_amount = "Credit sales must have a paid amount of zero.";
    else if (paymentType === "cash" && paid !== grandTotal) errors.paid_amount = "Cash sales must be paid in full.";
    else if (paymentType === "partial" && (paid <= 0 || paid >= grandTotal)) errors.paid_amount = "Partial payment must be greater than zero and less than the total.";
    if (paymentType !== "credit") {
      if (!paymentNumber.trim()) errors.payment_number = "Payment number is required.";
      if (!accountId) errors.financial_account_id = "Select a financial account.";
      else if (selectedAccount && selectedAccount.currencyId !== Number(currencyId)) errors.financial_account_id = "Account currency must match sale currency.";
      if (paymentDate < saleDate) errors.payment_date = "Payment date cannot be before the sale date.";
    }
    if (stockError) errors.items = "Resolve the stock availability error before saving.";
    if (stockLoading) errors.items = "Wait for eligible stock to load before saving.";
    return errors;
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (isSaving) return;
    const errors = validate(); setFieldErrors(errors); setFormError(Object.keys(errors).length ? "Review the highlighted fields before saving." : null);
    if (Object.keys(errors).length) return;
    setIsSaving(true); setFormError(null);
    try {
      const { data } = await api.post<unknown>("/api/sales", { sale_number: saleNumber.trim(), business_partner_id: Number(customerId), warehouse_id: Number(warehouseId), currency_id: Number(currencyId), sale_date: saleDate, invoice_number: invoiceNumber.trim() || null, exchange_rate_to_afn: Number(exchangeRate), discount_amount: discountValue, notes: notes.trim() || null, payment_type: paymentType, paid_amount: Number(paidAmount), ...(paymentType !== "credit" ? { payment_number: paymentNumber.trim(), financial_account_id: Number(accountId), payment_date: paymentDate } : {}), items: lines.map((line) => ({ product_id: Number(line.productId), quantity: Number(line.quantity), unit_price: Number(line.unitPrice), discount_amount: Number(line.discount || 0), notes: line.notes.trim() || null })) });
      if (!isRecord(data) || !isRecord(data.data)) throw new Error("The server saved the sale but returned incomplete details.");
      const saved = parseSale(data.data);
      navigate("/secretary/sales", { replace: true, state: { saleCreated: saved.id } });
    } catch (error: unknown) {
      const result = getValidationResult(error);
      const mapped: Record<string, string> = {};
      const fieldMap: Record<string, string> = { sale_number: "sale_number", business_partner_id: "business_partner_id", warehouse_id: "warehouse_id", currency_id: "currency_id", sale_date: "sale_date", invoice_number: "invoice_number", exchange_rate_to_afn: "exchange_rate_to_afn", discount_amount: "discount_amount", payment_type: "payment_type", paid_amount: "paid_amount", payment_number: "payment_number", financial_account_id: "financial_account_id", payment_date: "payment_date" };
      for (const [field, message] of Object.entries(result.fields)) {
        const match = /^items\.(\d+)\.(\w+)$/.exec(field);
        mapped[match ? `items.${match[1]}.${match[2]}` : fieldMap[field] ?? field] = message;
      }
      setFieldErrors(mapped); setFormError(result.fields.items || result.message);
    } finally { setIsSaving(false); }
  }

  function openSale(id: number) { setSelectedId(id); }
  if (isCreate) return <div className="purchases-page sales-page"><header className="purchases-heading"><div><p className="overview-eyebrow">OPERATIONS</p><h1>Create Sale</h1><p className="overview-heading__description">Record a customer sale and initial payment.</p></div><button className="overview-refresh" type="button" onClick={() => navigate("/secretary/sales")}><ArrowLeft size={16} />Back to Sales</button></header>
    {optionsError && <p className="create-purchase-alert" role="alert">{optionsError} <button type="button" onClick={() => setOptionsRetry((value) => value + 1)}>Retry</button></p>}
    {stockError && <p className="create-purchase-alert" role="alert">Eligible stock could not be checked: {stockError} <button type="button" onClick={() => setStockRetry((value) => value + 1)}>Retry stock check</button></p>}
    <form className="create-purchase-form" onSubmit={(event) => void submit(event)} noValidate>
      {formError && <p className="create-purchase-alert" role="alert">{formError}</p>}
      <div className="create-purchase-main"><section className="purchase-form-section"><header className="purchase-form-section__heading"><h2>Sale Information</h2></header><div className="purchase-form-grid">
        <Field label="Sale number" error={fieldErrors.sale_number}><input required value={saleNumber} onChange={(e) => setSaleNumber(e.target.value)} /></Field>
        <Field label="Invoice number" error={fieldErrors.invoice_number}><input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} /></Field>
        <Field label="Customer" error={fieldErrors.business_partner_id}><select required value={customerId} disabled={optionsLoading} onChange={(e) => setCustomerId(e.target.value)}><option value="">Select customer</option>{customers.map((row) => <option key={row.id} value={row.id}>{row.businessName || row.name}{row.phone ? ` · ${row.phone}` : ""}</option>)}</select></Field>
        <Field label="Warehouse" error={fieldErrors.warehouse_id}><select required value={warehouseId} disabled={optionsLoading} onChange={(e) => setWarehouseId(e.target.value)}><option value="">Select warehouse</option>{warehouses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
        <Field label="Sale date" error={fieldErrors.sale_date}><input required type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} /></Field>
        <Field label="Currency" error={fieldErrors.currency_id}><select required value={currencyId} disabled={optionsLoading} onChange={(e) => setCurrencyId(e.target.value)}><option value="">Select currency</option>{currencies.map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></Field>
        <Field label="Exchange rate to AFN" error={fieldErrors.exchange_rate_to_afn}><input required type="number" min="0.00000001" step="0.00000001" value={exchangeRate} readOnly={currency?.code.toUpperCase() === "AFN"} onChange={(e) => setExchangeRate(e.target.value)} /></Field>
        <Field label="Header discount" error={fieldErrors.discount_amount}><input type="number" min="0" step="0.0001" value={headerDiscount} onChange={(e) => setHeaderDiscount(e.target.value)} /></Field>
        <Field label="Notes"><textarea value={notes} rows={2} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div></section>
      <section className="purchase-form-section"><header className="purchase-form-section__heading"><h2>Items</h2><button className="purchase-add-item" type="button" onClick={() => { setLines((current) => [...current, { key: nextKey, productId: "", quantity: "", unitPrice: "", discount: "0", notes: "" }]); setNextKey((key) => key + 1); }}><Plus size={15} />Add item</button></header>
        <div className="sales-line-list">{lines.map((line, index) => { const available = availableStock[line.productId]; const amount = lineAmounts.find((item) => item.key === line.key); return <div className="sales-line" key={line.key}>
          <Field label="Product" error={fieldErrors[`items.${index}.product_id`]}><select value={line.productId} disabled={optionsLoading} onChange={(e) => updateLine(line.key, "productId", e.target.value)}><option value="">Select product</option>{products.map((row) => <option key={row.id} value={row.id}>{row.name}{row.sku ? ` · ${row.sku}` : ""}</option>)}</select>{line.productId && <small>{!warehouseId ? "Select a warehouse to check stock" : stockLoading ? "Checking eligible stock…" : stockError ? "Stock could not be checked" : `Eligible stock: ${formatQuantity(available ?? 0)}`}</small>}</Field>
          <Field label="Quantity" error={fieldErrors[`items.${index}.quantity`]}><input type="number" min="0.0001" max={available} step="0.0001" value={line.quantity} onChange={(e) => updateLine(line.key, "quantity", e.target.value)} /></Field>
          <Field label="Unit price" error={fieldErrors[`items.${index}.unit_price`]}><input type="number" min="0" step="0.0001" value={line.unitPrice} onChange={(e) => updateLine(line.key, "unitPrice", e.target.value)} /></Field>
          <Field label="Item discount" error={fieldErrors[`items.${index}.discount_amount`]}><input type="number" min="0" step="0.0001" value={line.discount} onChange={(e) => updateLine(line.key, "discount", e.target.value)} /></Field>
          <p className="sales-line-total">Line gross {formatCurrency(amount?.gross ?? 0, currency?.code || "")}</p><button className="sales-remove-line" type="button" aria-label="Remove item" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}><Trash2 size={16} /></button>
        </div>; })}</div>
      </section>
      <section className="purchase-form-section"><header className="purchase-form-section__heading"><h2>Payment</h2></header><div className="purchase-form-grid">
        <Field label="Payment type" error={fieldErrors.payment_type}><select value={paymentType} onChange={(e) => setPaymentType(e.target.value as typeof paymentType)}><option value="credit">Credit</option><option value="partial">Partial</option><option value="cash">Cash</option></select></Field>
        <Field label="Paid amount" error={fieldErrors.paid_amount}><input type="number" min="0" step="0.0001" value={paidAmount} readOnly={paymentType === "credit" || paymentType === "cash"} onChange={(e) => setPaidAmount(e.target.value)} /></Field>
        {paymentType !== "credit" && <>
          <Field label="Payment number" error={fieldErrors.payment_number}><input value={paymentNumber} onChange={(e) => setPaymentNumber(e.target.value)} /></Field>
          <Field label="Financial account" error={fieldErrors.financial_account_id}><select value={accountId} disabled={optionsLoading} onChange={(e) => setAccountId(e.target.value)}><option value="">Select account matching currency</option>{accounts.filter((row) => row.currencyId === Number(currencyId)).map((row) => <option key={row.id} value={row.id}>{row.name} · {row.currencyCode} · {formatCurrency(row.balance, row.currencyCode)}</option>)}</select></Field>
          <Field label="Payment date" error={fieldErrors.payment_date}><input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} /></Field>
        </>}
      </div></section></div>
      <aside className="purchase-summary-panel"><header className="purchase-summary-panel__heading"><h2>Sale Summary</h2></header><dl className="sales-summary"><div><dt>Item gross</dt><dd>{formatCurrency(subtotal, currency?.code || "")}</dd></div><div><dt>Item discounts</dt><dd>− {formatCurrency(itemDiscountTotal, currency?.code || "")}</dd></div><div><dt>Subtotal</dt><dd>{formatCurrency(round4(subtotal - itemDiscountTotal), currency?.code || "")}</dd></div><div><dt>Header discount</dt><dd>− {formatCurrency(discountValue, currency?.code || "")}</dd></div><div className="sales-summary-grand"><dt>Grand total</dt><dd>{formatCurrency(grandTotal, currency?.code || "")}</dd></div><div><dt>Paid</dt><dd>{formatCurrency(parseNumeric(paidAmount), currency?.code || "")}</dd></div><div><dt>Remaining customer balance</dt><dd>{formatCurrency(balanceDue, currency?.code || "")}</dd></div></dl><button className="purchase-save-button" type="submit" disabled={isSaving || optionsLoading || Boolean(optionsError) || stockLoading || Boolean(stockError)}>{isSaving ? "Saving sale…" : "Record Sale"}</button></aside>
    </form>
  </div>;

  return <div className="purchases-page sales-page"><header className="purchases-heading"><div><p className="overview-eyebrow">OPERATIONS</p><h1>Sales</h1><p className="overview-heading__description">Review posted customer sales and print customer bills.</p></div><div className="sales-page-actions"><button className="overview-refresh" type="button" disabled={listLoading} onClick={() => setListRetry((value) => value + 1)}>Refresh</button><button className="purchase-create-button" type="button" onClick={() => navigate("/secretary/sales/create")}><Plus size={16} />Create Sale</button></div></header>
    {success && <p className="purchase-success-message" role="status">{success}</p>}
    {listLoading ? <section className="purchases-panel purchases-state" role="status">Loading sales…</section> : listError ? <section className="purchases-panel purchases-state purchases-state--error" role="alert">{listError}<button className="purchases-retry" type="button" onClick={() => setListRetry((value) => value + 1)}>Try again</button></section> : page?.data.length ? <section className="purchases-panel"><div className="purchases-table-scroll"><table className="purchases-table"><thead><tr><th>Sale number</th><th>Invoice</th><th>Customer</th><th>Warehouse</th><th>Date</th><th>Currency</th><th>Total</th><th>Payment</th><th>Status</th><th>Details</th></tr></thead><tbody>{page.data.map((sale) => <tr key={sale.id}><td><strong>{sale.saleNumber}</strong></td><td>{sale.invoiceNumber || "—"}</td><td>{sale.customer}</td><td>{sale.warehouse}</td><td>{sale.saleDate}</td><td>{sale.currency}</td><td>{formatCurrency(sale.grandTotal, sale.currency)}</td><td>{statusText(sale.paymentStatus)}</td><td>{statusText(sale.status)}</td><td><button className="purchase-view-button" type="button" onClick={() => openSale(sale.id)}><Eye size={14} />Details</button></td></tr>)}</tbody></table></div><Pagination page={page} pageNumber={pageNumber} setPage={setPageNumber} /></section> : <section className="purchases-panel purchases-state purchases-state--empty"><strong>No sales yet</strong><span>Recorded customer sales will appear here.</span></section>}
    {selectedId !== null && <div className="purchase-modal-backdrop sales-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedId(null); }}><section className="purchase-modal sales-modal" role="dialog" aria-modal="true" aria-label="Sale details"><header className="purchase-modal__header sales-modal-header"><div><p className="overview-eyebrow">SALE DETAILS</p><h2>{detail?.saleNumber || "Loading sale…"}</h2></div><div className="sales-modal-actions"><button className="overview-refresh" type="button" disabled={!detail} onClick={() => window.print()}><Printer size={15} />Print Bill</button><button className="purchase-modal__close" type="button" aria-label="Close details" onClick={() => setSelectedId(null)}>×</button></div></header><div className="purchase-modal__body sales-detail-body">{detailError ? <div className="purchases-state purchases-state--error" role="alert">{detailError}<button className="purchases-retry" type="button" onClick={() => setDetailRetry((value) => value + 1)}>Retry</button></div> : detail ? <Invoice sale={detail} company={company} /> : <div className="purchases-state" role="status">Loading sale details…</div>}</div></section></div>}
  </div>;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <label className="purchase-field"><span>{label}</span>{children}{error && <small className="sales-field-error" role="alert">{error}</small>}</label>;
}
function Pagination({ page, pageNumber, setPage }: { page: LaravelPage<Sale>; pageNumber: number; setPage: (page: number) => void }) {
  return <footer className="purchases-pagination"><span>{page.total} sales</span><div className="purchases-pagination__controls"><button type="button" disabled={pageNumber <= 1} onClick={() => setPage(pageNumber - 1)}>Previous</button><span>Page {pageNumber} of {page.lastPage}</span><button type="button" disabled={pageNumber >= page.lastPage} onClick={() => setPage(pageNumber + 1)}>Next</button></div></footer>;
}
function Invoice({ sale, company }: { sale: Sale; company: CompanyInfo }) {
  const balance = round4(sale.grandTotal - sale.paidAmount);
  return <article className="sales-invoice-print"><header className="sales-invoice-company">{company.logo && <img src={company.logo} alt="" /> }<div><h1>{company.name}</h1>{company.phone && <p>{company.phone}</p>}{company.address && <p>{company.address}</p>}</div><strong>CUSTOMER INVOICE</strong></header>
    <dl className="sales-invoice-meta"><div><dt>Invoice number</dt><dd>{sale.invoiceNumber || "—"}</dd></div><div><dt>Sale number</dt><dd>{sale.saleNumber}</dd></div><div><dt>Sale date</dt><dd>{sale.saleDate}</dd></div><div><dt>Customer</dt><dd>{sale.customer}</dd></div>{sale.customerPhone && <div><dt>Customer phone</dt><dd>{sale.customerPhone}</dd></div>}{sale.customerEmail && <div><dt>Customer email</dt><dd>{sale.customerEmail}</dd></div>}{sale.customerAddress && <div><dt>Customer address</dt><dd>{sale.customerAddress}</dd></div>}<div><dt>Warehouse</dt><dd>{sale.warehouse}</dd></div><div><dt>Currency</dt><dd>{sale.currency}</dd></div></dl>
    <div className="purchases-table-scroll"><table className="purchases-table sales-invoice-table"><thead><tr><th>#</th><th>Product</th><th>SKU</th><th>Quantity</th><th>Unit</th><th>Unit price</th><th>Discount</th><th>Line total</th></tr></thead><tbody>{sale.items.map((item, index) => <tr key={item.id}><td>{index + 1}</td><td>{item.productName}</td><td>{item.sku || "—"}</td><td>{formatQuantity(item.quantity)}</td><td>{item.unit || "—"}</td><td>{formatCurrency(item.unitPrice, sale.currency)}</td><td>{formatCurrency(item.discount, sale.currency)}</td><td>{formatCurrency(item.lineTotal, sale.currency)}</td></tr>)}</tbody></table></div>
    <section className="sales-invoice-totals"><dl><div><dt>Subtotal</dt><dd>{formatCurrency(sale.subtotal, sale.currency)}</dd></div><div><dt>Total discount</dt><dd>{formatCurrency(sale.discount, sale.currency)}</dd></div><div className="sales-summary-grand"><dt>Grand total</dt><dd>{formatCurrency(sale.grandTotal, sale.currency)}</dd></div><div><dt>Paid amount</dt><dd>{formatCurrency(sale.paidAmount, sale.currency)}</dd></div><div><dt>Remaining balance</dt><dd>{formatCurrency(balance, sale.currency)}</dd></div><div><dt>Payment status</dt><dd>{statusText(sale.paymentStatus)}</dd></div></dl></section>
    {sale.notes && <p className="sales-invoice-notes"><strong>Notes:</strong> {sale.notes}</p>}{company.billText && <p className="sales-invoice-notes">{company.billText}</p>}
    <footer className="sales-invoice-footer"><p>Thank you for your business.</p><div><span>Customer signature</span><span>Company representative</span></div></footer>
  </article>;
}
