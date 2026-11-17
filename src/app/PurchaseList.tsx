import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import { AlertCircle, ChevronLeft, ChevronRight, Eye, Plus, RefreshCw, X } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { useLocale } from '@/lib/locale'

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

function getErrorMessage(
  error: unknown,
  t: (text: string) => string,
  language: 'en' | 'ps',
): string {
  const translate = (message: string) => {
    const translated = t(message)
    return translated !== message || language === 'en'
      ? translated
      : t('The purchases could not be loaded. Please try again.')
  }
  if (axios.isAxiosError(error)) {
    const data: unknown = error.response?.data
    if (isRecord(data) && typeof data.message === 'string') return translate(data.message)
    if (!error.response) return t('Could not connect to the server. Check your connection and try again.')
  }
  if (error instanceof Error) return translate(error.message)
  return t('The purchases could not be loaded. Please try again.')
}

function formatAmount(amount: number, currency: string, language: 'en' | 'ps'): string {
  return `${new Intl.NumberFormat(language === 'ps' ? 'ps-AF' : 'en', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)} ${currency}`
}

function formatQuantity(amount: number, language: 'en' | 'ps'): string {
  return new Intl.NumberFormat(language === 'ps' ? 'ps-AF' : 'en', { maximumFractionDigits: 4 }).format(amount)
}

function formatDate(value: string, language: 'en' | 'ps'): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(language === 'ps' ? 'ps-AF' : 'en', { dateStyle: 'medium' }).format(date)
}

function statusLabel(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export default function PurchaseList() {
  const { direction, language, t } = useLocale()
  const navigate = useNavigate()
  const location = useLocation()
  const [page, setPage] = useState<PurchasePage | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [selectedPurchase, setSelectedPurchase] = useState<Purchase | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  useEffect(() => {
    if (
      typeof location.state === 'object' &&
      location.state !== null &&
      'purchaseCreated' in location.state &&
      location.state.purchaseCreated === true
    ) {
      setSuccessMessage(t('Purchase created successfully.'))
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [location.pathname, location.state, navigate, t])

  useEffect(() => {
    if (!successMessage) return
    const timer = window.setTimeout(() => setSuccessMessage(null), 6000)
    return () => window.clearTimeout(timer)
  }, [successMessage])

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
      setError(getErrorMessage(loadError, t, language))
      setPage(null)
    } finally {
      if (!signal.aborted) setIsLoading(false)
    }
  }, [currentPage, language, t])

  useEffect(() => {
    const controller = new AbortController()
    void loadPurchases(controller.signal)
    return () => controller.abort()
  }, [loadPurchases, retry])

  const startRecord = page && page.total > 0 ? (page.currentPage - 1) * page.perPage + 1 : 0
  const endRecord = page ? Math.min((page.currentPage - 1) * page.perPage + page.data.length, page.total) : 0

  return (
    <div className="purchases-page purchase-redesign" dir={direction}>
      <header className="purchases-heading purchase-redesign__heading">
        <div>
          <p className="overview-eyebrow purchase-redesign__eyebrow">{t('OPERATIONS')}</p>
          <h1>{t('Purchases')}</h1>
          <p className="overview-heading__description">{t('Review posted purchases and their items.')}</p>
        </div>
        <button
          className="overview-refresh"
          type="button"
          onClick={() => setRetry((value) => value + 1)}
          disabled={isLoading}
          aria-label={t('Refresh purchases')}
        >
          <RefreshCw size={16} className={isLoading ? 'overview-refresh__spinning' : ''} aria-hidden="true" />
          <span>{t('Refresh')}</span>
        </button>
        <button
          className="purchase-create-button"
          type="button"
          onClick={() => navigate('/secretary/purchases/create')}
        >
          <Plus size={16} aria-hidden="true" />
          <span>{t('Create Purchase')}</span>
        </button>
      </header>

      <section className="purchases-panel purchase-redesign__panel" aria-label={t('Purchase list')}>
        {successMessage && <p className="purchase-success-message" role="status">{successMessage}</p>}
        {isLoading ? (
          <div className="purchases-state" role="status">
            <span className="loading-spinner" />
            <span>{t('Loading purchases…')}</span>
          </div>
        ) : error ? (
          <div className="purchases-state purchases-state--error" role="alert">
            <AlertCircle size={20} aria-hidden="true" />
            <span>{error}</span>
            <button type="button" className="purchases-retry" onClick={() => setRetry((value) => value + 1)}>
              {t('Try again')}
            </button>
          </div>
        ) : page && page.data.length === 0 ? (
          <div className="purchases-state purchases-state--empty">
            <span className="purchases-empty-mark"><Eye size={21} aria-hidden="true" /></span>
            <strong>{t('No purchases found')}</strong>
            <span>{t('There are no purchases on this page.')}</span>
          </div>
        ) : page ? (
          <>
            <div className="purchases-table-scroll purchase-redesign__table-scroll">
              <table className="purchases-table purchase-redesign__table">
                <thead>
                  <tr>
                    <th>{t('Purchase Number')}</th>
                    <th>{t('Purchase Date')}</th>
                    <th>{t('Supplier')}</th>
                    <th>{t('Warehouse')}</th>
                    <th>{t('Invoice Number')}</th>
                    <th>{t('Currency')}</th>
                    <th className="purchases-table__numeric">{t('Grand Total')}</th>
                    <th>{t('Payment Status')}</th>
                    <th>{t('Purchase Status')}</th>
                    <th>{t('Created By')}</th>
                    <th>{t('Actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {page.data.map((purchase) => (
                    <tr key={purchase.id}>
                      <td><strong className="purchases-number">{purchase.purchaseNumber}</strong></td>
                      <td>{formatDate(purchase.purchaseDate, language)}</td>
                      <td>{purchase.supplier}</td>
                      <td>{purchase.warehouse}</td>
                      <td>{purchase.invoiceNumber || '—'}</td>
                      <td><span className="purchases-currency">{purchase.currency}</span></td>
                      <td className="purchases-table__numeric purchases-total">{formatAmount(purchase.grandTotal, purchase.currency, language)}</td>
                      <td><span className={`purchase-status purchase-status--${purchase.paymentStatus.toLowerCase()}`}>{t(statusLabel(purchase.paymentStatus))}</span></td>
                      <td><span className={`purchase-status purchase-status--${purchase.status.toLowerCase()}`}>{t(statusLabel(purchase.status))}</span></td>
                      <td>{purchase.createdBy}</td>
                      <td>
                        <button
                          className="purchase-view-button"
                          type="button"
                          onClick={() => setSelectedPurchase(purchase)}
                          aria-label={`${t('View details for')} ${purchase.purchaseNumber}`}
                        >
                          <Eye size={15} aria-hidden="true" />
                          <span>{t('Details')}</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <footer className="purchases-pagination purchase-redesign__pagination">
              <span>
                {t('Showing')} {new Intl.NumberFormat(language === 'ps' ? 'ps-AF' : 'en').format(startRecord)}–{new Intl.NumberFormat(language === 'ps' ? 'ps-AF' : 'en').format(endRecord)} {t('of')} {new Intl.NumberFormat(language === 'ps' ? 'ps-AF' : 'en').format(page.total)} {t('purchases')}
              </span>
              <div className="purchases-pagination__controls purchase-redesign__pagination-controls">
                <button
                  type="button"
                  onClick={() => setCurrentPage(page.currentPage - 1)}
                  disabled={isLoading || page.currentPage <= 1}
                  aria-label={t('Previous page')}
                >
                  <ChevronLeft size={16} aria-hidden="true" /> {t('Previous')}
                </button>
                <span>{t('Page')} <strong>{new Intl.NumberFormat(language === 'ps' ? 'ps-AF' : 'en').format(page.currentPage)}</strong> {t('of')} <strong>{new Intl.NumberFormat(language === 'ps' ? 'ps-AF' : 'en').format(page.lastPage)}</strong></span>
                <button
                  type="button"
                  onClick={() => setCurrentPage(page.currentPage + 1)}
                  disabled={isLoading || page.currentPage >= page.lastPage}
                  aria-label={t('Next page')}
                >
                  {t('Next')} <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            </footer>
          </>
        ) : null}
      </section>

      {selectedPurchase && (
        <div className="purchase-modal-backdrop purchase-redesign__backdrop">
          <section
            className="purchase-modal purchase-redesign__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="purchase-modal-title"
          >
            <header className="purchase-modal__header purchase-redesign__detail-heading">
              <div>
                <p className="overview-eyebrow">{t('PURCHASE DETAILS')}</p>
                <h2 id="purchase-modal-title">{selectedPurchase.purchaseNumber}</h2>
                <p>{formatDate(selectedPurchase.purchaseDate, language)}</p>
              </div>
              <button type="button" className="purchase-modal__close" aria-label={t('Close details')} onClick={() => setSelectedPurchase(null)}>
                <X size={19} aria-hidden="true" />
              </button>
            </header>

            <div className="purchase-modal__body purchase-redesign__detail-body">
              <dl className="purchase-detail-grid purchase-redesign__detail-grid">
                <div><dt>{t('Supplier')}</dt><dd>{selectedPurchase.supplier}</dd></div>
                <div><dt>{t('Warehouse')}</dt><dd>{selectedPurchase.warehouse}</dd></div>
                <div><dt>{t('Invoice Number')}</dt><dd>{selectedPurchase.invoiceNumber || '—'}</dd></div>
                <div><dt>{t('Currency')}</dt><dd>{selectedPurchase.currency}</dd></div>
                <div><dt>{t('Exchange Rate')}</dt><dd>{formatQuantity(selectedPurchase.exchangeRate, language)} AFN / {selectedPurchase.currency}</dd></div>
                <div><dt>{t('Payment Status')}</dt><dd>{t(statusLabel(selectedPurchase.paymentStatus))}</dd></div>
                <div><dt>{t('Purchase Status')}</dt><dd>{t(statusLabel(selectedPurchase.status))}</dd></div>
              </dl>

              <div className="purchase-items-heading purchase-redesign__items-heading">
                <h3>{t('Items')}</h3>
                <span>{new Intl.NumberFormat(language === 'ps' ? 'ps-AF' : 'en').format(selectedPurchase.items.length)} {selectedPurchase.items.length === 1 ? t('item') : t('items')}</span>
              </div>
              <div className="purchase-items-scroll purchase-redesign__items-scroll">
                <table className="purchase-items-table purchase-redesign__items-table">
                  <thead>
                    <tr><th>{t('Product')}</th><th>{t('Quantity')}</th><th>{t('Unit Cost')}</th><th>{t('Discount')}</th><th>{t('Line Total')}</th></tr>
                  </thead>
                  <tbody>
                    {selectedPurchase.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.product?.name || '—'}</strong>
                          {item.product?.sku && <small>{item.product.sku}</small>}
                        </td>
                        <td>{formatQuantity(item.quantity, language)}</td>
                        <td>{formatAmount(item.unitCost, selectedPurchase.currency, language)}</td>
                        <td>{formatAmount(item.discountAmount, selectedPurchase.currency, language)}</td>
                        <td><strong>{formatAmount(item.lineTotal, selectedPurchase.currency, language)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="purchase-totals purchase-redesign__totals">
                <div><span>{t('Subtotal')}</span><strong>{formatAmount(selectedPurchase.subtotal, selectedPurchase.currency, language)}</strong></div>
                <div><span>{t('Discount')}</span><strong>{formatAmount(selectedPurchase.discountAmount, selectedPurchase.currency, language)}</strong></div>
                <div className="purchase-totals__grand"><span>{t('Grand Total')}</span><strong>{formatAmount(selectedPurchase.grandTotal, selectedPurchase.currency, language)}</strong></div>
              </div>

              <div className="purchase-notes purchase-redesign__notes">
                <strong>{t('Notes')}</strong>
                <p>{selectedPurchase.notes || t('No notes provided.')}</p>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
