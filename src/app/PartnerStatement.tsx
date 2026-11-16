import { useEffect, useState } from "react";
import axios from "axios";
import { ChevronLeft, ChevronRight, ExternalLink, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { financialValueClass } from "@/lib/financial";
import { useLocale } from "@/lib/locale";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

interface PartnerStatementProps {
  partnerId: number;
  partnerType: "Customer" | "Supplier";
}

interface CurrencySummary {
  currency: string;
  currencyName: string | null;
  currencySymbol: string | null;
  openingBalance: number;
  debit: number;
  credit: number;
  salesOrPurchases: number;
  returns: number;
  payments: number;
  returnSettlements: number;
  closingBalance: number;
  balanceType: string;
}

interface StatementRow {
  id: string;
  transactionId: number | null;
  date: string;
  type: string;
  direction: "debit" | "credit";
  amount: number;
  currency: string;
  description: string | null;
  referenceType: string | null;
  referenceId: number | null;
  documentNumber: string | null;
  runningBalance: number;
}

interface Statement {
  summaries: CurrencySummary[];
  rows: StatementRow[];
  page: number;
  lastPage: number;
  total: number;
}

interface DocumentInfo {
  title: string;
  number: string;
  date: string;
  status: string;
  amount: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(result)) throw new Error("The statement contains an invalid amount.");
  return result;
}

function parseStatement(value: unknown): Statement {
  if (!isRecord(value) || !isRecord(value.data) || !Array.isArray(value.data.currency_summaries) || !isRecord(value.data.transactions) || !Array.isArray(value.data.transactions.data)) {
    throw new Error("The account statement response was incomplete.");
  }
  const summaries = value.data.currency_summaries.map((item): CurrencySummary => {
    if (!isRecord(item) || typeof item.currency !== "string") throw new Error("The statement contains an invalid currency summary.");
    return {
      currency: item.currency,
      currencyName: typeof item.currency_name === "string" ? item.currency_name : null,
      currencySymbol: typeof item.currency_symbol === "string" ? item.currency_symbol : null,
      openingBalance: toNumber(item.opening_balance),
      debit: toNumber(item.period_debit_total),
      credit: toNumber(item.period_credit_total),
      salesOrPurchases: toNumber(item.sales_or_purchases_total),
      returns: toNumber(item.returns_total),
      payments: toNumber(item.payments_total),
      returnSettlements: toNumber(item.return_settlements_total),
      closingBalance: toNumber(item.closing_balance),
      balanceType: typeof item.balance_type === "string" ? item.balance_type : "settled",
    };
  });
  const rows = value.data.transactions.data.map((item): StatementRow => {
    if (!isRecord(item) || typeof item.id !== "string" || (item.direction !== "debit" && item.direction !== "credit") || typeof item.currency !== "string") {
      throw new Error("The statement contains an invalid transaction row.");
    }
    return {
      id: item.id,
      transactionId: typeof item.transaction_id === "number" ? item.transaction_id : null,
      date: typeof item.transaction_date === "string" ? item.transaction_date : "",
      type: typeof item.transaction_type === "string" ? item.transaction_type : "Transaction",
      direction: item.direction,
      amount: toNumber(item.amount),
      currency: item.currency,
      description: typeof item.description === "string" ? item.description : null,
      referenceType: typeof item.reference_type === "string" ? item.reference_type : null,
      referenceId: typeof item.reference_id === "number" ? item.reference_id : null,
      documentNumber: typeof item.source_document_number === "string" ? item.source_document_number : null,
      runningBalance: toNumber(item.running_balance),
    };
  });
  return {
    summaries,
    rows,
    page: typeof value.data.transactions.current_page === "number" ? value.data.transactions.current_page : 1,
    lastPage: typeof value.data.transactions.last_page === "number" ? value.data.transactions.last_page : 1,
    total: typeof value.data.transactions.total === "number" ? value.data.transactions.total : rows.length,
  };
}

function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error) && isRecord(error.response?.data) && typeof error.response.data.message === "string") return error.response.data.message;
  return error instanceof Error ? error.message : "Could not load the account statement.";
}

function money(value: number, currency: string): string {
  return `${currency} ${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value)}`;
}

function supportedSource(referenceType: string | null): { endpoint: string; title: string; numberField: string; dateField: string } | null {
  const sources: Record<string, { endpoint: string; title: string; numberField: string; dateField: string }> = {
    "App\\Models\\Sale": { endpoint: "/api/sales", title: "Sale", numberField: "sale_number", dateField: "sale_date" },
    "App\\Models\\SaleReturn": { endpoint: "/api/sale-returns", title: "Sale return", numberField: "return_number", dateField: "return_date" },
    "App\\Models\\PurchaseReturn": { endpoint: "/api/purchase-returns", title: "Purchase return", numberField: "return_number", dateField: "return_date" },
  };
  return referenceType ? sources[referenceType] ?? null : null;
}

export default function PartnerStatement({ partnerId, partnerType }: PartnerStatementProps) {
  const { t } = useLocale();
  const today = new Date();
  const documentSections = partnerType === "Customer"
    ? [
      { id: "invoices", title: "Sales Invoices", endpoint: "/api/sales", filter: "Missing filter: business_partner_id" },
      { id: "payments", title: "Customer Receipts / Payment Vouchers", endpoint: "/api/sale-payments", filter: "Missing filter: business_partner_id" },
      { id: "returns", title: "Sale Returns", endpoint: "/api/sale-returns", filter: "Missing filter: business_partner_id" },
      { id: "settlements", title: "Sale Return Settlements", endpoint: "/api/sale-return-settlements", filter: "Existing filter: sale_return_id; missing partner_id" },
    ] as const
    : [
      { id: "invoices", title: "Purchase Invoices", endpoint: "/api/purchases", filter: "Missing filter: business_partner_id" },
      { id: "payments", title: "Supplier Payments", endpoint: "/api/supplier-payments", filter: "Missing filter: business_partner_id" },
      { id: "returns", title: "Purchase Returns", endpoint: "/api/purchase-returns", filter: "Missing filter: business_partner_id" },
      { id: "settlements", title: "Purchase Return Settlements", endpoint: "/api/purchase-return-settlements", filter: "Existing filter: purchase_return_id; missing partner_id" },
    ] as const;
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(0);
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [activeSection, setActiveSection] = useState("statement");
  const [statement, setStatement] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [document, setDocument] = useState<DocumentInfo | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api.get<unknown>(`/api/business-partners/${partnerId}/statement`, {
      params: { year, month: month || undefined, page, per_page: 10 },
      signal: controller.signal,
    }).then(({ data }) => setStatement(parseStatement(data)))
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setStatement(null);
          setError(errorMessage(reason));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [partnerId, partnerType, year, month, page, retry]);

  useEffect(() => {
    setActiveSection("statement");
    setPage(1);
  }, [partnerId, partnerType]);

  async function openSource(row: StatementRow) {
    const source = supportedSource(row.referenceType);
    if (!source || row.referenceId === null) return;
    setDocument(null);
    setDocumentError(null);
    setDocumentLoading(true);
    try {
      const { data } = await api.get<unknown>(`${source.endpoint}/${row.referenceId}`);
      const payload = isRecord(data) && isRecord(data.data) ? data.data : null;
      if (!payload) throw new Error("The source document response was incomplete.");

      const relationKey = partnerType === "Customer" ? "customer" : "supplier";
      const relatedSourceKey = partnerType === "Customer" ? "sale" : "purchase";
      const directRelation = isRecord(payload[relationKey]) ? payload[relationKey] : null;
      const relatedSource = isRecord(payload[relatedSourceKey]) ? payload[relatedSourceKey] : null;
      const nestedRelation = relatedSource && isRecord(relatedSource[relationKey])
        ? relatedSource[relationKey]
        : null;
      const sourcePartnerId = payload.business_partner_id
        ?? directRelation?.id
        ?? relatedSource?.business_partner_id
        ?? nestedRelation?.id;
      if (Number(sourcePartnerId) !== partnerId) {
        throw new Error("The source document does not belong to this partner.");
      }

      const rawAmount = payload.grand_total ?? payload.total_amount ?? payload.amount;
      setDocument({
        title: source.title,
        number: typeof payload[source.numberField] === "string" ? payload[source.numberField] as string : row.documentNumber ?? `#${row.referenceId}`,
        date: typeof payload[source.dateField] === "string" ? payload[source.dateField] as string : row.date,
        status: typeof payload.status === "string" ? payload.status : t("Recorded"),
        amount: rawAmount === undefined || rawAmount === null ? money(row.amount, row.currency) : money(toNumber(rawAmount), row.currency),
      });
    } catch (reason: unknown) {
      setDocumentError(errorMessage(reason));
    } finally {
      setDocumentLoading(false);
    }
  }

  const selectedDocuments = documentSections.find((section) => section.id === activeSection);

  return (
    <section className="partner-statement" aria-label={t("Partner documents")}>
      <header className="partner-statement__heading">
        <div>
          <h3>{t("Partner documents")}</h3>
          <p>{t("Balances are calculated separately for each currency.")}</p>
        </div>
        {activeSection === "statement" && (
          <button
            className="overview-refresh"
            type="button"
            onClick={() => setRetry((value) => value + 1)}
            disabled={loading}
            aria-label={t("Refresh statement")}
          >
            <RefreshCw size={15} aria-hidden="true" /> {t("Refresh")}
          </button>
        )}
      </header>

      <nav className="partner-document-tabs" role="tablist" aria-label={t("Partner documents")}>
        {documentSections.map((section) => (
          <button
            key={section.id}
            id={`partner-doc-tab-${section.id}`}
            type="button"
            role="tab"
            aria-selected={activeSection === section.id}
            aria-controls="partner-document-panel"
            onClick={() => setActiveSection(section.id)}
          >
            {t(section.title)}
          </button>
        ))}
        <button
          id="partner-doc-tab-statement"
          type="button"
          role="tab"
          aria-selected={activeSection === "statement"}
          aria-controls="partner-document-panel"
          onClick={() => setActiveSection("statement")}
        >
          {t("Account Statement")}
        </button>
      </nav>

      <div
        id="partner-document-panel"
        className="partner-document-panel"
        role="tabpanel"
        aria-labelledby={activeSection === "statement" ? "partner-doc-tab-statement" : `partner-doc-tab-${activeSection}`}
      >
        {selectedDocuments ? (
          <div className="partner-document-unavailable" role="status">
            <h4>{t(selectedDocuments.title)}</h4>
            <p>{t("The API does not provide a partner-filtered list for this document type.")}</p>
            <code dir="ltr">GET {selectedDocuments.endpoint}</code>
            <small dir="ltr">{selectedDocuments.filter}</small>
          </div>
        ) : (
          <>
            <div className="partner-statement__filters">
              <label>
                {t("Year")}
                <select value={year} onChange={(event) => { setYear(Number(event.target.value)); setPage(1); }}>
                  {Array.from({ length: 9 }, (_, index) => today.getFullYear() - index).map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label>
                {t("Month")}
                <select value={month} onChange={(event) => { setMonth(Number(event.target.value)); setPage(1); }}>
                  <option value={0}>{t("All Months")}</option>
                  {MONTH_NAMES.map((monthName, index) => (
                    <option key={index + 1} value={index + 1}>
                      {t(monthName)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {loading ? (
              <div className="purchases-state" role="status">
                <span className="loading-spinner" /> {t("Loading account statement…")}
              </div>
            ) : error ? (
              <div className="purchases-state purchases-state--error" role="alert">
                {t(error)}
                <button type="button" className="purchases-retry" onClick={() => setRetry((value) => value + 1)}>
                  {t("Try again")}
                </button>
              </div>
            ) : statement ? (
              <>
                {statement.summaries.length ? (
                  <div className="partner-statement__summaries">
                    {statement.summaries.map((summary) => {
                      const normalizedBalanceType = summary.balanceType.toLowerCase();
                      const closingBalanceClass = summary.closingBalance === 0
                        ? "financial-value--neutral"
                        : normalizedBalanceType.includes("receivable")
                          ? "financial-value--receivable"
                          : normalizedBalanceType.includes("payable")
                            ? "financial-value--payable"
                            : financialValueClass(summary.closingBalance, "income");
                      return (
                        <article className="partner-statement__summary" key={summary.currency}>
                          <header>
                            <div>
                              <strong dir="ltr">{summary.currency}</strong>
                              {summary.currencyName && <span>{summary.currencyName}</span>}
                            </div>
                            <span className="partner-statement__balance-type">{summary.balanceType.replaceAll("_", " ")}</span>
                          </header>
                          <dl>
                            <div><dt>{t("Opening balance")}</dt><dd dir="ltr">{money(summary.openingBalance, summary.currency)}</dd></div>
                            <div><dt>{t("Debits")}</dt><dd dir="ltr">{money(summary.debit, summary.currency)}</dd></div>
                            <div><dt>{t("Credits")}</dt><dd dir="ltr">{money(summary.credit, summary.currency)}</dd></div>
                            <div><dt>{t(partnerType === "Customer" ? "Sales" : "Purchases")}</dt><dd dir="ltr">{money(summary.salesOrPurchases, summary.currency)}</dd></div>
                            <div><dt>{t("Returns")}</dt><dd dir="ltr">{money(summary.returns, summary.currency)}</dd></div>
                            <div><dt>{t("Payments")}</dt><dd dir="ltr">{money(summary.payments, summary.currency)}</dd></div>
                            <div><dt>{t("Return settlements")}</dt><dd dir="ltr">{money(summary.returnSettlements, summary.currency)}</dd></div>
                          </dl>
                          <footer>
                            <span>{t("Closing balance")}</span>
                            <strong className={closingBalanceClass} dir="ltr">{money(summary.closingBalance, summary.currency)}</strong>
                          </footer>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="purchases-state purchases-state--empty">{t("No account activity is recorded for this period.")}</div>
                )}
                {statement.rows.length ? (
                  <>
                    <div className="purchases-table-scroll">
                      <table className="purchases-table partner-statement__table">
                        <thead>
                          <tr>
                            <th>{t("Date")}</th>
                            <th>{t("Type / reference")}</th>
                            <th>{t("Description")}</th>
                            <th>{t("Debits")}</th>
                            <th>{t("Credits")}</th>
                            <th>{t("Balance")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {statement.rows.map((row) => (
                            <tr key={row.id}>
                              <td data-label={t("Date")} dir="ltr">{row.date.replace("T", " ").slice(0, 16)}</td>
                              <td data-label={t("Type / reference")}>
                                <strong>{row.type === "Transaction" ? t("Transaction") : row.type.replaceAll("_", " ")}</strong>
                                {row.documentNumber && <small dir="ltr">{row.documentNumber}</small>}
                                {supportedSource(row.referenceType) && row.referenceId !== null && (
                                  <button type="button" className="partner-statement__source" onClick={() => void openSource(row)}>
                                    <ExternalLink size={13} aria-hidden="true" /> {t("View document")}
                                  </button>
                                )}
                              </td>
                              <td data-label={t("Description")}>{row.description || "—"}</td>
                              <td data-label={t("Debits")} dir="ltr">{row.direction === "debit" ? money(row.amount, row.currency) : "—"}</td>
                              <td data-label={t("Credits")} dir="ltr">{row.direction === "credit" ? money(row.amount, row.currency) : "—"}</td>
                              <td data-label={t("Balance")} dir="ltr">{money(row.runningBalance, row.currency)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <footer className="purchases-pagination">
                      <span>{statement.total} {t("statement entries")}</span>
                      <div className="purchases-pagination__controls">
                        <button type="button" onClick={() => setPage((value) => value - 1)} disabled={page <= 1 || loading} aria-label={t("Previous page")}>
                          <ChevronLeft size={16} /> {t("Previous")}
                        </button>
                        <span>{t("Page")} <strong>{statement.page}</strong> {t("of")} <strong>{statement.lastPage}</strong></span>
                        <button type="button" onClick={() => setPage((value) => value + 1)} disabled={page >= statement.lastPage || loading} aria-label={t("Next page")}>
                          {t("Next")} <ChevronRight size={16} />
                        </button>
                      </div>
                    </footer>
                  </>
                ) : (
                  <div className="purchases-state purchases-state--empty">{t("No transactions for the selected period.")}</div>
                )}
              </>
            ) : null}
          </>
        )}
      </div>

      {(documentLoading || documentError || document) && (
        <div
          className="partner-statement__document-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setDocument(null);
              setDocumentError(null);
            }
          }}
        >
          <section className="partner-statement__document" role="dialog" aria-modal="true" aria-labelledby="partner-source-title">
            <header>
              <h3 id="partner-source-title">{document ? t(document.title) : t("Source document")}</h3>
              <button type="button" onClick={() => { setDocument(null); setDocumentError(null); }} aria-label={t("Close source details")}>×</button>
            </header>
            {documentLoading ? (
              <div className="purchases-state" role="status">{t("Loading document…")}</div>
            ) : documentError ? (
              <div className="purchases-state purchases-state--error" role="alert">{t(documentError)}</div>
            ) : document && (
              <dl>
                <div><dt>{t("Document number")}</dt><dd dir="ltr">{document.number}</dd></div>
                <div><dt>{t("Date")}</dt><dd dir="ltr">{document.date}</dd></div>
                <div><dt>{t("Status")}</dt><dd>{document.status}</dd></div>
                <div><dt>{t("Amount")}</dt><dd dir="ltr">{document.amount}</dd></div>
              </dl>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
