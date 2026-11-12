import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import axios from 'axios'
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Boxes,
  CircleAlert,
  RefreshCw,
  ShoppingCart,
  ShoppingBasket,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { api } from '@/lib/api'

type Resource<T> =
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; message: string }

interface FinancialSummary {
  customers: {
    receivables: Record<string, number>
  }
  suppliers: {
    payables: Record<string, number>
  }
}

interface FinancialAccountBalance {
  accountType: string
  currency: string
  currentBalance: number
}

interface InventorySummary {
  inventoryRecords: number
  totalStockValueAfn: number
  inStockCount: number
  lowStockCount: number
  outOfStockCount: number
}

interface ProfitLossSummary {
  currency: string
  grossSales: number
  salesReturns: number
  netRevenue: number
  grossProfit: number
  operatingExpenses: number
  stockWastageCost: number
  netProfit: number
}

interface PurchaseSummary {
  totalPurchaseCount: number
  grossPurchases: AmountRow[]
  purchaseReturnsNote: string
}

interface OverviewData {
  financial: Resource<FinancialSummary>
  accounts: Resource<FinancialAccountBalance[]>
  inventory: Resource<InventorySummary>
  profitLoss: Resource<ProfitLossSummary>
  purchases: Resource<PurchaseSummary>
}

interface AmountRow {
  currency: string
  amount: number
}

interface SummaryCardProps {
  title: string
  icon: typeof Wallet
  color: 'green' | 'amber' | 'blue' | 'violet'
  resource: Resource<AmountRow[]>
  emptyMessage: string
  totalCount?: number
  note?: string
}

const initialOverview: OverviewData = {
  financial: { status: 'loading' },
  accounts: { status: 'loading' },
  inventory: { status: 'loading' },
  profitLoss: { status: 'loading' },
  purchases: { status: 'loading' },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseAmount(value: unknown, label: string): number {
  const isNumericString = typeof value === 'string' && value.trim() !== ''
  const isNumericValue = typeof value === 'number' || isNumericString
  const amount = typeof value === 'number' ? value : isNumericString ? Number(value) : NaN

  if (!isNumericValue || !Number.isFinite(amount)) {
    throw new Error(`The server returned an invalid ${label}.`)
  }

  return amount
}

function parseCurrencyTotals(value: unknown, label: string): Record<string, number> {
  if (!isRecord(value)) {
    if (Array.isArray(value) && value.length === 0) return {}
    throw new Error(`The server returned an invalid ${label} summary.`)
  }

  return Object.fromEntries(
    Object.entries(value).map(([currency, amount]) => [
      currency,
      parseAmount(amount, `${currency} ${label}`),
    ]),
  )
}

function parseFinancialSummary(value: unknown): FinancialSummary {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error('The financial summary response was not in the expected format.')
  }

  const { customers, suppliers } = value.data

  if (!isRecord(customers) || !isRecord(suppliers)) {
    throw new Error('The financial summary did not include partner balances.')
  }

  return {
    customers: {
      receivables: parseCurrencyTotals(customers.receivables, 'receivables'),
    },
    suppliers: {
      payables: parseCurrencyTotals(suppliers.payables, 'payables'),
    },
  }
}

function parseAccountBalances(value: unknown): FinancialAccountBalance[] {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error('The financial account response was not in the expected format.')
  }

  return value.data.map((account: unknown) => {
    if (
      !isRecord(account) ||
      typeof account.account_type !== 'string' ||
      !isRecord(account.currency) ||
      typeof account.currency.code !== 'string'
    ) {
      throw new Error('The server returned an incomplete financial account.')
    }

    return {
      accountType: account.account_type.trim().toLowerCase(),
      currency: account.currency.code,
      currentBalance: parseAmount(account.current_balance, 'account balance'),
    }
  })
}

function parseInventorySummary(value: unknown): InventorySummary {
  if (!isRecord(value) || !isRecord(value.summary)) {
    throw new Error('The inventory response did not include a summary.')
  }

  const summary = value.summary

  return {
    inventoryRecords: parseAmount(summary.products_count, 'inventory record count'),
    totalStockValueAfn: parseAmount(summary.total_stock_value_afn, 'AFN stock value'),
    inStockCount: parseAmount(summary.in_stock_count, 'in-stock count'),
    lowStockCount: parseAmount(summary.low_stock_count, 'low-stock count'),
    outOfStockCount: parseAmount(summary.out_of_stock_count, 'out-of-stock count'),
  }
}

function parseProfitLoss(value: unknown): ProfitLossSummary {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error('The profit and loss response was not in the expected format.')
  }

  const { currency, revenue, profit } = value.data

  if (typeof currency !== 'string' || !isRecord(revenue) || !isRecord(profit)) {
    throw new Error('The profit and loss response did not include its currency and totals.')
  }

  return {
    currency,
    grossSales: parseAmount(revenue.gross_sales, 'gross sales'),
    salesReturns: parseAmount(revenue.sales_returns, 'sales returns'),
    netRevenue: parseAmount(revenue.net_revenue, 'net revenue'),
    grossProfit: parseAmount(profit.gross_profit, 'gross profit'),
    operatingExpenses: parseAmount(profit.operating_expenses, 'operating expenses'),
    stockWastageCost: parseAmount(profit.stock_wastage_cost, 'stock wastage cost'),
    netProfit: parseAmount(profit.net_profit, 'net profit'),
  }
}

function parsePurchaseSummary(value: unknown): PurchaseSummary {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error('The purchase summary response was not in the expected format.')
  }

  const {
    total_purchase_count,
    gross_purchases_by_currency,
    purchase_returns_included,
    purchase_returns_note,
  } = value.data

  if (
    !Array.isArray(gross_purchases_by_currency) ||
    typeof purchase_returns_included !== 'boolean' ||
    typeof purchase_returns_note !== 'string'
  ) {
    throw new Error('The purchase summary response did not include currency totals and its returns note.')
  }

  const totalPurchaseCount = parseAmount(total_purchase_count, 'purchase count')
  if (!Number.isInteger(totalPurchaseCount) || totalPurchaseCount < 0) {
    throw new Error('The server returned an invalid purchase count.')
  }

  return {
    totalPurchaseCount,
    grossPurchases: gross_purchases_by_currency.map((group: unknown) => {
      if (
        !isRecord(group) ||
        typeof group.currency_code !== 'string' ||
        !Number.isInteger(parseAmount(group.currency_id, 'currency ID'))
      ) {
        throw new Error('The purchase summary included an invalid currency group.')
      }

      const purchaseCount = parseAmount(group.purchase_count, `${group.currency_code} purchase count`)
      if (!Number.isInteger(purchaseCount) || purchaseCount < 0) {
        throw new Error(`The server returned an invalid ${group.currency_code} purchase count.`)
      }

      return {
        currency: group.currency_code,
        amount: parseAmount(group.gross_purchase_amount, `${group.currency_code} purchase amount`),
      }
    }),
    purchaseReturnsNote: purchase_returns_note,
  }
}

function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const responseData: unknown = error.response?.data

    if (isRecord(responseData) && typeof responseData.message === 'string') {
      return responseData.message
    }

    if (!error.response) {
      return 'Could not connect to the server. Check your connection and try again.'
    }
  }

  if (error instanceof Error) return error.message
  return 'The report could not be loaded. Please try again.'
}

async function loadResource<T>(
  url: string,
  parse: (value: unknown) => T,
): Promise<Resource<T>> {
  try {
    const { data } = await api.get<unknown>(url)
    return { status: 'success', data: parse(data) }
  } catch (error: unknown) {
    return { status: 'error', message: getErrorMessage(error) }
  }
}

function formatNumber(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount)
}

function formatInteger(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatCurrencyAmount(amount: number, currency: string): string {
  return `${formatNumber(amount)} ${currency}`
}

function toRows(totals: Record<string, number>): AmountRow[] {
  return Object.entries(totals)
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((left, right) => left.currency.localeCompare(right.currency))
}

function groupBalances(
  accounts: FinancialAccountBalance[],
  accountType: 'cash' | 'bank',
): AmountRow[] {
  const grouped = new Map<string, number>()

  for (const account of accounts) {
    if (account.accountType !== accountType) continue
    grouped.set(account.currency, (grouped.get(account.currency) ?? 0) + account.currentBalance)
  }

  return toRows(Object.fromEntries(grouped))
}

function SummaryCard({
  title,
  icon: Icon,
  color,
  resource,
  emptyMessage,
  totalCount,
  note,
}: SummaryCardProps) {
  return (
    <article className="overview-card">
      <div className={`overview-card__icon overview-card__icon--${color}`}>
        <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
      </div>
      <h2>{title}</h2>
      {resource.status === 'loading' ? (
        <div className="overview-skeleton" aria-label={`Loading ${title.toLowerCase()}`} />
      ) : resource.status === 'error' ? (
        <p className="overview-card__message overview-card__message--error" role="alert">
          {resource.message}
        </p>
      ) : (
        <>
          {totalCount !== undefined && (
            <p className="overview-card__total-count">
              <span>Total purchases</span>
              <strong>{formatInteger(totalCount)}</strong>
            </p>
          )}
          {resource.data.length === 0 ? (
            <p className="overview-card__message">{emptyMessage}</p>
          ) : (
            <ul className="overview-amount-list">
              {resource.data.map(({ currency, amount }, index) => (
                <li key={`${currency}-${index}`}>
                  <span>{currency}</span>
                  <strong>{formatCurrencyAmount(amount, currency)}</strong>
                </li>
              ))}
            </ul>
          )}
          {note && <p className="overview-card__note">{note}</p>}
        </>
      )}
    </article>
  )
}

function ReportPanel({
  title,
  description,
  icon: Icon,
  resource,
  children,
}: {
  title: string
  description: string
  icon: typeof Boxes
  resource: Resource<unknown>
  children: ReactNode
}) {
  return (
    <section className="overview-panel">
      <div className="overview-panel__header">
        <span className="overview-panel__icon"><Icon size={18} aria-hidden="true" /></span>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      {resource.status === 'loading' ? (
        <div className="overview-panel__loading" role="status">
          <span className="loading-spinner" />
          <span>Loading report…</span>
        </div>
      ) : resource.status === 'error' ? (
        <div className="overview-empty overview-empty--error" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <span>{resource.message}</span>
        </div>
      ) : children}
    </section>
  )
}

export default function SecretaryOverview() {
  const [overview, setOverview] = useState(initialOverview)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    setIsRefreshing(true)
    setOverview(initialOverview)

    const [financial, accounts, inventory, profitLoss, purchases] = await Promise.all([
      loadResource('/api/reports/financial-summary', parseFinancialSummary),
      loadResource('/api/financial-accounts/balances', parseAccountBalances),
      loadResource('/api/reports/inventory', parseInventorySummary),
      loadResource('/api/reports/profit-loss', parseProfitLoss),
      loadResource('/api/reports/purchase-summary', parsePurchaseSummary),
    ])

    setOverview({ financial, accounts, inventory, profitLoss, purchases })
    setIsRefreshing(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const receivables = useMemo<Resource<AmountRow[]>>(
    () => overview.financial.status === 'success'
      ? { status: 'success', data: toRows(overview.financial.data.customers.receivables) }
      : overview.financial,
    [overview.financial],
  )
  const payables = useMemo<Resource<AmountRow[]>>(
    () => overview.financial.status === 'success'
      ? { status: 'success', data: toRows(overview.financial.data.suppliers.payables) }
      : overview.financial,
    [overview.financial],
  )
  const cashBalance = useMemo<Resource<AmountRow[]>>(
    () => overview.accounts.status === 'success'
      ? { status: 'success', data: groupBalances(overview.accounts.data, 'cash') }
      : overview.accounts,
    [overview.accounts],
  )
  const bankBalance = useMemo<Resource<AmountRow[]>>(
    () => overview.accounts.status === 'success'
      ? { status: 'success', data: groupBalances(overview.accounts.data, 'bank') }
      : overview.accounts,
    [overview.accounts],
  )
  const purchaseAmounts = useMemo<Resource<AmountRow[]>>(
    () => overview.purchases.status === 'success'
      ? { status: 'success', data: overview.purchases.data.grossPurchases }
      : overview.purchases,
    [overview.purchases],
  )

  const inventory = overview.inventory.status === 'success' ? overview.inventory.data : null
  const profitLoss = overview.profitLoss.status === 'success' ? overview.profitLoss.data : null
  const purchaseSummary =
    overview.purchases.status === 'success' ? overview.purchases.data : null

  return (
    <div className="overview-page">
      <header className="overview-heading">
        <div>
          <p className="overview-eyebrow">WORKSPACE</p>
          <h1>Overview</h1>
          <p className="overview-heading__description">
            A current view of your business balances and operations.
          </p>
        </div>
        <button
          className="overview-refresh"
          type="button"
          onClick={() => void refresh()}
          disabled={isRefreshing}
          aria-label="Refresh dashboard overview"
        >
          <RefreshCw size={16} className={isRefreshing ? 'overview-refresh__spinning' : ''} aria-hidden="true" />
          <span>{isRefreshing ? 'Refreshing…' : 'Refresh'}</span>
        </button>
      </header>

      <section className="overview-section" aria-label="Financial balances">
        <div className="overview-section__heading">
          <h2>Financial balances</h2>
          <p>Balances are grouped by currency and shown separately.</p>
        </div>
        <div className="overview-cards">
          <SummaryCard
            title="Customer Receivables"
            icon={ArrowDownRight}
            color="green"
            resource={receivables}
            emptyMessage="No receivables recorded."
          />
          <SummaryCard
            title="Supplier Payables"
            icon={ArrowUpRight}
            color="amber"
            resource={payables}
            emptyMessage="No payables recorded."
          />
          <SummaryCard
            title="Cash Balance"
            icon={Wallet}
            color="blue"
            resource={cashBalance}
            emptyMessage="No accounts categorized as cash."
          />
          <SummaryCard
            title="Bank Balance"
            icon={Banknote}
            color="violet"
            resource={bankBalance}
            emptyMessage="No accounts categorized as bank."
          />
          <SummaryCard
            title="Total Purchases"
            icon={ShoppingCart}
            color="green"
            resource={purchaseAmounts}
            emptyMessage="No posted purchases recorded."
            totalCount={purchaseSummary?.totalPurchaseCount}
            note={purchaseSummary?.purchaseReturnsNote}
          />
        </div>
      </section>

      <section className="overview-grid">
        <ReportPanel
          title="Inventory"
          description="Stock counts and valuation"
          icon={Boxes}
          resource={overview.inventory}
        >
          {inventory && (
            <div className="inventory-overview">
              <div className="inventory-overview__value">
                <span>Inventory records</span>
                <strong>{formatNumber(inventory.inventoryRecords)}</strong>
              </div>
              <div className="inventory-overview__value">
                <span>Stock value</span>
                <strong>{formatCurrencyAmount(inventory.totalStockValueAfn, 'AFN')}</strong>
              </div>
              <div className="inventory-status-list">
                <div><span className="inventory-status-dot inventory-status-dot--in" /> In stock <strong>{formatNumber(inventory.inStockCount)}</strong></div>
                <div><span className="inventory-status-dot inventory-status-dot--low" /> Low stock <strong>{formatNumber(inventory.lowStockCount)}</strong></div>
                <div><span className="inventory-status-dot inventory-status-dot--out" /> Out of stock <strong>{formatNumber(inventory.outOfStockCount)}</strong></div>
              </div>
            </div>
          )}
        </ReportPanel>

        <ReportPanel
          title="Sales"
          description="Sales from the all-time profit and loss report"
          icon={ShoppingBasket}
          resource={overview.profitLoss}
        >
          {profitLoss && (
            <div className="overview-report-values">
              <div>
                <span>Gross sales</span>
                <strong>{formatCurrencyAmount(profitLoss.grossSales, profitLoss.currency)}</strong>
              </div>
              <div>
                <span>Sales returns</span>
                <strong>{formatCurrencyAmount(profitLoss.salesReturns, profitLoss.currency)}</strong>
              </div>
              <div className="overview-report-values__highlight">
                <span>Net revenue</span>
                <strong>{formatCurrencyAmount(profitLoss.netRevenue, profitLoss.currency)}</strong>
              </div>
            </div>
          )}
        </ReportPanel>

        <ReportPanel
          title="Profit & Loss"
          description="All-time results · AFN"
          icon={TrendingUp}
          resource={overview.profitLoss}
        >
          {profitLoss && (
            <div className="overview-report-values">
              <div>
                <span>Gross profit</span>
                <strong>{formatCurrencyAmount(profitLoss.grossProfit, profitLoss.currency)}</strong>
              </div>
              <div>
                <span>Operating expenses</span>
                <strong>{formatCurrencyAmount(profitLoss.operatingExpenses, profitLoss.currency)}</strong>
              </div>
              <div>
                <span>Stock wastage cost</span>
                <strong>{formatCurrencyAmount(profitLoss.stockWastageCost, profitLoss.currency)}</strong>
              </div>
              <div className="overview-report-values__highlight">
                <span>Net profit</span>
                <strong>{formatCurrencyAmount(profitLoss.netProfit, profitLoss.currency)}</strong>
              </div>
            </div>
          )}
        </ReportPanel>

      </section>

      <p className="overview-footnote">
        Cash and bank balances are based on the account types returned by the backend. Recent activity is omitted because no suitable recent-activity API is available.
      </p>
    </div>
  )
}