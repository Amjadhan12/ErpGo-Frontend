import { useEffect, useState } from 'react'
import axios from 'axios'
import { api } from '@/lib/api'

interface Supplier {
  id: number
  name: string
  isActive: boolean
}

interface Currency {
  id: number
  code: string
  name: string
  isActive: boolean
}

interface FinancialAccount {
  id: number
  name: string
  accountType: string
  currencyId: number
  isActive: boolean
}

interface SupplierPayment {
  id: number
  paymentNumber: string
  paymentDate: string
  supplier: string
  account: string
  accountType: string
  currency: string
  amount: number
  exchangeRate: number
  createdBy: string
  notes: string | null
}

interface PaymentPage {
  data: SupplierPayment[]
  currentPage: number
  lastPage: number
  perPage: number
  total: number
}

interface PaymentForm {
  paymentNumber: string
  supplierId: string
  currencyId: string
  accountId: string
  amount: string
  exchangeRate: string
  paymentDate: string
  notes: string
}

type FieldErrors = Record<string, string>

const emptyForm: PaymentForm = {
  paymentNumber: '',
  supplierId: '',
  currencyId: '',
  accountId: '',
  amount: '',
  exchangeRate: '',
  paymentDate: new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10),
  notes: '',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseId(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`The server returned an invalid ${label}.`)
  return parsed
}

function parseAmount(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(parsed)) throw new Error(`The server returned an invalid ${label}.`)
  return parsed
}

function parsePaginatedOptions(value: unknown): { records: unknown[]; lastPage: number } {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error('The option list response was not in the expected format.')
  }
  const paginator = value.data
  const lastPage = Number(paginator.last_page)
  if (!Array.isArray(paginator.data) || !Number.isInteger(lastPage) || lastPage < 1) {
    throw new Error('The option list did not contain paginated records.')
  }
  return { records: paginator.data, lastPage }
}

async function loadAllOptions(
  url: string,
  params: Record<string, string | number>,
  signal: AbortSignal,
): Promise<unknown[]> {
  const options: unknown[] = []
  let page = 1
  let lastPage = 1
  do {
    const { data } = await api.get<unknown>(url, {
      params: { ...params, page },
      signal,
    })
    const result = parsePaginatedOptions(data)
    options.push(...result.records)
    lastPage = result.lastPage
    page += 1
  } while (page <= lastPage)
  return options
}

function parseSupplier(value: unknown): Supplier {
  if (
    !isRecord(value) ||
    typeof value.name !== 'string' ||
    typeof value.is_active !== 'boolean'
  ) {
    throw new Error('The supplier list contains an incomplete record.')
  }
  const name = typeof value.business_name === 'string' && value.business_name.trim()
    ? value.business_name
    : value.name
  return { id: parseId(value.id, 'supplier ID'), name, isActive: value.is_active }
}

function parseCurrency(value: unknown): Currency {
  if (
    !isRecord(value) ||
    typeof value.code !== 'string' ||
    typeof value.is_active !== 'boolean'
  ) {
    throw new Error('The currency list contains an incomplete record.')
  }
  return {
    id: parseId(value.id, 'currency ID'),
    code: value.code,
    name: typeof value.name === 'string' ? value.name : value.code,
    isActive: value.is_active,
  }
}

function parseAccount(value: unknown): FinancialAccount {
  if (
    !isRecord(value) ||
    typeof value.name !== 'string' ||
    typeof value.account_type !== 'string' ||
    !isRecord(value.currency)
  ) {
    throw new Error('The financial account list contains an incomplete record.')
  }
  return {
    id: parseId(value.id, 'financial account ID'),
    name: value.name,
    accountType: value.account_type,
    currencyId: parseId(value.currency.id, 'account currency ID'),
    isActive: true,
  }
}

function relationText(value: unknown, field: string): string {
  return isRecord(value) && typeof value[field] === 'string' && value[field].trim()
    ? value[field]
    : '—'
}

function parsePayment(value: unknown): SupplierPayment {
  if (!isRecord(value) || !isRecord(value.currency) || !isRecord(value.financial_account)) {
    throw new Error('The supplier payment response is missing related account or currency data.')
  }
  if (
    typeof value.payment_number !== 'string' ||
    typeof value.payment_date !== 'string' ||
    typeof value.currency.code !== 'string'
  ) {
    throw new Error('The supplier payment response is missing its number, date, or currency.')
  }
  return {
    id: parseId(value.id, 'payment ID'),
    paymentNumber: value.payment_number,
    paymentDate: value.payment_date,
    supplier: relationText(value.supplier, 'business_name') !== '—'
      ? relationText(value.supplier, 'business_name')
      : relationText(value.supplier, 'name'),
    account: relationText(value.financial_account, 'name'),
    accountType: relationText(value.financial_account, 'account_type'),
    currency: value.currency.code,
    amount: parseAmount(value.amount, 'payment amount'),
    exchangeRate: parseAmount(value.exchange_rate_to_afn, 'exchange rate'),
    createdBy: relationText(value.creator, 'name'),
    notes: typeof value.notes === 'string' && value.notes.trim() ? value.notes : null,
  }
}

function parsePaymentPage(value: unknown): PaymentPage {
  if (
    !isRecord(value) ||
    !Array.isArray(value.data) ||
    !Number.isInteger(value.current_page) ||
    !Number.isInteger(value.last_page) ||
    !Number.isInteger(value.per_page) ||
    !Number.isInteger(value.total)
  ) {
    throw new Error('The supplier payment list did not contain valid pagination data.')
  }
  return {
    data: value.data.map(parsePayment),
    currentPage: value.current_page as number,
    lastPage: value.last_page as number,
    perPage: value.per_page as number,
    total: value.total as number,
  }
}

function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const body: unknown = error.response?.data
    if (isRecord(body) && typeof body.message === 'string') return body.message
    if (!error.response) return 'Could not connect to the server. Check your connection and try again.'
  }
  return error instanceof Error ? error.message : 'The request could not be completed.'
}

function validationMessages(error: unknown): { fields: FieldErrors; message: string | null } {
  if (!axios.isAxiosError(error) || !isRecord(error.response?.data)) {
    return { fields: {}, message: errorMessage(error) }
  }
  const body = error.response.data
  const fieldMap: Record<string, string> = {
    payment_number: 'paymentNumber',
    business_partner_id: 'supplierId',
    financial_account_id: 'accountId',
    currency_id: 'currencyId',
    exchange_rate_to_afn: 'exchangeRate',
    payment_date: 'paymentDate',
  }
  const fields: FieldErrors = {}
  if (isRecord(body.errors)) {
    for (const [field, messages] of Object.entries(body.errors)) {
      if (Array.isArray(messages) && typeof messages[0] === 'string') {
        fields[fieldMap[field] ?? field] = messages[0]
      }
    }
  }
  const message = typeof body.message === 'string' ? body.message : null
  return { fields, message: Object.keys(fields).length ? message : message ?? errorMessage(error) }
}

function formatAmount(amount: number, currency: string): string {
  return `${new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount)} ${currency}`
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

export default function SupplierPayments() {
  const [payments, setPayments] = useState<PaymentPage | null>(null)
  const [page, setPage] = useState(1)
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [listRetry, setListRetry] = useState(0)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [fields, setFields] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [accounts, setAccounts] = useState<FinancialAccount[]>([])
  const [optionsLoading, setOptionsLoading] = useState(true)
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [accountsError, setAccountsError] = useState<string | null>(null)
  const [optionsRetry, setOptionsRetry] = useState(0)
  const [accountRetry, setAccountRetry] = useState(0)
  const [selectedPayment, setSelectedPayment] = useState<SupplierPayment | null>(null)
  const [supplierSearch, setSupplierSearch] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setListLoading(true)
    setListError(null)
    api.get<unknown>('/api/supplier-payments', {
      params: { page },
      signal: controller.signal,
    }).then(({ data }) => {
      setPayments(parsePaymentPage(data))
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setPayments(null)
        setListError(errorMessage(error))
      }
    }).finally(() => {
      if (!controller.signal.aborted) setListLoading(false)
    })
    return () => controller.abort()
  }, [page, listRetry])

  useEffect(() => {
    const controller = new AbortController()
    setOptionsLoading(true)
    setOptionsError(null)
    Promise.all([
      loadAllOptions('/api/business-partners', { partner_type: 'Supplier' }, controller.signal),
      loadAllOptions('/api/currencies', { is_active: 'true', per_page: 100 }, controller.signal),
    ]).then(([supplierRecords, currencyRecords]) => {
      const loadedSuppliers = supplierRecords.map(parseSupplier)
      const loadedCurrencies = currencyRecords.map(parseCurrency)
      setSuppliers(loadedSuppliers.filter((supplier) => supplier.isActive))
      setCurrencies(loadedCurrencies.filter((currency) => currency.isActive))
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setOptionsError(errorMessage(error))
    }).finally(() => {
      if (!controller.signal.aborted) setOptionsLoading(false)
    })
    return () => controller.abort()
  }, [optionsRetry])

  const selectedCurrency = currencies.find((currency) => String(currency.id) === form.currencyId)
  const isAfn = selectedCurrency?.code.toUpperCase() === 'AFN'

  useEffect(() => {
    if (!form.currencyId) {
      setAccounts([])
      setAccountsError(null)
      setAccountsLoading(false)
      return
    }
    const controller = new AbortController()
    setAccounts([])
    setAccountsLoading(true)
    setAccountsError(null)
    setForm((current) => ({ ...current, accountId: '' }))
    api.get<unknown>('/api/financial-accounts/balances', {
      params: { currency_id: form.currencyId },
      signal: controller.signal,
    }).then(({ data }) => {
      if (!isRecord(data) || !Array.isArray(data.data)) {
        throw new Error('The financial account response was not in the expected format.')
      }
      const loadedAccounts = data.data.map(parseAccount)
        .filter((account) => account.isActive && account.currencyId === Number(form.currencyId))
      setAccounts(loadedAccounts)
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setAccountsError(errorMessage(error))
        setAccounts([])
      }
    }).finally(() => {
      if (!controller.signal.aborted) setAccountsLoading(false)
    })
    return () => controller.abort()
  }, [form.currencyId, accountRetry])

  const setField = (field: keyof PaymentForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
    setFields((current) => {
      const next = { ...current }
      delete next[field]
      if (field === 'amount') delete next.amount
      return next
    })
    setFormError(null)
    setSuccess(null)
  }

  const startCreate = () => {
    setForm(emptyForm)
    setSupplierSearch('')
    setFields({})
    setFormError(null)
    setSuccess(null)
    setIsFormOpen(true)
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSaving) return
    const nextFields: FieldErrors = {}
    if (!form.paymentNumber.trim()) nextFields.paymentNumber = 'Enter a payment number.'
    if (!form.supplierId) nextFields.supplierId = 'Select a supplier.'
    if (!form.currencyId) nextFields.currencyId = 'Select a currency.'
    if (!form.accountId) nextFields.accountId = 'Select a financial account.'
    const amount = Number(form.amount)
    if (!form.amount || !Number.isFinite(amount) || amount <= 0 || amount > 999_999_999_999) {
      nextFields.amount = 'Enter an amount greater than zero.'
    }
    const rate = Number(form.exchangeRate)
    if (!form.exchangeRate || !Number.isFinite(rate) || rate <= 0) {
      nextFields.exchangeRate = 'Enter a positive exchange rate.'
    } else if (isAfn && rate !== 1) {
      nextFields.exchangeRate = 'AFN exchange rate must be 1.'
    }
    if (!form.paymentDate) nextFields.paymentDate = 'Select a payment date.'
    if (form.currencyId && accountsLoading) nextFields.accountId = 'Wait for financial accounts to load.'
    if (accountsError) nextFields.accountId = 'Resolve the financial account loading error.'
    if (!accountsLoading && form.currencyId && accounts.length === 0 && !accountsError) {
      nextFields.accountId = 'No active account is available for this currency.'
    }
    setFields(nextFields)
    setFormError(null)
    if (Object.keys(nextFields).length) {
      setFormError('Check the highlighted fields.')
      return
    }

    setIsSaving(true)
    try {
      await api.post('/api/supplier-payments', {
        payment_number: form.paymentNumber.trim(),
        business_partner_id: Number(form.supplierId),
        financial_account_id: Number(form.accountId),
        currency_id: Number(form.currencyId),
        amount,
        exchange_rate_to_afn: rate,
        payment_date: form.paymentDate,
        notes: form.notes.trim() || null,
      })
      setForm(emptyForm)
      setIsFormOpen(false)
      setPage(1)
      setListRetry((current) => current + 1)
      setSuccess('Supplier payment recorded successfully.')
    } catch (error: unknown) {
      const result = validationMessages(error)
      setFields(result.fields)
      setFormError(result.message)
    } finally {
      setIsSaving(false)
    }
  }

  const filteredSuppliers = suppliers.filter((supplier) =>
    supplier.name.toLowerCase().includes(supplierSearch.trim().toLowerCase()),
  )

  return (
    <div className="purchases-page supplier-payments-page">
      <header className="purchases-heading">
        <div>
          <p className="overview-eyebrow">FINANCE &amp; TOOLS</p>
          <h1>Supplier Payments</h1>
          <p className="overview-heading__description">Record and review payments made to suppliers.</p>
        </div>
        <button className="purchase-create-button" type="button" onClick={startCreate}>
          <span>+ New Payment</span>
        </button>
      </header>

      {success && <p className="purchase-success-message supplier-payment-success" role="status">{success}</p>}

      {isFormOpen && (
        <section className="purchases-panel supplier-payment-form-panel">
          <header className="supplier-payment-form-heading">
            <h2>Record Supplier Payment</h2>
            <button type="button" className="purchase-cancel-button" onClick={() => setIsFormOpen(false)} disabled={isSaving}>Cancel</button>
          </header>
          {optionsError && (
            <div className="supplier-payment-error" role="alert">
              {optionsError}
              <button type="button" onClick={() => setOptionsRetry((value) => value + 1)}>Retry</button>
            </div>
          )}
          {formError && <p className="create-purchase-alert supplier-payment-alert" role="alert">{formError}</p>}
          <form className="supplier-payment-form" onSubmit={(event) => void submit(event)} noValidate>
            <label className="purchase-field">
              <span>Payment Number <i>*</i></span>
              <input value={form.paymentNumber} onChange={(event) => setField('paymentNumber', event.target.value)} maxLength={50} aria-invalid={Boolean(fields.paymentNumber)} />
              {fields.paymentNumber && <small className="purchase-field__error">{fields.paymentNumber}</small>}
            </label>

            <div className="purchase-field supplier-payment-supplier">
              <label htmlFor="supplier-payment-search"><span>Supplier <i>*</i></span></label>
              <input id="supplier-payment-search" type="search" placeholder="Search supplier" value={supplierSearch} onChange={(event) => setSupplierSearch(event.target.value)} disabled={optionsLoading || Boolean(optionsError)} />
              <select value={form.supplierId} onChange={(event) => setField('supplierId', event.target.value)} disabled={optionsLoading || Boolean(optionsError)} aria-label="Supplier" aria-invalid={Boolean(fields.supplierId)}>
                <option value="">{optionsLoading ? 'Loading suppliers…' : filteredSuppliers.length ? 'Select supplier' : 'No active suppliers found'}</option>
                {filteredSuppliers.map((supplier) => <option value={supplier.id} key={supplier.id}>{supplier.name}</option>)}
              </select>
              {fields.supplierId && <small className="purchase-field__error">{fields.supplierId}</small>}
            </div>

            <label className="purchase-field">
              <span>Currency <i>*</i></span>
              <select value={form.currencyId} onChange={(event) => {
                const currencyId = event.target.value
                const currency = currencies.find((item) => String(item.id) === currencyId)
                setField('currencyId', currencyId)
                setForm((current) => ({
                  ...current,
                  exchangeRate: currency?.code.toUpperCase() === 'AFN' ? '1' : '',
                  accountId: '',
                }))
              }} disabled={optionsLoading || Boolean(optionsError)} aria-invalid={Boolean(fields.currencyId)}>
                <option value="">{optionsLoading ? 'Loading currencies…' : 'Select currency'}</option>
                {currencies.map((currency) => <option value={currency.id} key={currency.id}>{currency.code} — {currency.name}</option>)}
              </select>
              {fields.currencyId && <small className="purchase-field__error">{fields.currencyId}</small>}
            </label>

            <label className="purchase-field">
              <span>Financial Account <i>*</i></span>
              <select value={form.accountId} onChange={(event) => setField('accountId', event.target.value)} disabled={!form.currencyId || accountsLoading || Boolean(accountsError) || accounts.length === 0} aria-invalid={Boolean(fields.accountId)}>
                <option value="">{!form.currencyId ? 'Select currency first' : accountsLoading ? 'Loading accounts…' : accounts.length ? 'Select account' : 'No active account found'}</option>
                {accounts.map((account) => <option value={account.id} key={account.id}>{account.name} · {account.accountType}</option>)}
              </select>
              {accountsError && <small className="purchase-field__error">{accountsError} <button type="button" onClick={() => setAccountRetry((value) => value + 1)}>Retry</button></small>}
              {!accountsLoading && !accountsError && form.currencyId && accounts.length === 0 && <small className="purchase-field__error">No active account is available for this currency.</small>}
              {fields.accountId && <small className="purchase-field__error">{fields.accountId}</small>}
            </label>

            <label className="purchase-field">
              <span>Amount <i>*</i></span>
              <input type="number" min="0" step="any" value={form.amount} onChange={(event) => setField('amount', event.target.value)} aria-invalid={Boolean(fields.amount)} />
              {fields.amount && <small className="purchase-field__error">{fields.amount}</small>}
            </label>

            <label className="purchase-field">
              <span>Exchange Rate to AFN <i>*</i></span>
              <input type="number" min="0" step="any" value={form.exchangeRate} onChange={(event) => setField('exchangeRate', event.target.value)} disabled={!form.currencyId || isAfn} placeholder={isAfn ? '1' : 'Enter rate'} aria-invalid={Boolean(fields.exchangeRate)} />
              {fields.exchangeRate
                ? <small className="purchase-field__error">{fields.exchangeRate}</small>
                : <small className="purchase-field__hint">{isAfn ? 'AFN rate is fixed at 1.' : 'Enter the current rate; no rate is assumed.'}</small>}
            </label>

            <label className="purchase-field">
              <span>Payment Date <i>*</i></span>
              <input type="date" value={form.paymentDate} onChange={(event) => setField('paymentDate', event.target.value)} aria-invalid={Boolean(fields.paymentDate)} />
              {fields.paymentDate && <small className="purchase-field__error">{fields.paymentDate}</small>}
            </label>

            <label className="purchase-field supplier-payment-notes">
              <span>Notes</span>
              <textarea rows={2} maxLength={5000} value={form.notes} onChange={(event) => setField('notes', event.target.value)} />
              {fields.notes && <small className="purchase-field__error">{fields.notes}</small>}
            </label>

            <div className="supplier-payment-form-actions">
              <button type="button" className="purchase-cancel-button" onClick={() => setIsFormOpen(false)} disabled={isSaving}>Cancel</button>
              <button type="submit" className="purchase-save-button" disabled={isSaving || optionsLoading || Boolean(optionsError)}>
                {isSaving ? 'Saving…' : 'Save Payment'}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="purchases-panel" aria-label="Supplier payments list">
        {listLoading ? (
          <div className="purchases-state" role="status"><span className="loading-spinner" /> Loading supplier payments…</div>
        ) : listError ? (
          <div className="purchases-state purchases-state--error" role="alert">
            {listError}
            <button className="purchases-retry" type="button" onClick={() => setListRetry((value) => value + 1)}>Try again</button>
          </div>
        ) : payments && payments.data.length === 0 ? (
          <div className="purchases-state purchases-state--empty">
            <strong>No supplier payments yet</strong>
            <span>Record a payment to see it listed here.</span>
          </div>
        ) : payments ? (
          <>
            <div className="purchases-table-scroll">
              <table className="purchases-table supplier-payments-table">
                <thead>
                  <tr><th>Payment Number</th><th>Payment Date</th><th>Supplier</th><th>Financial Account</th><th>Currency</th><th className="purchases-table__numeric">Amount</th><th>Created By</th><th>Details</th></tr>
                </thead>
                <tbody>
                  {payments.data.map((payment) => (
                    <tr key={payment.id}>
                      <td><strong className="purchases-number">{payment.paymentNumber}</strong></td>
                      <td>{formatDate(payment.paymentDate)}</td>
                      <td>{payment.supplier}</td>
                      <td>{payment.account}</td>
                      <td><span className="purchases-currency">{payment.currency}</span></td>
                      <td className="purchases-table__numeric purchases-total">{formatAmount(payment.amount, payment.currency)}</td>
                      <td>{payment.createdBy}</td>
                      <td><button className="purchase-view-button" type="button" onClick={() => setSelectedPayment(payment)}>Details</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="purchases-pagination">
              <span>Showing {payments.total ? (payments.currentPage - 1) * payments.perPage + 1 : 0}–{Math.min(payments.currentPage * payments.perPage, payments.total)} of {new Intl.NumberFormat().format(payments.total)} payments</span>
              <div className="purchases-pagination__controls">
                <button type="button" onClick={() => setPage((current) => current - 1)} disabled={payments.currentPage <= 1}>‹ Previous</button>
                <span>Page <strong>{payments.currentPage}</strong> of <strong>{payments.lastPage}</strong></span>
                <button type="button" onClick={() => setPage((current) => current + 1)} disabled={payments.currentPage >= payments.lastPage}>Next ›</button>
              </div>
            </footer>
          </>
        ) : null}
      </section>

      {selectedPayment && (
        <div className="purchase-modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedPayment(null)
        }}>
          <section className="purchase-modal supplier-payment-modal" role="dialog" aria-modal="true" aria-labelledby="supplier-payment-detail-title">
            <header className="purchase-modal__header">
              <div><p className="overview-eyebrow">SUPPLIER PAYMENT</p><h2 id="supplier-payment-detail-title">{selectedPayment.paymentNumber}</h2><p>{formatDate(selectedPayment.paymentDate)}</p></div>
              <button type="button" className="purchase-modal__close" onClick={() => setSelectedPayment(null)} aria-label="Close details">×</button>
            </header>
            <div className="purchase-modal__body">
              <dl className="purchase-detail-grid">
                <div><dt>Supplier</dt><dd>{selectedPayment.supplier}</dd></div>
                <div><dt>Financial Account</dt><dd>{selectedPayment.account} · {selectedPayment.accountType}</dd></div>
                <div><dt>Amount</dt><dd>{formatAmount(selectedPayment.amount, selectedPayment.currency)}</dd></div>
                <div><dt>Exchange Rate to AFN</dt><dd>{selectedPayment.exchangeRate}</dd></div>
                <div><dt>Created By</dt><dd>{selectedPayment.createdBy}</dd></div>
                <div><dt>Notes</dt><dd>{selectedPayment.notes || '—'}</dd></div>
              </dl>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
