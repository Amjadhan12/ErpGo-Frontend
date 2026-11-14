import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Boxes, CircleDollarSign, RefreshCw, TrendingUp, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { fetchAllPages, formatQuantity, getErrorMessage, isRecord, loadWarehouses, numberValue, parseId, type InventoryWarehouseOption } from "@/app/InventoryShared";

type Currency = { id: number; code: string; name: string; decimals: number };
type RequestParams = Record<string, string | number | undefined>;
type ReportState<T> = { data: T | null; loading: boolean; error: string | null; retry: number; reload: () => void };
type CurrencyBalance = { currency: string; opening: number; inflow: number; outflow: number; balance: number };
type FinancialSummary = { cash: CurrencyBalance[]; customerReceivables: Record<string, number>; supplierPayables: Record<string, number> };
type ProfitLoss = { currency: string; grossSales: number; salesReturns: number; netRevenue: number; grossCogs: number; returnedCost: number; netCogs: number; expenses: number; wastage: number; grossProfit: number; netProfit: number; expenseCategories: { name: string; amount: number }[] };
type CashFlow = { currency: string; inflow: number; outflow: number; net: number; opening: number; closing: number; transferIn: number; transferOut: number };
type InventoryRow = { id: number; warehouse: string; product: string; sku: string | null; unit: string; quantity: number; valueAfn: number; status: string };
type InventoryReport = { rows: InventoryRow[]; totalValue: number; productCount: number; lowStock: number; outOfStock: number };
type PartnerBalance = { id: number; name: string; partnerType: string; balances: { currency: string; balance: number; balanceType: string }[] };
type PurchaseSummary = { count: number; byCurrency: { code: string; count: number; amount: number }[]; returnsNote: string | null };

function currencyParser(value: unknown): Currency {
  if (!isRecord(value) || typeof value.code !== "string" || typeof value.name !== "string") throw new Error("The currency list contains an incomplete record.");
  return { id: parseId(value.id, "currency ID"), code: value.code.toUpperCase(), name: value.name, decimals: typeof value.decimal_places === "number" ? value.decimal_places : 2 };
}
function parseMoneyMap(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([currency, amount]) => [currency.toUpperCase(), numberValue(amount, "currency balance")]));
}
function parseFinancialSummary(value: unknown): FinancialSummary {
  if (!isRecord(value) || !isRecord(value.data) || !Array.isArray(value.data.cash_bank) || !isRecord(value.data.customers) || !isRecord(value.data.suppliers)) throw new Error("The financial summary response is incomplete.");
  const data = value.data as Record<string, unknown>;
  const customerData = data.customers as Record<string, unknown>;
  const supplierData = data.suppliers as Record<string, unknown>;
  const cashRows = data.cash_bank as unknown[];
  return {
    cash: cashRows.map((item): CurrencyBalance => {
      if (!isRecord(item) || typeof item.currency !== "string") throw new Error("The financial summary contains an invalid currency row.");
      return { currency: item.currency.toUpperCase(), opening: numberValue(item.opening_balance, "opening balance"), inflow: numberValue(item.total_in, "cash inflow"), outflow: numberValue(item.total_out, "cash outflow"), balance: numberValue(item.balance, "cash balance") };
    }),
    customerReceivables: parseMoneyMap(customerData.receivables),
    supplierPayables: parseMoneyMap(supplierData.payables),
  };
}
function parseProfitLoss(value: unknown): ProfitLoss {
  if (!isRecord(value) || !isRecord(value.data) || !isRecord(value.data.revenue) || !isRecord(value.data.cost_of_goods_sold) || !isRecord(value.data.profit)) throw new Error("The Profit & Loss response is incomplete.");
  const data = value.data as Record<string, unknown>;
  const revenue = data.revenue as Record<string, unknown>;
  const cogs = data.cost_of_goods_sold as Record<string, unknown>;
  const profit = data.profit as Record<string, unknown>;
  const expenseCategories = Array.isArray(data.expenses_by_category) ? data.expenses_by_category.map((item) => {
    if (!isRecord(item)) throw new Error("The expense breakdown contains an invalid row.");
    return { name: typeof item.category_name === "string" ? item.category_name : "Other", amount: numberValue(item.total_afn, "expense category total") };
  }) : [];
  return { currency: typeof data.currency === "string" ? data.currency : "AFN", grossSales: numberValue(revenue.gross_sales, "gross sales"), salesReturns: numberValue(revenue.sales_returns, "sales returns"), netRevenue: numberValue(revenue.net_revenue, "net revenue"), grossCogs: numberValue(cogs.total_cost, "cost of goods sold"), returnedCost: numberValue(cogs.returned_goods_cost, "returned goods cost"), netCogs: numberValue(cogs.net_cost, "net cost of goods sold"), expenses: numberValue(profit.operating_expenses, "operating expenses"), wastage: numberValue(profit.stock_wastage_cost, "stock wastage cost"), grossProfit: numberValue(profit.gross_profit, "gross profit"), netProfit: numberValue(profit.net_profit, "net profit"), expenseCategories };
}
function parseCashFlow(value: unknown): CashFlow[] {
  if (!isRecord(value) || !isRecord(value.data) || !Array.isArray(value.data.summary_by_currency)) throw new Error("The cash flow response is incomplete.");
  return value.data.summary_by_currency.map((row): CashFlow => {
    if (!isRecord(row) || typeof row.currency !== "string") throw new Error("The cash flow summary contains an invalid currency row.");
    return { currency: row.currency.toUpperCase(), inflow: numberValue(row.operating_cash_inflow, "cash inflow"), outflow: numberValue(row.operating_cash_outflow, "cash outflow"), net: numberValue(row.net_cash_flow, "net cash flow"), opening: numberValue(row.opening_balance, "opening balance"), closing: numberValue(row.closing_balance, "closing balance"), transferIn: numberValue(row.internal_transfer_in, "transfer in"), transferOut: numberValue(row.internal_transfer_out, "transfer out") };
  });
}
function parseInventory(value: unknown): InventoryReport {
  if (!isRecord(value) || !Array.isArray(value.data) || !isRecord(value.summary)) throw new Error("The inventory report response is incomplete.");
  const rows = value.data.map((item): InventoryRow => {
    if (!isRecord(item) || !isRecord(item.product) || !isRecord(item.warehouse)) throw new Error("The inventory report contains an incomplete row.");
    return { id: parseId(item.id, "inventory row ID"), warehouse: typeof item.warehouse.name === "string" ? item.warehouse.name : "Warehouse", product: typeof item.product.name === "string" ? item.product.name : "Product", sku: typeof item.product.sku === "string" ? item.product.sku : null, unit: typeof item.product.unit === "string" ? item.product.unit : "units", quantity: numberValue(item.quantity, "stock quantity"), valueAfn: numberValue(item.stock_value_afn, "stock value"), status: typeof item.stock_status === "string" ? item.stock_status : "unknown" };
  });
  return { rows, totalValue: numberValue(value.summary.total_stock_value_afn, "total stock value"), productCount: numberValue(value.summary.products_count, "product count"), lowStock: numberValue(value.summary.low_stock_count, "low stock count"), outOfStock: numberValue(value.summary.out_of_stock_count, "out of stock count") };
}
function parsePartners(value: unknown): PartnerBalance[] {
  if (!isRecord(value) || !Array.isArray(value.data)) throw new Error("The partner balances response is incomplete.");
  return value.data.map((item): PartnerBalance => {
    if (!isRecord(item) || !Array.isArray(item.balances)) throw new Error("The partner balances response contains an invalid partner.");
    return { id: parseId(item.id, "partner ID"), name: typeof item.name === "string" ? item.name : "Partner", partnerType: typeof item.partner_type === "string" ? item.partner_type : "Partner", balances: item.balances.map((balance) => {
      if (!isRecord(balance) || typeof balance.currency !== "string") throw new Error("The partner balance row is incomplete.");
      return { currency: balance.currency.toUpperCase(), balance: numberValue(balance.balance, "partner balance"), balanceType: typeof balance.balance_type === "string" ? balance.balance_type : "settled" };
    }) };
  });
}
function parsePurchases(value: unknown): PurchaseSummary {
  if (!isRecord(value) || !isRecord(value.data) || !Array.isArray(value.data.gross_purchases_by_currency)) throw new Error("The purchase summary response is incomplete.");
  return { count: numberValue(value.data.total_purchase_count, "purchase count"), byCurrency: value.data.gross_purchases_by_currency.map((item) => {
    if (!isRecord(item) || typeof item.currency_code !== "string") throw new Error("The purchase summary contains an invalid currency row.");
    return { code: item.currency_code.toUpperCase(), count: numberValue(item.purchase_count, "purchase count"), amount: numberValue(item.gross_purchase_amount, "purchase amount") };
  }), returnsNote: typeof value.data.purchase_returns_note === "string" ? value.data.purchase_returns_note : null };
}

function useReport<T>(url: string, params: RequestParams, parser: (value: unknown) => T): ReportState<T> {
  const paramsKey = JSON.stringify(params);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    void api.get<unknown>(url, { params: JSON.parse(paramsKey) as RequestParams, signal: controller.signal })
      .then(({ data: response }) => setData(parser(response)))
      .catch((requestError: unknown) => { if (!controller.signal.aborted) { setError(getErrorMessage(requestError)); setData(null); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, paramsKey, parser, retry]);
  return { data, loading, error, retry, reload: () => setRetry((value) => value + 1) };
}
function money(amount: number, currency: string): string {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount); }
  catch { return `${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`; }
}
function moneyTick(amount: number): string { return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(amount); }
function SectionState<T>({ report, children }: { report: ReportState<T>; children: (data: T) => React.ReactNode }) {
  if (report.loading) return <div className="reports-state" role="status">Loading report…</div>;
  if (report.error) return <div className="reports-state reports-state--error" role="alert">{report.error}<button type="button" onClick={report.reload}>Try again</button></div>;
  if (!report.data) return <div className="reports-state">No report data available.</div>;
  return <>{children(report.data)}</>;
}
const chartColors = ["#477653", "#83a36f", "#d7a65d", "#6d91b4", "#bd7867", "#9296b7", "#6aa29b"];

export default function Reports() {
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [warehouses, setWarehouses] = useState<InventoryWarehouseOption[]>([]);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [fromDraft, setFromDraft] = useState("");
  const [toDraft, setToDraft] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);
  const [financialCurrency, setFinancialCurrency] = useState("");
  const [cashFlowCurrency, setCashFlowCurrency] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [partnerType, setPartnerType] = useState("");
  const [partnerCurrency, setPartnerCurrency] = useState("");

  useEffect(() => {
    const controller = new AbortController(); const signal = controller.signal;
    void Promise.all([
      fetchAllPages("/api/currencies", { is_active: "true", per_page: 100 }, currencyParser, signal).then(setCurrencies),
      loadWarehouses(signal).then(setWarehouses),
    ]).catch((error: unknown) => { if (!signal.aborted) setOptionsError(getErrorMessage(error)); });
    return () => controller.abort();
  }, []);

  const financial = useReport("/api/reports/financial-summary", { currency_id: financialCurrency ? Number(financialCurrency) : undefined }, parseFinancialSummary);
  const profitLoss = useReport("/api/reports/profit-loss", { from_date: fromDate || undefined, to_date: toDate || undefined }, parseProfitLoss);
  const cashFlow = useReport("/api/reports/cash-flow", { from_date: fromDate || undefined, to_date: toDate || undefined, currency_id: cashFlowCurrency ? Number(cashFlowCurrency) : undefined }, parseCashFlow);
  const inventory = useReport("/api/reports/inventory", { warehouse_id: warehouseId ? Number(warehouseId) : undefined }, parseInventory);
  const partners = useReport("/api/reports/partner-balances", { partner_type: partnerType || undefined }, parsePartners);
  const purchases = useReport("/api/reports/purchase-summary", { from_date: fromDate || undefined, to_date: toDate || undefined }, parsePurchases);

  const partnerCurrencies = useMemo(() => [...new Set((partners.data ?? []).flatMap((partner) => partner.balances.map((balance) => balance.currency)))].sort(), [partners.data]);
  const visiblePartners = useMemo(() => (partners.data ?? []).flatMap((partner) => {
    const balance = partner.balances.find((item) => item.currency === partnerCurrency);
    return balance ? [{ name: partner.name, type: partner.partnerType, balance: balance.balance, balanceType: balance.balanceType }] : [];
  }).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)).slice(0, 15), [partners.data, partnerCurrency]);
  const warehouseValues = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of inventory.data?.rows ?? []) totals.set(row.warehouse, (totals.get(row.warehouse) ?? 0) + row.valueAfn);
    return [...totals].map(([warehouse, value]) => ({ warehouse, value })).filter((row) => row.value > 0).sort((a, b) => b.value - a.value);
  }, [inventory.data]);
  const currencyCode = (id: string) => currencies.find((item) => String(item.id) === id)?.code ?? "AFN";
  const financialCodes = useMemo(() => {
    const codes = new Set(["AFN", "USD", "PKR", ...(financial.data?.cash.map((row) => row.currency) ?? []), ...Object.keys(financial.data?.customerReceivables ?? {}), ...Object.keys(financial.data?.supplierPayables ?? {})]);
    if (financialCurrency) return [currencyCode(financialCurrency)];
    const order = ["AFN", "USD", "PKR"];
    return [...codes].sort((a, b) => {
      const indexA = order.indexOf(a);
      const indexB = order.indexOf(b);
      if (indexA < 0 && indexB < 0) return a.localeCompare(b);
      if (indexA < 0) return 1;
      if (indexB < 0) return -1;
      return indexA - indexB;
    });
  }, [financial.data, financialCurrency, currencies]);

  useEffect(() => {
    if (!partnerCurrency && partnerCurrencies.length > 0) setPartnerCurrency(partnerCurrencies[0]);
  }, [partnerCurrency, partnerCurrencies]);

  function applyDates() {
    if (fromDraft && toDraft && toDraft < fromDraft) { setDateError("To date must be on or after the from date."); return; }
    setDateError(null); setFromDate(fromDraft); setToDate(toDraft);
  }
  function resetDates() { setFromDraft(""); setToDraft(""); setFromDate(""); setToDate(""); setDateError(null); }

  return <div className="reports-page">
    <header className="reports-heading"><div><p className="reports-eyebrow">ANALYTICS</p><h1>Reports</h1><p>Explore financial performance, cash movement, inventory, partners, and purchases.</p></div><button className="reports-refresh" type="button" onClick={() => { financial.reload(); profitLoss.reload(); cashFlow.reload(); inventory.reload(); partners.reload(); purchases.reload(); }}><RefreshCw size={16} /> Refresh reports</button></header>
    <section className="reports-date-filter"><div><strong>Report period</strong><span>Applies only to reports that support date filtering.</span></div><label>From<input type="date" value={fromDraft} max={toDraft || undefined} onChange={(event) => setFromDraft(event.target.value)} /></label><label>To<input type="date" value={toDraft} min={fromDraft || undefined} onChange={(event) => setToDraft(event.target.value)} /></label><div className="reports-filter-buttons"><button type="button" className="reports-reset" onClick={resetDates}>Reset</button><button type="button" className="reports-apply" onClick={applyDates}>Apply period</button></div>{dateError && <span className="reports-date-error" role="alert">{dateError}</span>}</section>
    {optionsError && <div className="reports-options-error" role="alert">Some filter options could not be loaded: {optionsError}</div>}

    <section className="reports-section"><div className="reports-section-heading"><div className="reports-icon"><Wallet size={19} /></div><div><h2>Financial summary</h2><p>Balances grouped by currency. Amounts are never combined across currencies.</p></div><label className="reports-compact-filter">Currency<select value={financialCurrency} onChange={(event) => setFinancialCurrency(event.target.value)}><option value="">All currencies</option>{currencies.map((currency) => <option key={currency.id} value={currency.id}>{currency.code}</option>)}</select></label></div>
      <SectionState report={financial}>{(data) => <><div className="reports-metric-grid">{financialCodes.map((code) => { const cash = data.cash.find((row) => row.currency === code); const receivable = data.customerReceivables[code] ?? 0; const payable = data.supplierPayables[code] ?? 0; return <article className="reports-metric-card" key={code}><span className="reports-currency-label">{code}</span><div><small>Cash & bank</small><strong>{money(cash?.balance ?? 0, code)}</strong></div><div><small>Customer receivables</small><strong>{money(receivable, code)}</strong></div><div><small>Supplier payables</small><strong>{money(payable, code)}</strong></div></article>; })}</div><div className="reports-chart-grid">{financialCodes.map((code) => { const cash = data.cash.find((row) => row.currency === code); const chartData = [{ name: "Cash & bank", amount: cash?.balance ?? 0 }, { name: "Receivables", amount: data.customerReceivables[code] ?? 0 }, { name: "Payables", amount: data.supplierPayables[code] ?? 0 }]; return <div className="reports-chart-card" key={code}><h3>{code} balances</h3><ResponsiveContainer width="100%" height={250}><BarChart data={chartData} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} /><YAxis tickFormatter={moneyTick} tick={{ fontSize: 10 }} /><Tooltip formatter={(value) => money(Number(value), code)} /><Legend /><Bar dataKey="amount" name={`Amount (${code})`} fill="#477653" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div>; })}</div></>}</SectionState>
    </section>

    <section className="reports-section"><div className="reports-section-heading"><div className="reports-icon"><TrendingUp size={19} /></div><div><h2>Profit & Loss</h2><p>Backend report is expressed in AFN and includes sales returns, returned goods, expenses, and wastage.</p></div></div><SectionState report={profitLoss}>{(data) => { const chartData = [{ name: "Net revenue", amount: data.netRevenue }, { name: "Cost of goods", amount: data.netCogs }, { name: "Expenses", amount: data.expenses }, { name: "Stock wastage", amount: data.wastage }, { name: "Net profit", amount: data.netProfit }]; return <><div className="reports-profit-grid"><div className="reports-profit-total"><span>Net profit / loss</span><strong className={data.netProfit < 0 ? "is-negative" : ""}>{money(data.netProfit, data.currency)}</strong><small>Gross profit: {money(data.grossProfit, data.currency)}</small></div><div className="reports-profit-kpis"><div><small>Gross sales</small><strong>{money(data.grossSales, data.currency)}</strong></div><div><small>Sales returns</small><strong>{money(data.salesReturns, data.currency)}</strong></div><div><small>Net revenue</small><strong>{money(data.netRevenue, data.currency)}</strong></div><div><small>Cost of goods sold (net)</small><strong>{money(data.netCogs, data.currency)}</strong></div><div><small>Operating expenses</small><strong>{money(data.expenses, data.currency)}</strong></div><div><small>Stock wastage</small><strong>{money(data.wastage, data.currency)}</strong></div></div></div><div className="reports-chart-card reports-chart-card--wide"><h3>Profit & loss components · {data.currency}</h3><ResponsiveContainer width="100%" height={270}><BarChart data={chartData} margin={{ top: 10, right: 15, left: 5, bottom: 10 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis tickFormatter={moneyTick} tick={{ fontSize: 10 }} /><Tooltip formatter={(value) => money(Number(value), data.currency)} /><Legend /><Bar dataKey="amount" name={data.currency} fill="#668d68" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div>{data.expenseCategories.length > 0 && <div className="reports-category-list"><h3>Expenses by category</h3>{data.expenseCategories.map((category) => <div key={category.name}><span>{category.name}</span><strong>{money(category.amount, data.currency)}</strong></div>)}</div>}</>; }}</SectionState></section>

    <section className="reports-section"><div className="reports-section-heading"><div className="reports-icon"><CircleDollarSign size={19} /></div><div><h2>Cash flow</h2><p>Operating cash flows, excluding internal account transfers from inflow and outflow.</p></div><label className="reports-compact-filter">Currency<select value={cashFlowCurrency} onChange={(event) => setCashFlowCurrency(event.target.value)}><option value="">All currencies</option>{currencies.map((currency) => <option key={currency.id} value={currency.id}>{currency.code}</option>)}</select></label></div><SectionState report={cashFlow}>{(data) => data.length ? <div className="reports-chart-grid">{data.map((row) => { const chartData = [{ name: "Cash inflows", amount: row.inflow }, { name: "Cash outflows", amount: row.outflow }, { name: "Net cash flow", amount: row.net }]; return <div className="reports-chart-card" key={row.currency}><h3>{row.currency} cash movement</h3><div className="reports-cashflow-summary"><span>Opening {money(row.opening, row.currency)}</span><span>Closing {money(row.closing, row.currency)}</span></div><ResponsiveContainer width="100%" height={250}><BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 8 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis tickFormatter={moneyTick} tick={{ fontSize: 10 }} /><Tooltip formatter={(value) => money(Number(value), row.currency)} /><Legend /><Bar dataKey="amount" name={row.currency} fill="#668d68" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer><small className="reports-transfer-note">Internal transfers: +{money(row.transferIn, row.currency)} / −{money(row.transferOut, row.currency)}</small></div>; })}</div> : <div className="reports-empty">No cash flow data for the selected filters.</div>}</SectionState></section>

    <section className="reports-section"><div className="reports-section-heading"><div className="reports-icon"><Boxes size={19} /></div><div><h2>Inventory</h2><p>Stock quantities stay with their product units; stock values are reported in AFN.</p></div><label className="reports-compact-filter">Warehouse<select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}><option value="">All warehouses</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label></div><SectionState report={inventory}>{(data) => <><div className="reports-inventory-metrics"><div><small>Inventory records</small><strong>{data.productCount}</strong></div><div><small>Total stock value</small><strong>{money(data.totalValue, "AFN")}</strong></div><div><small>Low stock</small><strong>{data.lowStock}</strong></div><div><small>Out of stock</small><strong>{data.outOfStock}</strong></div></div>{warehouseValues.length > 0 && <div className="reports-chart-grid reports-inventory-charts"><div className="reports-chart-card"><h3>Stock value by warehouse · AFN</h3><ResponsiveContainer width="100%" height={270}><PieChart><Pie data={warehouseValues} dataKey="value" nameKey="warehouse" cx="50%" cy="50%" outerRadius="72%" label={({ name }) => name}>{warehouseValues.map((item, index) => <Cell key={item.warehouse} fill={chartColors[index % chartColors.length]} />)}</Pie><Tooltip formatter={(value) => money(Number(value), "AFN")} /><Legend /></PieChart></ResponsiveContainer></div><div className="reports-chart-card"><h3>Warehouse stock value · AFN</h3><ResponsiveContainer width="100%" height={270}><BarChart data={warehouseValues} layout="vertical" margin={{ top: 8, right: 22, left: 18, bottom: 8 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tickFormatter={moneyTick} tick={{ fontSize: 10 }} /><YAxis type="category" dataKey="warehouse" width={100} tick={{ fontSize: 10 }} /><Tooltip formatter={(value) => money(Number(value), "AFN")} /><Bar dataKey="value" name="Stock value (AFN)" fill="#668d68" radius={[0, 5, 5, 0]} /></BarChart></ResponsiveContainer></div></div>}{data.rows.length ? <div className="reports-table-wrap"><table className="reports-table"><thead><tr><th>Product</th><th>Warehouse</th><th>Quantity</th><th>Stock value (AFN)</th><th>Status</th></tr></thead><tbody>{data.rows.map((row) => <tr key={row.id}><td><strong>{row.product}</strong>{row.sku && <small>{row.sku}</small>}</td><td>{row.warehouse}</td><td>{formatQuantity(row.quantity)} {row.unit}</td><td>{money(row.valueAfn, "AFN")}</td><td><span className={`reports-stock-status reports-stock-status--${row.status}`}>{row.status.replaceAll("_", " ")}</span></td></tr>)}</tbody></table></div> : <div className="reports-empty">No inventory records match this warehouse.</div>}</>}</SectionState></section>

    <section className="reports-section"><div className="reports-section-heading"><div className="reports-icon"><BarChart3 size={19} /></div><div><h2>Partner balances</h2><p>Customer and supplier balances are compared within one selected currency.</p></div><div className="reports-inline-filters"><label className="reports-compact-filter">Partner type<select value={partnerType} onChange={(event) => setPartnerType(event.target.value)}><option value="">All partners</option><option value="Customer">Customers</option><option value="Supplier">Suppliers</option></select></label><label className="reports-compact-filter">Currency<select value={partnerCurrency} onChange={(event) => setPartnerCurrency(event.target.value)}><option value="">Choose currency</option>{partnerCurrencies.map((code) => <option key={code} value={code}>{code}</option>)}</select></label></div></div><SectionState report={partners}>{() => !partnerCurrencies.length ? <div className="reports-empty">No partner balances are available.</div> : !partnerCurrency ? <div className="reports-empty">Choose a currency to view comparable partner balances.</div> : visiblePartners.length ? <div className="reports-chart-card reports-chart-card--wide"><h3>{partnerCurrency} outstanding balances · up to 15 partners</h3><ResponsiveContainer width="100%" height={Math.max(280, visiblePartners.length * 34)}><BarChart data={visiblePartners} layout="vertical" margin={{ top: 8, right: 24, left: 18, bottom: 8 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tickFormatter={moneyTick} tick={{ fontSize: 10 }} /><YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 10 }} /><Tooltip formatter={(value, _name, item) => [`${money(Number(value), partnerCurrency)} · ${item.payload.type}`, "Balance"]} /><Legend /><Bar dataKey="balance" name={`Balance (${partnerCurrency})`} fill="#668d68" radius={[0, 5, 5, 0]} /></BarChart></ResponsiveContainer><div className="reports-partner-legend"><span>Positive: customer owes us / we owe supplier</span><span>Negative: customer credit / supplier owes us</span></div></div> : <div className="reports-empty">No partner has a {partnerCurrency} balance.</div>}</SectionState></section>

    <section className="reports-section"><div className="reports-section-heading"><div className="reports-icon"><BarChart3 size={19} /></div><div><h2>Purchase summary</h2><p>Posted gross purchases by currency. Purchase returns are excluded by the backend.</p></div></div><SectionState report={purchases}>{(data) => data.byCurrency.length ? <><div className="reports-purchase-cards">{data.byCurrency.map((row) => <article key={row.code}><span>{row.code}</span><strong>{money(row.amount, row.code)}</strong><small>{row.count} {row.count === 1 ? "purchase" : "purchases"}</small></article>)}</div><div className="reports-chart-card reports-chart-card--wide"><h3>Posted purchase count by currency</h3><ResponsiveContainer width="100%" height={250}><BarChart data={data.byCurrency} margin={{ top: 12, right: 15, left: 4, bottom: 8 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="code" /><YAxis allowDecimals={false} /><Tooltip formatter={(value) => [Number(value).toLocaleString(), "Purchases"]} /><Legend /><Bar dataKey="count" name="Purchase count" fill="#668d68" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div>{data.returnsNote && <p className="reports-note">{data.returnsNote}</p>}</> : <div className="reports-empty">No posted purchases match this period.</div>}</SectionState></section>
  </div>;
}
