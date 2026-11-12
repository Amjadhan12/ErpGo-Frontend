import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import { AlertCircle, ChevronLeft, ChevronRight, Eye, RefreshCw, X } from 'lucide-react'
import { api } from '@/lib/api'

interface PurchaseItem {
  id: number
  quantity: number
  unitCost: number
  discountAmount: number
  lineTotal: number
  product: { name: string; sku: string | null } | null
}

interface Purchase {
  id: number
  purchaseNumber: string
  purchaseDate: string
  supplier: string
  warehouse: string
  invoiceNumber: string | null
  currency: string
  exchangeRate: number
  subtotal: number
  discountAmount: number
  grandTotal: number
  paymentStatus: string
  status: string
  createdBy: string
  notes: string | null
  items: PurchaseItem[]
}

interface PurchasePage {
  data: Purchase[]
  currentPage: number
  lastPage: number
  perPage: number
  total: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberValue(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(parsed)) throw new Error(`The server returned an invalid ${label}.`)
  return parsed
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function relationName(value: unknown, ...fields: string[]): string {
  if (!isRecord(value)) return '—'
  for (const field of fields) {
    if (typeof value[field] === 'string' && value[field].trim()) return value[field]
  }
  return '—'
}

function parsePurchase(value: unknown): Purchase {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error('The server returned an incomplete purchase record.')
  }

  const currency = isRecord(value.currency) ? value.currency.code : null
  if (
    typeof value.purchase_number !== 'string' ||
    typeof value.purchase_date !== 'string' ||
    typeof currency !== 'string'
  ) {
    throw new Error('The server returned a purchase without its number, date, or currency.')
  }

  return {
    id: numberValue(value.id, 'purchase ID'),
    purchaseNumber: value.purchase_number,
    purchaseDate: value.purchase_date,
    supplier: relationName(value.supplier, 'business_name', 'name'),
    warehouse: relationName(value.warehouse, 'name'),
    invoiceNumber: optionalText(value.invoice_number),
    currency,
    exchangeRate: numberValue(value.exchange_rate_to_afn, 'exchange rate'),
    subtotal: numberValue(value.subtotal, 'subtotal'),
    discountAmount: numberValue(value.discount_amount, 'discount amount'),
    grandTotal: numberValue(value.grand_total, 'grand total'),
    paymentStatus: typeof value.payment_status === 'string' ? value.payment_status : '—',
    status: typeof value.status === 'string' ? value.status : '—',
    createdBy: relationName(value.creator, 'name'),
    notes: optionalText(value.notes),
    items: value.items.map((item: unknown) => {
      if (!isRecord(item)) throw new Error('The server returned an invalid purchase item.')
      return {
        id: numberValue(item.id, 'purchase item ID'),
        quantity: numberValue(item.quantity, 'item quantity'),
        unitCost: numberValue(item.unit_cost, 'unit cost'),
        discountAmount: numberValue(item.discount_amount ?? 0, 'item discount'),
        lineTotal: numberValue(item.line_total, 'line total'),
        product: isRecord(item.product)
          ? {
              name: typeof item.product.name === 'string' ? item.product.name : '—',
              sku: optionalText(item.product.sku),
            }
          : null,
      }
    }),
  }
}

function parsePurchasePage(value: unknown): PurchasePage {
  if (
    !isRecord(value) ||
    !Array.isArray(value.data) ||
    !Number.isInteger(value.current_page) ||
    !Number.isInteger(value.last_page) ||
    !Number.isInteger(value.per_page) ||
    !Number.isInteger(value.total)
  ) {
    throw new Error('The purchase list response did not include valid pagination data.')
  }

  return {
    data: value.data.map(parsePurchase),
    currentPage: value.current_page as number,
    lastPage: value.last_page as number,
    perPage: value.per_page as number,
    total: value.total as number,
  }
}

function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data: unknown = error.response?.data
    if (isRecord(data) && typeof data.message === 'string') return data.message
    if (!error.response) return 'Could not connect to the server. Check your connection and try again.'
  }
  if (error instanceof Error) return error.message
  return 'The purchases could not be loaded. Please try again.'
}

function formatAmount(amount: number, currency: string): string {
  return `${new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)} ${currency}`
}

function formatQuantity(amount: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(amount)
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

function statusLabel(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export default function PurchaseList() {
  const [page, setPage] = useState<PurchasePage | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [selectedPurchase, setSelectedPurchase] = useState<Purchase | null>(null)

  const loadPurchases = useCallback(async (signal: AbortSignal) => {
    setIsLoading(true)
    setError(null)
    try {
      const { data } = await api.get<unknown>('/api/purchases', {
        params: { page: currentPage },
        signal,
      })
      setPage(parsePurchasePage(data))
    } catch (loadError: unknown) {
      if (axios.isCancel(loadError)) return
      setError(getErrorMessage(loadError))
      setPage(null)
    } finally {
      if (!signal.aborted) setIsLoading(false)
    }
  }, [currentPage])

  useEffect(() => {
    const controller = new AbortController()
    void loadPurchases(controller.signal)
    return () => controller.abort()
  }, [loadPurchases, retry])

  useEffect(() => {
    if (!selectedPurchase) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setSelectedPurchase(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedPurchase])

  const startRecord = page && page.total > 0 ? (page.currentPage - 1) * page.perPage + 1 : 0
  const endRecord = page ? Math.min((page.currentPage - 1) * page.perPage + page.data.length, page.total) : 0

  return (
    <div className="purchases-page">
      <header className="purchases-heading">
        <div>
          <p className="overview-eyebrow">OPERATIONS</p>
          <h1>Purchases</h1>
          <p className="overview-heading__description">Review posted purchases and their items.</p>
        </div>
        <button
          className="overview-refresh"
          type="button"
          onClick={() => setRetry((value) => value + 1)}
          disabled={isLoading}
          aria-label="Refresh purchases"
        >
          <RefreshCw size={16} className={isLoading ? 'overview-refresh__spinning' : ''} aria-hidden="true" />
          <span>Refresh</span>
        </button>
      </header>

      <section className="purchases-panel" aria-label="Purchase list">
        {isLoading ? (
          <div className="purchases-state" role="status">
            <span className="loading-spinner" />
            <span>Loading purchases…</span>
          </div>
        ) : error ? (
          <div className="purchases-state purchases-state--error" role="alert">
            <AlertCircle size={20} aria-hidden="true" />
            <span>{error}</span>
            <button type="button" className="purchases-retry" onClick={() => setRetry((value) => value + 1)}>
              Try again
            </button>
          </div>
        ) : page && page.data.length === 0 ? (
          <div className="purchases-state purchases-state--empty">
            <span className="purchases-empty-mark"><Eye size={21} aria-hidden="true" /></span>
            <strong>No purchases found</strong>
            <span>There are no purchases on this page.</span>
          </div>
        ) : page ? (
          <>
            <div className="purchases-table-scroll">
              <table className="purchases-table">
                <thead>
                  <tr>
                    <th>Purchase Number</th>
                    <th>Purchase Date</th>
                    <th>Supplier</th>
                    <th>Warehouse</th>
                    <th>Invoice Number</th>
                    <th>Currency</th>
                    <th className="purchases-table__numeric">Grand Total</th>
                    <th>Payment Status</th>
                    <th>Purchase Status</th>
                    <th>Created By</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {page.data.map((purchase) => (
                    <tr key={purchase.id}>
                      <td><strong className="purchases-number">{purchase.purchaseNumber}</strong></td>
                      <td>{formatDate(purchase.purchaseDate)}</td>
                      <td>{purchase.supplier}</td>
                      <td>{purchase.warehouse}</td>
                      <td>{purchase.invoiceNumber || '—'}</td>
                      <td><span className="purchases-currency">{purchase.currency}</span></td>
                      <td className="purchases-table__numeric purchases-total">{formatAmount(purchase.grandTotal, purchase.currency)}</td>
                      <td><span className={`purchase-status purchase-status--${purchase.paymentStatus.toLowerCase()}`}>{statusLabel(purchase.paymentStatus)}</span></td>
                      <td><span className={`purchase-status purchase-status--${purchase.status.toLowerCase()}`}>{statusLabel(purchase.status)}</span></td>
                      <td>{purchase.createdBy}</td>
                      <td>
                        <button
                          className="purchase-view-button"
                          type="button"
                          onClick={() => setSelectedPurchase(purchase)}
                          aria-label={`View details for ${purchase.purchaseNumber}`}
                        >
                          <Eye size={15} aria-hidden="true" />
                          <span>Details</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <footer className="purchases-pagination">
              <span>
                Showing {startRecord}–{endRecord} of {new Intl.NumberFormat().format(page.total)} purchases
              </span>
              <div className="purchases-pagination__controls">
                <button
                  type="button"
                  onClick={() => setCurrentPage(page.currentPage - 1)}
                  disabled={isLoading || page.currentPage <= 1}
                  aria-label="Previous page"
                >
                  <ChevronLeft size={16} aria-hidden="true" /> Previous
                </button>
                <span>Page <strong>{page.currentPage}</strong> of <strong>{page.lastPage}</strong></span>
                <button
                  type="button"
                  onClick={() => setCurrentPage(page.currentPage + 1)}
                  disabled={isLoading || page.currentPage >= page.lastPage}
                  aria-label="Next page"
                >
                  Next <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            </footer>
          </>
        ) : null}
      </section>

      {selectedPurchase && (
        <div className="purchase-modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedPurchase(null)
        }}>
          <section
            className="purchase-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="purchase-modal-title"
          >
            <header className="purchase-modal__header">
              <div>
                <p className="overview-eyebrow">PURCHASE DETAILS</p>
                <h2 id="purchase-modal-title">{selectedPurchase.purchaseNumber}</h2>
                <p>{formatDate(selectedPurchase.purchaseDate)}</p>
              </div>
              <button type="button" className="purchase-modal__close" aria-label="Close details" onClick={() => setSelectedPurchase(null)}>
                <X size={19} aria-hidden="true" />
              </button>
            </header>

            <div className="purchase-modal__body">
              <dl className="purchase-detail-grid">
                <div><dt>Supplier</dt><dd>{selectedPurchase.supplier}</dd></div>
                <div><dt>Warehouse</dt><dd>{selectedPurchase.warehouse}</dd></div>
                <div><dt>Invoice Number</dt><dd>{selectedPurchase.invoiceNumber || '—'}</dd></div>
                <div><dt>Currency</dt><dd>{selectedPurchase.currency}</dd></div>
                <div><dt>Exchange Rate</dt><dd>{formatQuantity(selectedPurchase.exchangeRate)} AFN / {selectedPurchase.currency}</dd></div>
                <div><dt>Payment Status</dt><dd>{statusLabel(selectedPurchase.paymentStatus)}</dd></div>
                <div><dt>Purchase Status</dt><dd>{statusLabel(selectedPurchase.status)}</dd></div>
              </dl>

              <div className="purchase-items-heading">
                <h3>Items</h3>
                <span>{selectedPurchase.items.length} {selectedPurchase.items.length === 1 ? 'item' : 'items'}</span>
              </div>
              <div className="purchase-items-scroll">
                <table className="purchase-items-table">
                  <thead>
                    <tr><th>Product</th><th>Quantity</th><th>Unit Cost</th><th>Discount</th><th>Line Total</th></tr>
                  </thead>
                  <tbody>
                    {selectedPurchase.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.product?.name || '—'}</strong>
                          {item.product?.sku && <small>{item.product.sku}</small>}
                        </td>
                        <td>{formatQuantity(item.quantity)}</td>
                        <td>{formatAmount(item.unitCost, selectedPurchase.currency)}</td>
                        <td>{formatAmount(item.discountAmount, selectedPurchase.currency)}</td>
                        <td><strong>{formatAmount(item.lineTotal, selectedPurchase.currency)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="purchase-totals">
                <div><span>Subtotal</span><strong>{formatAmount(selectedPurchase.subtotal, selectedPurchase.currency)}</strong></div>
                <div><span>Discount</span><strong>{formatAmount(selectedPurchase.discountAmount, selectedPurchase.currency)}</strong></div>
                <div className="purchase-totals__grand"><span>Grand Total</span><strong>{formatAmount(selectedPurchase.grandTotal, selectedPurchase.currency)}</strong></div>
              </div>

              <div className="purchase-notes">
                <strong>Notes</strong>
                <p>{selectedPurchase.notes || 'No notes provided.'}</p>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
