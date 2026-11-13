import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'

interface SelectOption {
  id: number
  label: string
  detail?: string
  active: boolean
}

interface ProductOption extends SelectOption {
  sku: string | null
  unit: string | null
}

interface CurrencyOption extends SelectOption {
  code: string
}

interface AccountOption extends SelectOption {
  accountType: string
  currencyId: number
}

interface PurchaseLine {
  key: number
  productId: string
  quantity: string
  unitCost: string
  discountAmount: string
  batchNumber: string
  expiryDate: string
}

interface PurchaseValues {
  purchaseNumber: string
  purchaseDate: string
  supplierId: string
  warehouseId: string
  currencyId: string
  exchangeRate: string
  invoiceNumber: string
  notes: string
  purchaseDiscount: string
}

type FieldErrors = Record<string, string>
type OptionState<T> = { data: T[]; loading: boolean; error: string | null }

const initialValues: PurchaseValues = {
  purchaseNumber: '',
  purchaseDate: new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10),
  supplierId: '',
  warehouseId: '',
  currencyId: '',
  exchangeRate: '',
  invoiceNumber: '',
  notes: '',
  purchaseDiscount: '0',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseId(value: unknown, label: string): number {
  const id = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isInteger(id) || id <= 0) throw new Error(`The server returned an invalid ${label}.`)
  return id
}

function parseNumber(value: string): number {
  if (!value.trim()) return NaN
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : NaN
}

function rounded4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000
}

function localErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const body: unknown = error.response?.data
    if (isRecord(body) && typeof body.message === 'string') return body.message
    if (!error.response) return 'Could not connect to the server. Check your connection and try again.'
  }
  if (error instanceof Error) return error.message
  return 'The requested data could not be loaded. Please try again.'
}

function parsePaginatedResponse(value: unknown): { records: unknown[]; lastPage: number } {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error('The server returned an unexpected list response.')
  }

  let paginator = value.data
  if (!Array.isArray(paginator.data) && isRecord(paginator.data)) {
    paginator = paginator.data
  }

  if (!Array.isArray(paginator.data)) {
    throw new Error('The server response did not contain a paginated list.')
  }

  const lastPage = Number(paginator.last_page)
  if (!Number.isInteger(lastPage) || lastPage < 1) {
    throw new Error('The server returned invalid pagination information.')
  }

  return { records: paginator.data, lastPage }
}

async function fetchAllPages(
  url: string,
  params: Record<string, string | number>,
  signal: AbortSignal,
): Promise<unknown[]> {
  const allRecords: unknown[] = []
  let page = 1
  let lastPage = 1

  do {
    const { data } = await api.get<unknown>(url, {
      params: { ...params, page },
      signal,
    })
    const result = parsePaginatedResponse(data)
    allRecords.push(...result.records)
    lastPage = result.lastPage
    page += 1
  } while (page <= lastPage)

  return allRecords
}

function parseSupplier(value: unknown): SelectOption {
  if (!isRecord(value)) throw new Error('The supplier list contains an invalid entry.')
  const id = parseId(value.id, 'supplier ID')
  const name = typeof value.business_name === 'string' && value.business_name.trim()
    ? value.business_name
    : value.name
  if (typeof name !== 'string' || typeof value.is_active !== 'boolean') {
    throw new Error('The supplier list is missing required supplier details.')
  }
  return { id, label: name, active: value.is_active }
}

function parseWarehouse(value: unknown): SelectOption {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.is_active !== 'boolean') {
    throw new Error('The warehouse list contains an incomplete entry.')
  }
  return { id: parseId(value.id, 'warehouse ID'), label: value.name, active: value.is_active }
}

function parseProduct(value: unknown): ProductOption {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.is_active !== 'boolean') {
    throw new Error('The product list contains an incomplete entry.')
  }
  return {
    id: parseId(value.id, 'product ID'),
    label: value.name,
    active: value.is_active,
    sku: typeof value.sku === 'string' && value.sku.trim() ? value.sku : null,
    unit: typeof value.unit === 'string' && value.unit.trim() ? value.unit : null,
  }
}

function parseCurrency(value: unknown): CurrencyOption {
  if (
    !isRecord(value) ||
    typeof value.code !== 'string' ||
    typeof value.is_active !== 'boolean'
  ) {
    throw new Error('The currency list contains an incomplete entry.')
  }
  return {
    id: parseId(value.id, 'currency ID'),
    label: typeof value.name === 'string' ? `${value.code} — ${value.name}` : value.code,
    code: value.code,
    active: value.is_active,
  }
}

function parseAccount(value: unknown): AccountOption {
  if (
    !isRecord(value) ||
    typeof value.name !== 'string' ||
    typeof value.account_type !== 'string' ||
    !isRecord(value.currency)
  ) {
    throw new Error('The financial account list contains an incomplete entry.')
  }
  return {
    id: parseId(value.id, 'financial account ID'),
    label: value.name,
    accountType: value.account_type,
    currencyId: parseId(value.currency.id, 'account currency ID'),
    active: true,
  }
}

function formatCurrency(value: number, currencyCode: string): string {
  if (!currencyCode) return '—'
  return `${new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value)} ${currencyCode}`
}

function makeLine(key: number): PurchaseLine {
  return {
    key,
    productId: '',
    quantity: '',
    unitCost: '',
    discountAmount: '0',
    batchNumber: '',
    expiryDate: '',
  }
}

function getValidationErrors(error: unknown, lines: PurchaseLine[]): {
  fields: FieldErrors
  general: string | null
} {
  if (!axios.isAxiosError(error)) {
    return { fields: {}, general: localErrorMessage(error) }
  }

  const body: unknown = error.response?.data
  if (!isRecord(body)) return { fields: {}, general: localErrorMessage(error) }

  const fields: FieldErrors = {}
  if (isRecord(body.errors)) {
    for (const [serverField, messages] of Object.entries(body.errors)) {
      if (!Array.isArray(messages) || typeof messages[0] !== 'string') continue
      const itemMatch = /^items\.(\d+)\.(\w+)$/.exec(serverField)
      const topLevelField: Record<string, string> = {
        purchase_number: 'purchaseNumber',
        purchase_date: 'purchaseDate',
        business_partner_id: 'supplierId',
        warehouse_id: 'warehouseId',
        currency_id: 'currencyId',
        exchange_rate_to_afn: 'exchangeRate',
        invoice_number: 'invoiceNumber',
        discount_amount: 'purchaseDiscount',
        financial_account_id: 'financialAccountId',
      }
      const field = itemMatch
        ? `item.${lines[Number(itemMatch[1])]?.key ?? itemMatch[1]}.${itemMatch[2]}`
        : topLevelField[serverField] ?? serverField
      fields[field] = messages[0]
    }
  }

  return {
    fields,
    general: Object.keys(fields).length === 0 && typeof body.message === 'string'
      ? body.message
      : null,
  }
}

export default function CreatePurchase() {
  const navigate = useNavigate()
  const nextLineKey = useRef(1)
  const [values, setValues] = useState(initialValues)
  const [lines, setLines] = useState<PurchaseLine[]>([makeLine(0)])
  const [supplierSearch, setSupplierSearch] = useState('')
  const [suppliers, setSuppliers] = useState<OptionState<SelectOption>>({ data: [], loading: true, error: null })
  const [warehouses, setWarehouses] = useState<OptionState<SelectOption>>({ data: [], loading: true, error: null })
  const [products, setProducts] = useState<OptionState<ProductOption>>({ data: [], loading: true, error: null })
  const [currencies, setCurrencies] = useState<OptionState<CurrencyOption>>({ data: [], loading: true, error: null })
  const [accounts, setAccounts] = useState<OptionState<AccountOption>>({ data: [], loading: false, error: null })
  const [accountsRetry, setAccountsRetry] = useState(0)
  const [paymentType, setPaymentType] = useState<'credit' | 'cash'>('credit')
  const [financialAccountId, setFinancialAccountId] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [optionsRetry, setOptionsRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const signal = controller.signal

    async function loadOptions<T>(
      url: string,
      params: Record<string, string | number>,
      parse: (value: unknown) => T,
      update: (state: OptionState<T>) => void,
      activeOnly: boolean,
    ) {
      update({ data: [], loading: true, error: null })
      try {
        const values = await fetchAllPages(url, params, signal)
        const options = values.map(parse)
        update({
          data: activeOnly
            ? options.filter((option) => isRecord(option) && option.active === true)
            : options,
          loading: false,
          error: null,
        })
      } catch (error: unknown) {
        if (!signal.aborted) {
          update({ data: [], loading: false, error: localErrorMessage(error) })
        }
      }
    }

    void Promise.all([
      loadOptions('/api/business-partners', { partner_type: 'Supplier' }, parseSupplier, setSuppliers, true),
      loadOptions('/api/warehouses', { is_active: 'true', per_page: 100 }, parseWarehouse, setWarehouses, true),
      loadOptions('/api/products', { is_active: 'true', per_page: 100 }, parseProduct, setProducts, true),
      loadOptions('/api/currencies', { is_active: 'true', per_page: 100 }, parseCurrency, setCurrencies, true),
    ])

    return () => controller.abort()
  }, [optionsRetry])

  const selectedCurrency = currencies.data.find((currency) => String(currency.id) === values.currencyId)
  const isAfn = selectedCurrency?.code.toUpperCase() === 'AFN'

  useEffect(() => {
    if (paymentType !== 'cash' || !values.currencyId) {
      setAccounts({ data: [], loading: false, error: null })
      return
    }

    const controller = new AbortController()
    setAccounts({ data: [], loading: true, error: null })
    setFinancialAccountId('')

    api.get<unknown>('/api/financial-accounts/balances', {
      params: { currency_id: values.currencyId },
      signal: controller.signal,
    }).then(({ data }) => {
      if (!isRecord(data) || !Array.isArray(data.data)) {
        throw new Error('The financial account response was not in the expected format.')
      }
      const matchingAccounts = data.data
        .map(parseAccount)
        .filter((account) => account.currencyId === Number(values.currencyId) && account.active)
      setAccounts({ data: matchingAccounts, loading: false, error: null })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setAccounts({ data: [], loading: false, error: localErrorMessage(error) })
      }
    })

    return () => controller.abort()
  }, [accountsRetry, paymentType, values.currencyId])

  const lineTotals = useMemo(() => lines.map((line) => {
    const quantity = parseNumber(line.quantity)
    const unitCost = parseNumber(line.unitCost)
    const itemDiscount = parseNumber(line.discountAmount)
    const gross = Number.isFinite(quantity) && Number.isFinite(unitCost)
      ? rounded4(quantity * unitCost)
      : 0
    return {
      key: line.key,
      gross,
      discount: Number.isFinite(itemDiscount) ? rounded4(itemDiscount) : 0,
      total: rounded4(gross - (Number.isFinite(itemDiscount) ? itemDiscount : 0)),
    }
  }), [lines])

  const subtotal = rounded4(lineTotals.reduce((sum, line) => sum + line.gross, 0))
  const itemDiscountTotal = rounded4(lineTotals.reduce((sum, line) => sum + line.discount, 0))
  const beforePurchaseDiscount = rounded4(lineTotals.reduce((sum, line) => sum + line.total, 0))
  const purchaseDiscountValue = parseNumber(values.purchaseDiscount)
  const purchaseDiscount = Number.isFinite(purchaseDiscountValue) ? rounded4(purchaseDiscountValue) : 0
  const grandTotal = rounded4(beforePurchaseDiscount - purchaseDiscount)

  const filteredSuppliers = suppliers.data.filter((supplier) =>
    supplier.label.toLowerCase().includes(supplierSearch.trim().toLowerCase()),
  )

  const setField = (field: keyof PurchaseValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => {
      const next = { ...current }
      delete next[field]
      return next
    })
    setGeneralError(null)
  }

  const updateLine = (key: number, field: keyof Omit<PurchaseLine, 'key'>, value: string) => {
    setLines((current) => current.map((line) => line.key === key ? { ...line, [field]: value } : line))
    setErrors((current) => {
      const next = { ...current }
      delete next[`item.${key}.${field === 'productId' ? 'product_id' : field === 'unitCost' ? 'unit_cost' : field === 'discountAmount' ? 'discount_amount' : field === 'batchNumber' ? 'batch_number' : field === 'expiryDate' ? 'expiry_date' : field}`]
      return next
    })
    setGeneralError(null)
  }

  const addLine = () => {
    setLines((current) => [...current, makeLine(nextLineKey.current++)])
  }

  const removeLine = (key: number) => {
    setLines((current) => current.length > 1 ? current.filter((line) => line.key !== key) : current)
    setErrors((current) => {
      const next = { ...current }
      Object.keys(next).filter((field) => field.startsWith(`item.${key}.`)).forEach((field) => delete next[field])
      return next
    })
  }

  const onCurrencyChange = (currencyId: string) => {
    const currency = currencies.data.find((item) => String(item.id) === currencyId)
    setField('currencyId', currencyId)
    setValues((current) => ({
      ...current,
      exchangeRate: currency?.code.toUpperCase() === 'AFN' ? '1' : '',
    }))
    setFinancialAccountId('')
  }

  const validate = (): FieldErrors => {
    const next: FieldErrors = {}
    if (!values.purchaseNumber.trim()) next.purchaseNumber = 'Purchase number is required.'
    if (values.purchaseNumber.length > 50) next.purchaseNumber = 'Purchase number must be 50 characters or fewer.'
    if (!values.purchaseDate) next.purchaseDate = 'Purchase date is required.'
    if (!values.supplierId) next.supplierId = 'Select a supplier.'
    if (!values.warehouseId) next.warehouseId = 'Select a warehouse.'
    if (!values.currencyId) next.currencyId = 'Select a currency.'
    const exchangeRate = parseNumber(values.exchangeRate)
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0 || exchangeRate > 999_999_999_999) {
      next.exchangeRate = 'Enter a positive exchange rate within the allowed range.'
    } else if (isAfn && exchangeRate !== 1) {
      next.exchangeRate = 'The AFN exchange rate must be 1.'
    }
    if (lines.length === 0) next.items = 'Add at least one product.'

    const selectedProductIds = lines.map((line) => line.productId).filter(Boolean)
    if (new Set(selectedProductIds).size !== selectedProductIds.length) {
      next.items = 'A product can only be selected once.'
    }

    let beforeDiscount = 0
    for (const line of lines) {
      const quantity = parseNumber(line.quantity)
      const unitCost = parseNumber(line.unitCost)
      const itemDiscount = parseNumber(line.discountAmount)
      const prefix = `item.${line.key}.`
      if (!line.productId) next[`${prefix}product_id`] = 'Select a product.'
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 999_999_999_999) {
        next[`${prefix}quantity`] = 'Quantity must be greater than zero and within the allowed range.'
      }
      if (!Number.isFinite(unitCost) || unitCost < 0 || unitCost > 999_999_999_999) {
        next[`${prefix}unit_cost`] = 'Unit cost must be zero or greater and within the allowed range.'
      }
      if (!Number.isFinite(itemDiscount) || itemDiscount < 0) next[`${prefix}discount_amount`] = 'Discount must be zero or greater.'
      if (Number.isFinite(quantity) && quantity > 0 && Number.isFinite(unitCost) && unitCost >= 0) {
        const gross = rounded4(quantity * unitCost)
        if (Number.isFinite(itemDiscount) && itemDiscount > gross) {
          next[`${prefix}discount_amount`] = 'Discount cannot exceed this item’s gross amount.'
        } else {
          beforeDiscount += rounded4(gross - (Number.isFinite(itemDiscount) ? itemDiscount : 0))
        }
      }
      if (
        line.expiryDate &&
        values.purchaseDate &&
        line.expiryDate < values.purchaseDate
      ) {
        next[`${prefix}expiry_date`] = 'Expiry date cannot be before the purchase date.'
      }
    }

    const purchaseDiscount = parseNumber(values.purchaseDiscount)
    if (!Number.isFinite(purchaseDiscount) || purchaseDiscount < 0) {
      next.purchaseDiscount = 'Purchase discount must be zero or greater.'
    } else if (purchaseDiscount > rounded4(beforeDiscount)) {
      next.purchaseDiscount = 'Purchase discount cannot exceed the total after item discounts.'
    }
    if (paymentType === 'cash') {
      if (!values.currencyId) next.currencyId = 'Select a currency before choosing a cash account.'
      if (accounts.loading) next.financialAccountId = 'Wait for financial accounts to load.'
      else if (accounts.error) next.financialAccountId = 'Resolve the financial account loading error.'
      else if (accounts.data.length === 0) next.financialAccountId = 'No active account is available for this currency.'
      else if (!financialAccountId) next.financialAccountId = 'Select a financial account.'
    }
    return next
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSaving) return

    const validationErrors = validate()
    setErrors(validationErrors)
    setGeneralError(null)
    if (Object.keys(validationErrors).length > 0) {
      setGeneralError('Review the highlighted fields before saving.')
      return
    }

    setIsSaving(true)
    try {
      await api.post('/api/purchases', {
        purchase_number: values.purchaseNumber.trim(),
        business_partner_id: Number(values.supplierId),
        warehouse_id: Number(values.warehouseId),
        currency_id: Number(values.currencyId),
        purchase_date: values.purchaseDate,
        invoice_number: values.invoiceNumber.trim() || null,
        exchange_rate_to_afn: Number(values.exchangeRate),
        discount_amount: rounded4(purchaseDiscount),
        notes: values.notes.trim() || null,
        items: lines.map((line) => ({
          product_id: Number(line.productId),
          quantity: Number(line.quantity),
          unit_cost: Number(line.unitCost),
          discount_amount: rounded4(Number(line.discountAmount || 0)),
          batch_number: line.batchNumber.trim() || null,
          expiry_date: line.expiryDate || null,
        })),
        payment_type: paymentType,
        ...(paymentType === 'cash' ? { financial_account_id: Number(financialAccountId) } : {}),
      })
      navigate('/secretary/purchases', {
        replace: true,
        state: { purchaseCreated: true },
      })
    } catch (error: unknown) {
      const result = getValidationErrors(error, lines)
      setErrors(result.fields)
      setGeneralError(result.general)
    } finally {
      setIsSaving(false)
    }
  }

  const accountError = errors.financialAccountId

  return (
    <div className="purchases-page create-purchase-page">
      <header className="purchases-heading">
        <div>
          <h1>Create Purchase</h1>
        </div>
        <button className="overview-refresh" type="button" onClick={() => navigate('/secretary/purchases')}>
          Cancel
        </button>
      </header>

      <form className="create-purchase-form" onSubmit={(event) => void submit(event)} noValidate>
        {generalError && <p className="create-purchase-alert" role="alert">{generalError}</p>}
        <div className="create-purchase-main">
          <section className="purchase-form-section">
            <header className="purchase-form-section__heading">
              <h2>Purchase Information</h2>
            </header>

            <div className="purchase-form-grid">
            <label className="purchase-field">
              <span>Purchase Number <i>*</i></span>
              <input
                value={values.purchaseNumber}
                onChange={(event) => setField('purchaseNumber', event.target.value)}
                maxLength={50}
                autoComplete="off"
                aria-invalid={Boolean(errors.purchaseNumber)}
              />
              {errors.purchaseNumber && <small className="purchase-field__error">{errors.purchaseNumber}</small>}
            </label>

            <label className="purchase-field">
              <span>Purchase Date <i>*</i></span>
              <input
                type="date"
                value={values.purchaseDate}
                onChange={(event) => setField('purchaseDate', event.target.value)}
                aria-invalid={Boolean(errors.purchaseDate)}
              />
              {errors.purchaseDate && <small className="purchase-field__error">{errors.purchaseDate}</small>}
            </label>

            <div className="purchase-field purchase-field--supplier">
              <label htmlFor="supplier-search"><span>Supplier <i>*</i></span></label>
              <input
                id="supplier-search"
                type="search"
                placeholder="Search active suppliers"
                value={supplierSearch}
                onChange={(event) => setSupplierSearch(event.target.value)}
                disabled={suppliers.loading || Boolean(suppliers.error)}
              />
              <select
                value={values.supplierId}
                onChange={(event) => setField('supplierId', event.target.value)}
                disabled={suppliers.loading || Boolean(suppliers.error)}
                aria-label="Supplier"
                aria-invalid={Boolean(errors.supplierId)}
              >
                <option value="">
                  {suppliers.loading
                    ? 'Loading suppliers…'
                    : suppliers.data.length === 0
                      ? 'No active suppliers available'
                      : 'Select supplier'}
                </option>
                {filteredSuppliers.map((supplier) => (
                  <option value={supplier.id} key={supplier.id}>{supplier.label}</option>
                ))}
              </select>
              {suppliers.error ? (
                <small className="purchase-field__error">
                  {suppliers.error} <button type="button" onClick={() => setOptionsRetry((value) => value + 1)}>Retry</button>
                </small>
              ) : errors.supplierId ? <small className="purchase-field__error">{errors.supplierId}</small> : null}
            </div>

            <div className="purchase-field">
              <label htmlFor="purchase-warehouse"><span>Warehouse <i>*</i></span></label>
              <select
                id="purchase-warehouse"
                value={values.warehouseId}
                onChange={(event) => setField('warehouseId', event.target.value)}
                disabled={warehouses.loading || Boolean(warehouses.error)}
                aria-invalid={Boolean(errors.warehouseId)}
              >
                <option value="">
                  {warehouses.loading
                    ? 'Loading warehouses…'
                    : warehouses.data.length === 0
                      ? 'No active warehouses available'
                      : 'Select warehouse'}
                </option>
                {warehouses.data.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.label}</option>)}
              </select>
              {warehouses.error ? (
                <small className="purchase-field__error">
                  {warehouses.error} <button type="button" onClick={() => setOptionsRetry((value) => value + 1)}>Retry</button>
                </small>
              ) : errors.warehouseId ? <small className="purchase-field__error">{errors.warehouseId}</small> : null}
            </div>

            <div className="purchase-field">
              <label htmlFor="purchase-currency"><span>Currency <i>*</i></span></label>
              <select
                id="purchase-currency"
                value={values.currencyId}
                onChange={(event) => onCurrencyChange(event.target.value)}
                disabled={currencies.loading || Boolean(currencies.error)}
                aria-invalid={Boolean(errors.currencyId)}
              >
                <option value="">
                  {currencies.loading
                    ? 'Loading currencies…'
                    : currencies.data.length === 0
                      ? 'No active currencies available'
                      : 'Select currency'}
                </option>
                {currencies.data.map((currency) => <option value={currency.id} key={currency.id}>{currency.label}</option>)}
              </select>
              {currencies.error ? (
                <small className="purchase-field__error">
                  {currencies.error} <button type="button" onClick={() => setOptionsRetry((value) => value + 1)}>Retry</button>
                </small>
              ) : errors.currencyId ? <small className="purchase-field__error">{errors.currencyId}</small> : null}
            </div>

            <label className="purchase-field">
              <span>Exchange Rate to AFN <i>*</i></span>
              <input
                type="number"
                min="0"
                step="any"
                value={values.exchangeRate}
                onChange={(event) => setField('exchangeRate', event.target.value)}
                disabled={!values.currencyId || isAfn}
                placeholder={isAfn ? '1' : 'Enter rate'}
                aria-invalid={Boolean(errors.exchangeRate)}
              />
              {errors.exchangeRate
                ? <small className="purchase-field__error">{errors.exchangeRate}</small>
                : <small className="purchase-field__hint">{isAfn ? 'AFN base currency rate is fixed at 1.' : 'Enter the current rate; no rate is assumed.'}</small>}
            </label>

            <label className="purchase-field">
              <span>Invoice Number</span>
              <input
                value={values.invoiceNumber}
                onChange={(event) => setField('invoiceNumber', event.target.value)}
                maxLength={100}
              />
            </label>

            </div>
          </section>

          <section className="purchase-form-section">
            <header className="purchase-form-section__heading purchase-form-section__heading--actions">
              <h2>Purchase Items</h2>
              <button type="button" className="purchase-add-item" onClick={addLine} disabled={products.loading}>
                + Add Item
              </button>
            </header>

            {products.error && (
              <div className="purchase-options-error" role="alert">
                {products.error}
                <button type="button" onClick={() => setOptionsRetry((value) => value + 1)}>Retry</button>
              </div>
            )}

            <div className="purchase-items-scroll purchase-items-scroll--form">
              <table className="purchase-entry-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Quantity</th>
                    <th>Unit Cost</th>
                    <th>Discount</th>
                    <th>Batch</th>
                    <th>Expiry</th>
                    <th>Total</th>
                    <th><span className="visually-hidden">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const duplicateIds = new Set(lines.filter((other) => other.key !== line.key).map((other) => other.productId))
                    const totals = lineTotals.find((total) => total.key === line.key)
                    const keyPrefix = `item.${line.key}.`
                    return (
                      <tr key={line.key}>
                        <td>
                          <select
                            value={line.productId}
                            onChange={(event) => updateLine(line.key, 'productId', event.target.value)}
                            disabled={products.loading || Boolean(products.error)}
                            aria-label="Product"
                            aria-invalid={Boolean(errors[`${keyPrefix}product_id`])}
                          >
                            <option value="">
                              {products.loading ? 'Loading…' : products.data.length === 0 ? 'No products' : 'Select product'}
                            </option>
                            {products.data
                              .filter((product) => !duplicateIds.has(String(product.id)) || String(product.id) === line.productId)
                              .map((product) => (
                                <option value={product.id} key={product.id}>
                                  {product.label}{product.sku ? ` · ${product.sku}` : ''}{product.unit ? ` (${product.unit})` : ''}
                                </option>
                              ))}
                          </select>
                          {errors[`${keyPrefix}product_id`] && <small className="purchase-field__error">{errors[`${keyPrefix}product_id`]}</small>}
                        </td>
                        <td>
                          <input type="number" min="0" step="any" value={line.quantity} onChange={(event) => updateLine(line.key, 'quantity', event.target.value)} aria-label="Quantity" aria-invalid={Boolean(errors[`${keyPrefix}quantity`])} />
                          {errors[`${keyPrefix}quantity`] && <small className="purchase-field__error">{errors[`${keyPrefix}quantity`]}</small>}
                        </td>
                        <td>
                          <input type="number" min="0" step="any" value={line.unitCost} onChange={(event) => updateLine(line.key, 'unitCost', event.target.value)} aria-label="Unit cost" aria-invalid={Boolean(errors[`${keyPrefix}unit_cost`])} />
                          {errors[`${keyPrefix}unit_cost`] && <small className="purchase-field__error">{errors[`${keyPrefix}unit_cost`]}</small>}
                        </td>
                        <td>
                          <input type="number" min="0" step="any" value={line.discountAmount} onChange={(event) => updateLine(line.key, 'discountAmount', event.target.value)} aria-label="Item discount" aria-invalid={Boolean(errors[`${keyPrefix}discount_amount`])} />
                          {errors[`${keyPrefix}discount_amount`] && <small className="purchase-field__error">{errors[`${keyPrefix}discount_amount`]}</small>}
                        </td>
                        <td>
                          <input value={line.batchNumber} onChange={(event) => updateLine(line.key, 'batchNumber', event.target.value)} maxLength={100} aria-label="Batch number (optional)" />
                          {errors[`${keyPrefix}batch_number`] && <small className="purchase-field__error">{errors[`${keyPrefix}batch_number`]}</small>}
                        </td>
                        <td>
                          <input type="date" min={values.purchaseDate} value={line.expiryDate} onChange={(event) => updateLine(line.key, 'expiryDate', event.target.value)} aria-label="Expiry date (optional)" aria-invalid={Boolean(errors[`${keyPrefix}expiry_date`])} />
                          {errors[`${keyPrefix}expiry_date`] && <small className="purchase-field__error">{errors[`${keyPrefix}expiry_date`]}</small>}
                        </td>
                        <td className="purchase-entry-total">
                          <strong>{formatCurrency(totals?.total ?? 0, selectedCurrency?.code ?? '')}</strong>
                          <small>Gross {formatCurrency(totals?.gross ?? 0, selectedCurrency?.code ?? '')}</small>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="purchase-remove-item"
                            onClick={() => removeLine(line.key)}
                            disabled={lines.length === 1}
                            aria-label="Remove item"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {errors.items && <p className="purchase-field__error purchase-form-error">{errors.items}</p>}
          </section>
        </div>

        <section className="purchase-form-section purchase-payment-summary">
          <header className="purchase-form-section__heading"><h2>Payment &amp; Summary</h2></header>
          <div className="purchase-payment-options">
            <label className={`purchase-payment-option${paymentType === 'credit' ? ' purchase-payment-option--selected' : ''}`}>
              <input type="radio" name="payment-type" value="credit" checked={paymentType === 'credit'} onChange={() => {
                setPaymentType('credit')
                setFinancialAccountId('')
                setErrors((current) => { const next = { ...current }; delete next.financialAccountId; return next })
              }} />
              <span>Credit</span>
            </label>
            <label className={`purchase-payment-option${paymentType === 'cash' ? ' purchase-payment-option--selected' : ''}`}>
              <input type="radio" name="payment-type" value="cash" checked={paymentType === 'cash'} onChange={() => setPaymentType('cash')} />
              <span>Cash</span>
            </label>
          </div>

          {paymentType === 'cash' && (
            <div className="purchase-account-select">
              <label className="purchase-field">
                <span>Financial Account <i>*</i></span>
                <select
                  value={financialAccountId}
                  onChange={(event) => {
                    setFinancialAccountId(event.target.value)
                    setErrors((current) => { const next = { ...current }; delete next.financialAccountId; return next })
                  }}
                  disabled={!values.currencyId || accounts.loading || Boolean(accounts.error) || accounts.data.length === 0}
                  aria-invalid={Boolean(accountError)}
                >
                  <option value="">
                    {!values.currencyId ? 'Select a currency first' : accounts.loading ? 'Loading accounts…' : 'Select account'}
                  </option>
                  {accounts.data.map((account) => (
                    <option value={account.id} key={account.id}>{account.label} · {account.accountType}</option>
                  ))}
                </select>
                {accounts.loading && <small className="purchase-field__hint">Loading accounts…</small>}
                {accounts.error && (
                  <small className="purchase-field__error">
                    {accounts.error}
                    <button type="button" onClick={() => setAccountsRetry((value) => value + 1)}>Retry</button>
                  </small>
                )}
                {!accounts.loading && !accounts.error && values.currencyId && accounts.data.length === 0 && (
                  <small className="purchase-field__error">No active account for this currency.</small>
                )}
                {accountError && <small className="purchase-field__error">{accountError}</small>}
              </label>
            </div>
          )}

          <label className="purchase-field purchase-notes-field">
            <span>Notes <small>(optional)</small></span>
            <textarea
              value={values.notes}
              onChange={(event) => setField('notes', event.target.value)}
              maxLength={5000}
              rows={2}
            />
          </label>

          <div className="purchase-summary-panel">
            <div className="purchase-summary-row"><span>Subtotal</span><strong>{formatCurrency(subtotal, selectedCurrency?.code ?? '')}</strong></div>
            <div className="purchase-summary-row"><span>Item discounts</span><strong>− {formatCurrency(itemDiscountTotal, selectedCurrency?.code ?? '')}</strong></div>
            <label className="purchase-summary-row purchase-summary-row--discount">
              <span>Purchase discount</span>
              <span className="purchase-summary-input-wrap">
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={values.purchaseDiscount}
                  onChange={(event) => setField('purchaseDiscount', event.target.value)}
                  aria-label="Purchase-level discount"
                  aria-invalid={Boolean(errors.purchaseDiscount)}
                />
                <small>{selectedCurrency?.code ?? ''}</small>
              </span>
            </label>
            {errors.purchaseDiscount && <small className="purchase-field__error">{errors.purchaseDiscount}</small>}
            <div className="purchase-summary-row purchase-summary-row--grand"><span>Grand Total</span><strong>{formatCurrency(grandTotal, selectedCurrency?.code ?? '')}</strong></div>
          </div>

          {errors.items && <small className="purchase-field__error">{errors.items}</small>}
          <div className="purchase-form-actions">
            <button type="button" className="purchase-cancel-button" onClick={() => navigate('/secretary/purchases')} disabled={isSaving}>Cancel</button>
            <button type="submit" className="purchase-save-button" disabled={isSaving}>
              {isSaving ? 'Saving…' : 'Save Purchase'}
            </button>
          </div>
        </section>
      </form>
    </div>
  )
}
