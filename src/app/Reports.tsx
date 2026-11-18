import { Fragment, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Boxes, CircleDollarSign, RefreshCw, TrendingUp, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { fetchAllPages, formatQuantity, getErrorMessage, isRecord, loadWarehouses, numberValue, parseId, type InventoryWarehouseOption } from "@/app/InventoryShared";
import { useLocale } from "@/lib/locale";
import { financialChartColor, financialValueClass } from "@/lib/financial";

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
type AgingBuckets = { "0_30_days": number; "31_60_days": number; "61_90_days": number; over_90_days: number };
type AgingOpenItem = { transactionDate: string; amount: number; ageDays: number; agingBucket: string; source: string; transactionType: string; referenceType: string | null; referenceId: number | null; description: string | null };
type PartnerAgingCurrency = { currencyId: number; currency: string; currencyName: string; currencySymbol: string; aging: AgingBuckets; totalOutstanding: number; unappliedCredit: number; openItems: AgingOpenItem[] };
type PartnerAgingPartner = { id: number; partnerType: string; name: string; businessName: string | null; phone: string | null; currencies: PartnerAgingCurrency[] };
type PartnerAgingReport = { partners: PartnerAgingPartner[]; page: number; lastPage: number; perPage: number; total: number; asOfDate: string; allocationMethod: string; agingBasis: string };
type PartnerAgingTableRow = { key: string; partner: PartnerAgingPartner; currency: PartnerAgingCurrency | null };
type PurchaseSummary = { count: number; byCurrency: { code: string; count: number; amount: number }[]; returnsNote: string | null };
type PeriodMode = "custom" | "monthly" | "yearly";

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
function parsePartnerAging(value: unknown): PartnerAgingReport {
  if (!isRecord(value) || !isRecord(value.data) || !Array.isArray(value.data.data) || !isRecord(value.filters)) throw new Error("The partner aging report response is incomplete.");
  const pagination = value.data;
  const partners = (pagination.data as unknown[]).map((partner): PartnerAgingPartner => {
    if (!isRecord(partner) || !Array.isArray(partner.currencies)) throw new Error("The partner aging report contains an invalid partner.");
    return {
      id: parseId(partner.id, "partner ID"),
      partnerType: typeof partner.partner_type === "string" ? partner.partner_type : "Partner",
      name: typeof partner.name === "string" ? partner.name : "Partner",
      businessName: typeof partner.business_name === "string" ? partner.business_name : null,
      phone: typeof partner.phone === "string" ? partner.phone : null,
      currencies: partner.currencies.map((currency): PartnerAgingCurrency => {
        if (!isRecord(currency) || !isRecord(currency.aging) || !Array.isArray(currency.open_items)) throw new Error("The partner aging report contains an invalid currency row.");
        return {
          currencyId: parseId(currency.currency_id, "currency ID"),
          currency: typeof currency.currency === "string" ? currency.currency.toUpperCase() : "AFN",
          currencyName: typeof currency.currency_name === "string" ? currency.currency_name : "Currency",
          currencySymbol: typeof currency.currency_symbol === "string" ? currency.currency_symbol : "",
          aging: {
            "0_30_days": numberValue(currency.aging["0_30_days"], "0–30 day aging amount"),
            "31_60_days": numberValue(currency.aging["31_60_days"], "31–60 day aging amount"),
            "61_90_days": numberValue(currency.aging["61_90_days"], "61–90 day aging amount"),
            over_90_days: numberValue(currency.aging.over_90_days, "over 90 day aging amount"),
          },
          totalOutstanding: numberValue(currency.total_outstanding, "total outstanding"),
          unappliedCredit: numberValue(currency.unapplied_credit, "unapplied credit"),
          openItems: currency.open_items.map((item): AgingOpenItem => {
            if (!isRecord(item) || typeof item.transaction_date !== "string") throw new Error("The partner aging report contains an invalid open item.");
            return {
              transactionDate: item.transaction_date,
              amount: numberValue(item.amount, "open item amount"),
              ageDays: numberValue(item.age_days, "open item age"),
              agingBucket: typeof item.aging_bucket === "string" ? item.aging_bucket : "",
              source: typeof item.source === "string" ? item.source : "",
              transactionType: typeof item.transaction_type === "string" ? item.transaction_type : "",
              referenceType: typeof item.reference_type === "string" ? item.reference_type : null,
              referenceId: typeof item.reference_id === "number" ? item.reference_id : null,
              description: typeof item.description === "string" ? item.description : null,
            };
          }),
        };
      }),
    };
  });
  return {
    partners,
    page: numberValue(pagination.current_page, "current page"),
    lastPage: numberValue(pagination.last_page, "last page"),
    perPage: numberValue(pagination.per_page, "page size"),
    total: numberValue(pagination.total, "partner count"),
    asOfDate: typeof value.filters.as_of_date === "string" ? value.filters.as_of_date : "",
    allocationMethod: typeof value.filters.allocation_method === "string" ? value.filters.allocation_method : "",
    agingBasis: typeof value.filters.aging_basis === "string" ? value.filters.aging_basis : "",
  };
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
function localToday(): string { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function agingLabel(value: string): string { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function SectionState<T>({ report, children }: { report: ReportState<T>; children: (data: T) => React.ReactNode }) {
  const { t } = useLocale();
  if (report.loading) return <div className="reports-state" role="status">{t("Loading report…")}</div>;
  if (report.error) return <div className="reports-state reports-state--error" role="alert">{t(report.error)}<button type="button" onClick={report.reload}>{t("Try again")}</button></div>;
  if (!report.data) return <div className="reports-state">{t("No report data available.")}</div>;
  return <>{children(report.data)}</>;
}
const chartColors = ["#0f766e", "#0369a1", "#4f46e5", "#0e7490", "#475569", "#1d4ed8", "#3f6212"];

export default function Reports() {
  const { t, language, direction } = useLocale();
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [warehouses, setWarehouses] = useState<InventoryWarehouseOption[]>([]);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [fromDraft, setFromDraft] = useState("");
  const [toDraft, setToDraft] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [periodMode, setPeriodMode] = useState<PeriodMode>("custom");
  const [periodYear, setPeriodYear] = useState(() => new Date().getFullYear());
  const [periodMonth, setPeriodMonth] = useState(() => new Date().getMonth() + 1);
  const [periodLabel, setPeriodLabel] = useState("All dates");
  const [dateError, setDateError] = useState<string | null>(null);
  const [financialCurrency, setFinancialCurrency] = useState("");
  const [cashFlowCurrency, setCashFlowCurrency] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [partnerType, setPartnerType] = useState("");
  const [partnerCurrency, setPartnerCurrency] = useState("");
  const [agingDateDraft, setAgingDateDraft] = useState(localToday);
  const [agingTypeDraft, setAgingTypeDraft] = useState("");
  const [agingCurrencyDraft, setAgingCurrencyDraft] = useState("");
  const [agingSearchDraft, setAgingSearchDraft] = useState("");
  const [agingFilters, setAgingFilters] = useState({ asOfDate: localToday(), partnerType: "", currencyId: "", search: "" });
  const [agingPage, setAgingPage] = useState(1);
  const [expandedAgingRows, setExpandedAgingRows] = useState<Record<string, boolean>>({});

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
  const partnerAging = useReport("/api/reports/partner-aging", {
    partner_type: agingFilters.partnerType || undefined,
    search: agingFilters.search || undefined,
    currency_id: agingFilters.currencyId ? Number(agingFilters.currencyId) : undefined,
    as_of_date: agingFilters.asOfDate || undefined,
    per_page: 50,
    page: agingPage,
  }, parsePartnerAging);
  const purchases = useReport("/api/reports/purchase-summary", { from_date: fromDate || undefined, to_date: toDate || undefined }, parsePurchases);

  const partnerCurrencies = useMemo(() => [...new Set((partners.data ?? []).flatMap((partner) => partner.balances.map((balance) => balance.currency)))].sort(), [partners.data]);
  const visiblePartners = useMemo(() => (partners.data ?? []).flatMap((partner) => {
    const balance = partner.balances.find((item) => item.currency === partnerCurrency);
    return balance ? [{ id: partner.id, name: partner.name, type: partner.partnerType, balance: balance.balance, balanceType: balance.balanceType }] : [];
  }).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)).slice(0, 15), [partners.data, partnerCurrency]);
  const partnerAgingRows = useMemo(() => (partnerAging.data?.partners ?? []).flatMap((partner): PartnerAgingTableRow[] => partner.currencies.length
    ? partner.currencies.map((currency) => ({ key: `${partner.id}-${currency.currencyId}`, partner, currency }))
    : [{ key: `${partner.id}-none`, partner, currency: null }]), [partnerAging.data]);
  const warehouseValues = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of inventory.data?.rows ?? []) totals.set(row.warehouse, (totals.get(row.warehouse) ?? 0) + row.valueAfn);
    return [...totals].map(([warehouse, value]) => ({ warehouse, value })).filter((row) => row.value > 0).sort((a, b) => b.value - a.value);
  }, [inventory.data]);
  const currencyCode = (id: string) => currencies.find((item) => String(item.id) === id)?.code ?? "AFN";
  const financialCodes = useMemo(() => {
    const codes = new Set([...(financial.data?.cash.map((row) => row.currency) ?? []), ...Object.keys(financial.data?.customerReceivables ?? {}), ...Object.keys(financial.data?.supplierPayables ?? {})]);
    if (financialCurrency) {
      const selectedCode = currencyCode(financialCurrency);
      return codes.has(selectedCode) ? [selectedCode] : [];
    }
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

  function applyPeriod() {
    let nextFrom = "";
    let nextTo = "";
    let nextLabel = t("All dates");
    if (periodMode === "custom") {
      if (fromDraft && toDraft && toDraft < fromDraft) { setDateError("To date must be on or after the from date."); return; }
      nextFrom = fromDraft; nextTo = toDraft;
      nextLabel = nextFrom || nextTo
        ? `${t("Custom range:")} ${nextFrom || t("Any date")} – ${nextTo || t("Any date")}`
        : t("All dates");
    } else if (periodMode === "monthly") {
      if (!Number.isInteger(periodYear) || periodYear < 1 || periodYear > 9999 || !Number.isInteger(periodMonth) || periodMonth < 1 || periodMonth > 12) {
        setDateError("Choose a valid month and year."); return;
      }
      nextFrom = `${String(periodYear).padStart(4, "0")}-${String(periodMonth).padStart(2, "0")}-01`;
      const leapYear = periodYear % 4 === 0 && (periodYear % 100 !== 0 || periodYear % 400 === 0);
      const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      const lastDay = daysInMonth[periodMonth - 1];
      nextTo = `${String(periodYear).padStart(4, "0")}-${String(periodMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      nextLabel = `${t("Monthly:")} ${new Intl.DateTimeFormat(language === "ps" ? "ps-AF" : "en-US", { month: "long" }).format(new Date(2000, periodMonth - 1, 1))} ${periodYear}`;
    } else {
      if (!Number.isInteger(periodYear) || periodYear < 1 || periodYear > 9999) { setDateError("Choose a valid year."); return; }
      nextFrom = `${String(periodYear).padStart(4, "0")}-01-01`;
      nextTo = `${String(periodYear).padStart(4, "0")}-12-31`;
      nextLabel = `${t("Yearly:")} ${periodYear}`;
    }
    setDateError(null); setFromDraft(nextFrom); setToDraft(nextTo); setFromDate(nextFrom); setToDate(nextTo); setPeriodLabel(nextLabel);
  }
  function resetDates() { setPeriodMode("custom"); setFromDraft(""); setToDraft(""); setFromDate(""); setToDate(""); setPeriodLabel(t("All dates")); setDateError(null); }

  return <div className="reports-page" dir={direction}>
    <header className="reports-heading"><div><p className="reports-eyebrow">{t("ANALYTICS")}</p><h1>{t("Reports")}</h1><p>{t("Explore financial performance, cash movement, inventory, partners, and purchases.")}</p></div><button className="reports-refresh" type="button" onClick={() => { financial.reload(); profitLoss.reload(); cashFlow.reload(); inventory.reload(); partners.reload(); purchases.reload(); partnerAging.reload(); }}><RefreshCw size={16} /> {t("Refresh reports")}</button></header>
    <section className="reports-date-filter"><div className="reports-period-copy"><strong>{t("Report period")}</strong><span>{t("Applies to Profit & Loss, Cash Flow, and Purchase Summary.")}</span><small>{t("Applied:")} {periodLabel}</small></div><label>{t("Period")}<select value={periodMode} onChange={(event) => setPeriodMode(event.target.value as PeriodMode)}><option value="custom">{t("Custom Range")}</option><option value="monthly">{t("Monthly")}</option><option value="yearly">{t("Yearly")}</option></select></label>{periodMode === "custom" ? <><label>{t("From")}<input type="date" value={fromDraft} max={toDraft || undefined} onChange={(event) => setFromDraft(event.target.value)} /></label><label>{t("To")}<input type="date" value={toDraft} min={fromDraft || undefined} onChange={(event) => setToDraft(event.target.value)} /></label></> : <>{periodMode === "monthly" && <label>{t("Month")}<select value={periodMonth} onChange={(event) => setPeriodMonth(Number(event.target.value))}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{new Intl.DateTimeFormat(language === "ps" ? "ps-AF" : "en-US", { month: "long" }).format(new Date(2020, index, 1))}</option>)}</select></label>}<label>{t("Year")}<input type="number" min="1" max="9999" value={periodYear} onChange={(event) => setPeriodYear(Number(event.target.value))} /></label></>}<div className="reports-filter-buttons"><button type="button" className="reports-reset" onClick={resetDates}>{t("Reset")}</button><button type="button" className="reports-apply" onClick={applyPeriod}>{t("Apply period")}</button></div>{dateError && <span className="reports-date-error" role="alert">{t(dateError)}</span>}</section>
    {optionsError && <div className="reports-options-error" role="alert">{t("Some filter options could not be loaded:")} {t(optionsError)}</div>}

    <nav className="reports-navigation" aria-label={t("Report sections")}>
      {[
        ["#financial-summary", "Financial summary"],
        ["#profit-loss", "Profit & Loss"],
        ["#cash-flow", "Cash flow"],
        ["#inventory-report", "Inventory"],
        ["#partner-balances", "Partner balances"],
        ["#partner-aging", "Partner aging"],
        ["#purchase-summary", "Purchase summary"],
        ["/secretary/cash-book", "Cash Book"],
        ["/secretary/inventory", "Inventory & movements"],
        ["/secretary/financial-accounts", "Financial Account Ledger"],
      ].map(([href, label]) => <a key={href} href={href}>{t(label)}</a>)}
    </nav>

    <section className="reports-section" id="financial-summary">
      <div className="reports-section-heading">
        <div className="reports-icon"><Wallet size={19} /></div>
        <div>
          <h2>{t("Financial summary")}</h2>
          <p>{t("Balances grouped by currency. Amounts are never combined across currencies.")}</p>
        </div>
        <label className="reports-compact-filter">{t("Currency")}
          <select value={financialCurrency} onChange={(event) => setFinancialCurrency(event.target.value)}>
            <option value="">{t("All currencies")}</option>
            {currencies.map((currency) => <option key={currency.id} value={currency.id}>{currency.code}</option>)}
          </select>
        </label>
      </div>
      <SectionState report={financial}>{(data) => financialCodes.length === 0
        ? <div className="reports-empty">{t("No financial summary data for the selected currency.")}</div>
        : <>
        <div className="reports-metric-grid">
          {financialCodes.map((code) => {
            const cash = data.cash.find((row) => row.currency === code);
            const cashBalance = cash?.balance ?? 0;
            const receivable = data.customerReceivables[code] ?? 0;
            const payable = data.supplierPayables[code] ?? 0;
            return <article className="reports-metric-card" key={code}>
              <span className="reports-currency-label">{code}</span>
              <div><small>{t("Cash & bank")}</small><strong className={financialValueClass(cashBalance, "balance")}>{money(cashBalance, code)}</strong></div>
              <div><small>{t("Customer receivables")}</small><strong className={financialValueClass(receivable, "receivable")}>{money(receivable, code)}</strong></div>
              <div><small>{t("Supplier payables")}</small><strong className={financialValueClass(payable, "payable")}>{money(payable, code)}</strong></div>
            </article>;
          })}
        </div>
        <div className="reports-chart-grid">
          {financialCodes.map((code) => {
            const cash = data.cash.find((row) => row.currency === code);
            const chartData = [
              { name: t("Cash & bank"), amount: cash?.balance ?? 0 },
              { name: t("Receivables"), amount: data.customerReceivables[code] ?? 0 },
              { name: t("Payables"), amount: data.supplierPayables[code] ?? 0 },
            ];
            return <div className="reports-chart-card" key={code}>
              <h3>{code} {t("balances")}</h3>
              <ResponsiveContainer width="100%" height={245}>
                <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 22, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickFormatter={moneyTick} tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="name" width={112} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value) => money(Number(value), code)} />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
                  <Bar dataKey="amount" name={`${t("Amount")} (${code})`} radius={[0, 5, 5, 0]}>
                    {chartData.map((item) => <Cell key={item.name} fill={financialChartColor(item.amount, item.name === t("Receivables") ? "receivable" : item.name === t("Payables") ? "payable" : "balance")} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>;
          })}
        </div>
      </>}</SectionState>
    </section>

    <section className="reports-section" id="profit-loss">
      <div className="reports-section-heading">
        <div className="reports-icon"><TrendingUp size={19} /></div>
        <div>
          <h2>{t("Profit & Loss")}</h2>
          <p>{t("Backend report is expressed in AFN and includes sales returns, returned goods, expenses, and wastage.")}</p>
        </div>
      </div>
      <SectionState report={profitLoss}>{(data) => {
        const chartData = [
          { name: t("Net revenue"), amount: data.netRevenue, kind: "income" as const },
          { name: t("Cost of goods"), amount: data.netCogs, kind: "expense" as const },
          { name: t("Expenses"), amount: data.expenses, kind: "expense" as const },
          { name: t("Stock wastage"), amount: data.wastage, kind: "expense" as const },
          { name: t("Net profit"), amount: data.netProfit, kind: "income" as const },
        ];
        return <>
          <div className="reports-profit-grid">
            <div className="reports-profit-total">
              <span>{t("Net profit / loss")}</span>
              <strong className={data.netProfit < 0 ? "is-negative" : data.netProfit === 0 ? "is-neutral" : "is-positive"}>{money(data.netProfit, data.currency)}</strong>
              <small>{t("Gross profit")}: {money(data.grossProfit, data.currency)}</small>
            </div>
            <div className="reports-profit-kpis">
              <div><small>{t("Gross sales")}</small><strong className={financialValueClass(data.grossSales, "income")}>{money(data.grossSales, data.currency)}</strong></div>
              <div><small>{t("Sales returns")}</small><strong className={financialValueClass(data.salesReturns, "expense")}>{money(data.salesReturns, data.currency)}</strong></div>
              <div><small>{t("Net revenue")}</small><strong className={financialValueClass(data.netRevenue, "income")}>{money(data.netRevenue, data.currency)}</strong></div>
              <div><small>{t("Cost of goods sold (net)")}</small><strong className={financialValueClass(data.netCogs, "expense")}>{money(data.netCogs, data.currency)}</strong></div>
              <div><small>{t("Operating expenses")}</small><strong className={financialValueClass(data.expenses, "expense")}>{money(data.expenses, data.currency)}</strong></div>
              <div><small>{t("Stock wastage")}</small><strong className={financialValueClass(data.wastage, "expense")}>{money(data.wastage, data.currency)}</strong></div>
            </div>
          </div>
          <div className="reports-chart-card reports-chart-card--wide">
            <h3>{t("Profit & loss components ·")} {data.currency}</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 22, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tickFormatter={moneyTick} tick={{ fontSize: 12 }} />
                <YAxis type="category" dataKey="name" width={142} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value) => money(Number(value), data.currency)} />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
                <Bar dataKey="amount" name={data.currency} radius={[0, 5, 5, 0]}>
                  {chartData.map((item) => <Cell key={item.name} fill={financialChartColor(item.amount, item.kind)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {data.expenseCategories.length > 0 && <div className="reports-category-list">
            <h3>{t("Expenses by category")}</h3>
            {data.expenseCategories.map((category) => <div key={category.name}><span>{category.name}</span><strong className={financialValueClass(category.amount, "expense")}>{money(category.amount, data.currency)}</strong></div>)}
          </div>}
        </>;
      }}</SectionState>
    </section>

    <section className="reports-section" id="cash-flow">
      <div className="reports-section-heading">
        <div className="reports-icon"><CircleDollarSign size={19} /></div>
        <div><h2>{t("Cash flow")}</h2><p>{t("Operating cash flows, excluding internal account transfers from inflow and outflow.")}</p></div>
        <label className="reports-compact-filter">{t("Currency")}
          <select value={cashFlowCurrency} onChange={(event) => setCashFlowCurrency(event.target.value)}>
            <option value="">{t("All currencies")}</option>
            {currencies.map((currency) => <option key={currency.id} value={currency.id}>{currency.code}</option>)}
          </select>
        </label>
      </div>
      <SectionState report={cashFlow}>{(data) => data.length
        ? <div className="reports-chart-grid">{data.map((row) => {
          const chartData = [
            { name: t("Cash inflows"), amount: row.inflow, kind: "income" as const },
            { name: t("Cash outflows"), amount: row.outflow, kind: "expense" as const },
            { name: t("Net cash flow"), amount: row.net, kind: "income" as const },
          ];
          return <div className="reports-chart-card" key={row.currency}>
            <h3>{row.currency} {t("cash movement")}</h3>
            <div className="reports-cashflow-summary">
              <span>{t("Opening")} <strong className={financialValueClass(row.opening, "balance")}>{money(row.opening, row.currency)}</strong></span>
              <span>{t("Closing")} <strong className={financialValueClass(row.closing, "balance")}>{money(row.closing, row.currency)}</strong></span>
            </div>
            <ResponsiveContainer width="100%" height={245}>
              <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 22, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tickFormatter={moneyTick} tick={{ fontSize: 12 }} />
                <YAxis type="category" dataKey="name" width={118} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value) => money(Number(value), row.currency)} />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
                <Bar dataKey="amount" name={row.currency} radius={[0, 5, 5, 0]}>
                  {chartData.map((item) => <Cell key={item.name} fill={financialChartColor(item.amount, item.kind)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <small className="reports-transfer-note">{t("Internal transfers:")} +{money(row.transferIn, row.currency)} / −{money(row.transferOut, row.currency)}</small>
          </div>;
        })}</div>
        : <div className="reports-empty">{t("No cash flow data for the selected filters.")}</div>}
      </SectionState>
    </section>

    <section className="reports-section" id="inventory-report">
      <div className="reports-section-heading">
        <div className="reports-icon"><Boxes size={19} /></div>
        <div><h2>{t("Inventory")}</h2><p>{t("Stock quantities stay with their product units; stock values are reported in AFN.")}</p></div>
        <label className="reports-compact-filter">{t("Warehouse")}
          <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
            <option value="">{t("All warehouses")}</option>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
          </select>
        </label>
      </div>
      <SectionState report={inventory}>{(data) => <>
        <div className="reports-inventory-metrics">
          <div><small>{t("Inventory records")}</small><strong>{data.productCount}</strong></div>
          <div><small>{t("Total stock value")}</small><strong>{money(data.totalValue, "AFN")}</strong></div>
          <div><small>{t("Low stock")}</small><strong>{data.lowStock}</strong></div>
          <div><small>{t("Out of stock")}</small><strong>{data.outOfStock}</strong></div>
        </div>
        {warehouseValues.length > 0 && <div className="reports-chart-grid reports-inventory-charts">
          <div className="reports-chart-card">
            <h3>{t("Stock value by warehouse · AFN")}</h3>
            <ResponsiveContainer width="100%" height={280}>
            <PieChart><Pie data={warehouseValues} dataKey="value" nameKey="warehouse" cx="50%" cy="48%" innerRadius="48%" outerRadius="72%">
                {warehouseValues.map((item, index) => <Cell key={item.warehouse} fill={chartColors[index % chartColors.length]} />)}
            </Pie><Tooltip formatter={(value) => money(Number(value), "AFN")} /><Legend wrapperStyle={{ fontSize: 12 }} /></PieChart>
            </ResponsiveContainer>
          </div>
          <div className="reports-chart-card">
            <h3>{t("Warehouse stock value · AFN")}</h3>
            <ResponsiveContainer width="100%" height={270}>
              <BarChart data={warehouseValues} layout="vertical" margin={{ top: 8, right: 22, left: 18, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tickFormatter={moneyTick} tick={{ fontSize: 13 }} />
                <YAxis type="category" dataKey="warehouse" width={125} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value) => money(Number(value), "AFN")} />
                <Bar dataKey="value" name={t("Stock value (AFN)")} fill="#0891b2" radius={[0, 5, 5, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>}
        {data.rows.length
          ? <div className="reports-table-wrap"><table className="reports-table">
            <thead><tr><th>{t("Product")}</th><th>{t("Warehouse")}</th><th>{t("Quantity")}</th><th>{t("Stock value (AFN)")}</th><th>{t("Status")}</th></tr></thead>
            <tbody>{data.rows.map((row) => <tr key={row.id}>
              <td><strong>{row.product}</strong>{row.sku && <small>{row.sku}</small>}</td>
              <td>{row.warehouse}</td><td className="reports-numeric">{formatQuantity(row.quantity)} {row.unit}</td>
              <td className="reports-numeric">{money(row.valueAfn, "AFN")}</td>
              <td><span className={`reports-stock-status reports-stock-status--${row.status}`}>{row.status.replaceAll("_", " ")}</span></td>
            </tr>)}</tbody>
            <tfoot><tr><td colSpan={3}><strong>{t("Total stock value")}</strong></td><td className="reports-numeric"><strong>{money(data.totalValue, "AFN")}</strong></td><td /></tr></tfoot>
          </table></div>
          : <div className="reports-empty">{t("No inventory records match this warehouse.")}</div>}
      </>}</SectionState>
    </section>

    <section className="reports-section" id="partner-balances">
      <div className="reports-section-heading">
        <div className="reports-icon"><BarChart3 size={19} /></div>
        <div><h2>{t("Partner balances")}</h2><p>{t("Customer and supplier balances are compared within one selected currency.")}</p></div>
        <div className="reports-inline-filters">
          <label className="reports-compact-filter">{t("Partner type")}
            <select value={partnerType} onChange={(event) => setPartnerType(event.target.value)}>
              <option value="">{t("All partners")}</option>
              <option value="Customer">{t("Customers")}</option>
              <option value="Supplier">{t("Suppliers")}</option>
            </select>
          </label>
          <label className="reports-compact-filter">{t("Currency")}
            <select value={partnerCurrency} onChange={(event) => setPartnerCurrency(event.target.value)}>
              <option value="">{t("Choose currency")}</option>
              {partnerCurrencies.map((code) => <option key={code} value={code}>{code}</option>)}
            </select>
          </label>
        </div>
      </div>
      <SectionState report={partners}>{() => !partnerCurrencies.length
        ? <div className="reports-empty">{t("No partner balances are available.")}</div>
        : !partnerCurrency
          ? <div className="reports-empty">{t("Choose a currency to view comparable partner balances.")}</div>
          : visiblePartners.length
            ? <div className="reports-chart-card reports-chart-card--wide">
              <h3>{partnerCurrency} {t("outstanding balances · up to 15 partners")}</h3>
              <ResponsiveContainer width="100%" height={Math.max(280, visiblePartners.length * 34)}>
                <BarChart data={visiblePartners} layout="vertical" margin={{ top: 8, right: 24, left: 18, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickFormatter={moneyTick} tick={{ fontSize: 13 }} />
                  <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 13 }} />
                  <Tooltip formatter={(value, _name, item) => [`${money(Number(value), partnerCurrency)} · ${item.payload.type}`, t("Balance")]} />
                  <Bar dataKey="balance" name={`${t("Balance")} (${partnerCurrency})`} radius={[0, 5, 5, 0]}>
                    {visiblePartners.map((item) => <Cell key={item.id} fill={financialChartColor(item.balance, item.type === "Customer" ? "receivable" : "payable")} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="reports-partner-legend">
                <span className="reports-partner-legend__receivable">{t("Customer receivables")}</span>
                <span className="reports-partner-legend__payable">{t("Supplier payables")}</span>
                <span>{t("Positive: customer owes us / we owe supplier · Negative: customer credit / supplier owes us")}</span>
              </div>
            </div>
            : <div className="reports-empty">{t("No partner has a")} {partnerCurrency} {t("balance.")}</div>}
      </SectionState>
    </section>

    <section className="reports-section reports-aging-section" id="partner-aging">
      <div className="reports-section-heading"><div className="reports-icon"><BarChart3 size={19} /></div><div><h2>{t("Partner aging")}</h2><p>{t("Outstanding open items are aged by transaction date using the backend’s FIFO allocation.")}</p></div></div>
      <form className="reports-aging-filters" onSubmit={(event) => { event.preventDefault(); setAgingFilters({ asOfDate: agingDateDraft, partnerType: agingTypeDraft, currencyId: agingCurrencyDraft, search: agingSearchDraft.trim() }); setAgingPage(1); setExpandedAgingRows({}); }}>
        <label>{t("As of date")}<input type="date" value={agingDateDraft} onChange={(event) => setAgingDateDraft(event.target.value)} required /></label>
        <label>{t("Partner type")}<select value={agingTypeDraft} onChange={(event) => setAgingTypeDraft(event.target.value)}><option value="">{t("All partners")}</option><option value="Customer">{t("Customers")}</option><option value="Supplier">{t("Suppliers")}</option></select></label>
        <label>{t("Currency")}<select value={agingCurrencyDraft} onChange={(event) => setAgingCurrencyDraft(event.target.value)}><option value="">{t("All currencies")}</option>{currencies.map((currency) => <option key={currency.id} value={currency.id}>{currency.code}</option>)}</select></label>
        <label className="reports-aging-search">{t("Search")}<input type="search" value={agingSearchDraft} onChange={(event) => setAgingSearchDraft(event.target.value)} placeholder={t("Name, business name, or phone")} /></label>
        <div className="reports-aging-actions"><button className="reports-reset" type="button" onClick={() => { const today = localToday(); setAgingDateDraft(today); setAgingTypeDraft(""); setAgingCurrencyDraft(""); setAgingSearchDraft(""); setAgingFilters({ asOfDate: today, partnerType: "", currencyId: "", search: "" }); setAgingPage(1); setExpandedAgingRows({}); }}>{t("Reset")}</button><button className="reports-apply" type="submit">{t("Apply")}</button></div>
      </form>
      <p className="reports-aging-meta">{t("As of")} <strong>{partnerAging.data?.asOfDate || agingFilters.asOfDate}</strong>{partnerAging.data?.allocationMethod && <> · {t("Allocation:")} <strong>{partnerAging.data.allocationMethod}</strong></>}{partnerAging.data?.agingBasis && <> · {t("Aging basis:")} <strong>{partnerAging.data.agingBasis.replaceAll("_", " ")}</strong></>}</p>
      {partnerAging.loading ? <div className="reports-state" role="status">{t("Loading partner aging report…")}</div>
        : partnerAging.error ? <div className="reports-state reports-state--error" role="alert">{partnerAging.error}<button type="button" onClick={partnerAging.reload}>{t("Try again")}</button></div>
          : !partnerAging.data || partnerAging.data.total === 0 ? <div className="reports-empty">{t("No partners match the selected filters.")}</div>
            : <>
              <div className="reports-table-wrap reports-aging-table-wrap"><table className="reports-table reports-aging-table"><thead><tr><th>{t("Partner")}</th><th>{t("Type")}</th><th>{t("Currency")}</th><th>{t("0–30 days")}</th><th>{t("31–60 days")}</th><th>{t("61–90 days")}</th><th>{t("Over 90 days")}</th><th>{t("Total outstanding")}</th><th>{t("Unapplied credit")}</th><th>{t("Open items")}</th></tr></thead>
                <tbody>{partnerAgingRows.map(({ key, partner, currency }) => {
                  const expanded = Boolean(expandedAgingRows[key]);
                  return <Fragment key={key}><tr>
                    <td><strong>{partner.name}</strong>{partner.businessName && <small>{partner.businessName}</small>}{partner.phone && <small>{partner.phone}</small>}</td><td>{partner.partnerType}</td><td>{currency ? <span className="reports-aging-currency">{currency.currency}</span> : "—"}</td>
                    <td className={currency ? financialValueClass(currency.aging["0_30_days"], partner.partnerType === "Customer" ? "receivable" : "payable") : undefined}>{currency ? money(currency.aging["0_30_days"], currency.currency) : "—"}</td><td className={currency ? financialValueClass(currency.aging["31_60_days"], partner.partnerType === "Customer" ? "receivable" : "payable") : undefined}>{currency ? money(currency.aging["31_60_days"], currency.currency) : "—"}</td><td className={currency ? financialValueClass(currency.aging["61_90_days"], partner.partnerType === "Customer" ? "receivable" : "payable") : undefined}>{currency ? money(currency.aging["61_90_days"], currency.currency) : "—"}</td><td className={currency ? financialValueClass(currency.aging.over_90_days, partner.partnerType === "Customer" ? "receivable" : "payable") : undefined}>{currency ? money(currency.aging.over_90_days, currency.currency) : "—"}</td>
                    <td><strong className={currency ? financialValueClass(currency.totalOutstanding, partner.partnerType === "Customer" ? "receivable" : "payable") : undefined}>{currency ? money(currency.totalOutstanding, currency.currency) : "—"}</strong></td><td className={currency ? financialValueClass(currency.unappliedCredit, partner.partnerType === "Customer" ? "payable" : "receivable") : undefined}>{currency ? money(currency.unappliedCredit, currency.currency) : "—"}</td>
                    <td>{currency && currency.openItems.length > 0 ? <button className="reports-aging-toggle" type="button" aria-expanded={expanded} onClick={() => setExpandedAgingRows((current) => ({ ...current, [key]: !current[key] }))}>{t(expanded ? "Hide" : "View")} ({currency.openItems.length})</button> : "—"}</td>
                  </tr>{expanded && currency && <tr className="reports-aging-detail-row"><td colSpan={10}><div className="reports-aging-items"><h3>{partner.name} · {currency.currency} {t("open items")}</h3><div className="reports-table-wrap"><table className="reports-table"><thead><tr><th>{t("Transaction date")}</th><th>{t("Age")}</th><th>{t("Aging bucket")}</th><th>{t("Amount")}</th><th>{t("Source / type")}</th><th>{t("Reference / description")}</th></tr></thead><tbody>{currency.openItems.map((item, index) => <tr key={`${key}-item-${index}`}><td>{item.transactionDate}</td><td>{item.ageDays} {t("days")}</td><td>{agingLabel(item.agingBucket)}</td><td><strong className={financialValueClass(item.amount, partner.partnerType === "Customer" ? "receivable" : "payable")}>{money(item.amount, currency.currency)}</strong></td><td>{[item.source, item.transactionType].filter(Boolean).join(" · ") || "—"}</td><td>{[item.referenceType, item.referenceId === null ? null : `#${item.referenceId}`, item.description].filter(Boolean).join(" · ") || "—"}</td></tr>)}</tbody></table></div></div></td></tr>}</Fragment>;
                })}</tbody>
              </table></div>
              <div className="reports-aging-pagination"><span>{t("Showing page")} {partnerAging.data.page} {t("of")} {partnerAging.data.lastPage} · {partnerAging.data.total} {t("partners")}</span><div><button type="button" disabled={partnerAging.data.page <= 1} onClick={() => { setExpandedAgingRows({}); setAgingPage((page) => Math.max(1, page - 1)); }}>{t("Previous")}</button><button type="button" disabled={partnerAging.data.page >= partnerAging.data.lastPage} onClick={() => { setExpandedAgingRows({}); setAgingPage((page) => page + 1); }}>{t("Next")}</button></div></div>
            </>}
    </section>

    <section className="reports-section" id="purchase-summary">
      <div className="reports-section-heading">
        <div className="reports-icon"><BarChart3 size={19} /></div>
        <div><h2>{t("Purchase summary")}</h2><p>{t("Posted gross purchases by currency. Purchase returns are excluded by the backend.")}</p></div>
      </div>
      <SectionState report={purchases}>{(data) => data.byCurrency.length
        ? <>
          <div className="reports-purchase-cards">{data.byCurrency.map((row) => <article key={row.code}>
            <span>{row.code}</span><strong>{money(row.amount, row.code)}</strong>
            <small>{row.count} {t(row.count === 1 ? "purchase" : "purchases")}</small>
          </article>)}</div>
          <div className="reports-chart-card reports-chart-card--wide">
            <h3>{t("Posted purchase count by currency")}</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={data.byCurrency} margin={{ top: 12, right: 15, left: 4, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="code" />
                <YAxis allowDecimals={false} />
                <Tooltip formatter={(value) => [Number(value).toLocaleString(), t("Purchases")]} />
                <Legend />
                <Bar dataKey="count" name={t("Purchase count")} fill="#c2410c" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {data.returnsNote && <p className="reports-note">{data.returnsNote}</p>}
        </>
        : <div className="reports-empty">{t("No posted purchases match this period.")}</div>}
      </SectionState>
    </section>
  </div>;
}
