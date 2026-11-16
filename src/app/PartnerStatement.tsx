import { useEffect, useState, type ReactNode } from "react";
import axios from "axios";
import {
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  ExternalLink,
  FileText,
  RefreshCw,
  RotateCcw,
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
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
  children: ReactNode;
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

interface PartnerDocumentSection {
  id: "invoices" | "payments" | "returns" | "settlements";
  title: string;
  icon: LucideIcon;
  tone: string;
  numberField: string;
  dateField: string;
}

interface PartnerDocumentRecord extends Record<string, unknown> {
  id: number | string;
}

interface PartnerDocumentPage {
  records: PartnerDocumentRecord[];
  page: number;
  lastPage: number;
  total: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDocumentPage(value: unknown): PartnerDocumentPage {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error("The document list response was incomplete.");
  }
  const records = value.data.map((record): PartnerDocumentRecord => {
    if (!isRecord(record) || !("id" in record) ||
      (typeof record.id !== "number" && typeof record.id !== "string")) {
      throw new Error("The document list response was incomplete.");
    }
    return { ...record, id: record.id };
  });
  if (
    typeof value.current_page !== "number" ||
    typeof value.last_page !== "number" ||
    typeof value.total !== "number"
  ) {
    throw new Error("The document list response was incomplete.");
  }
  return {
    records,
    page: value.current_page,
    lastPage: value.last_page,
    total: value.total,
  };
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

function errorMessage(error: unknown, fallback = "Could not load the account statement."): string {
  if (axios.isAxiosError(error)) {
    if (isRecord(error.response?.data) && typeof error.response.data.message === "string") return error.response.data.message;
    return fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

function money(value: number, currency: string): string {
  return `${currency} ${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value)}`;
}

function relatedRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function documentNumber(
  record: PartnerDocumentRecord,
  section: PartnerDocumentSection,
): string {
  return textValue(record[section.numberField]) ?? `#${record.id}`;
}

function documentDate(record: PartnerDocumentRecord, section: PartnerDocumentSection): string {
  return textValue(record[section.dateField]) ?? "";
}

function documentCurrency(record: PartnerDocumentRecord): string {
  const currency = relatedRecord(record.currency);
  const sale = relatedRecord(record.sale);
  const purchase = relatedRecord(record.purchase);
  const returnRecord = relatedRecord(record.sale_return) ?? relatedRecord(record.purchase_return);
  const returnCurrency = relatedRecord(returnRecord?.currency);
  return textValue(currency?.code) ??
    textValue(relatedRecord(sale?.currency)?.code) ??
    textValue(relatedRecord(purchase?.currency)?.code) ??
    textValue(returnCurrency?.code) ??
    "";
}

function formatDocumentDate(value: string, language: "en" | "ps"): string {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === "ps" ? "ps-AF" : "en-US", {
    dateStyle: "medium",
  }).format(date);
}

function documentAmount(record: PartnerDocumentRecord): number | null {
  const value = record.grand_total ?? record.amount;
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function supportedSource(referenceType: string | null): { endpoint: string; title: string; numberField: string; dateField: string } | null {
  const sources: Record<string, { endpoint: string; title: string; numberField: string; dateField: string }> = {
    "App\\Models\\Sale": { endpoint: "/api/sales", title: "Sale", numberField: "sale_number", dateField: "sale_date" },
    "App\\Models\\SaleReturn": { endpoint: "/api/sale-returns", title: "Sale return", numberField: "return_number", dateField: "return_date" },
    "App\\Models\\PurchaseReturn": { endpoint: "/api/purchase-returns", title: "Purchase return", numberField: "return_number", dateField: "return_date" },
  };
  return referenceType ? sources[referenceType] ?? null : null;
}

export default function PartnerStatement({ partnerId, partnerType, children }: PartnerStatementProps) {
  const { t, language } = useLocale();
  const today = new Date();
  const documentSections = partnerType === "Customer"
    ? [
      { id: "invoices", title: "Sales Invoices", icon: FileText, tone: "blue", numberField: "sale_number", dateField: "sale_date" },
      { id: "payments", title: "Customer Receipts", icon: CreditCard, tone: "green", numberField: "payment_number", dateField: "payment_date" },
      { id: "returns", title: "Sale Returns", icon: RotateCcw, tone: "orange", numberField: "return_number", dateField: "return_date" },
      { id: "settlements", title: "Sale Return Settlements", icon: Wallet, tone: "teal", numberField: "settlement_number", dateField: "settlement_date" },
    ] as const
    : [
      { id: "invoices", title: "Purchase Invoices", icon: FileText, tone: "blue", numberField: "purchase_number", dateField: "purchase_date" },
      { id: "payments", title: "Supplier Payments", icon: CreditCard, tone: "green", numberField: "payment_number", dateField: "payment_date" },
      { id: "returns", title: "Purchase Returns", icon: RotateCcw, tone: "orange", numberField: "return_number", dateField: "return_date" },
      { id: "settlements", title: "Purchase Return Settlements", icon: Wallet, tone: "teal", numberField: "settlement_number", dateField: "settlement_date" },
    ] as const satisfies readonly PartnerDocumentSection[];
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(0);
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [activeSection, setActiveSection] = useState("overview");
  const [statement, setStatement] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [documentPage, setDocumentPage] = useState(1);
  const [documentRetry, setDocumentRetry] = useState(0);
  const [documentList, setDocumentList] = useState<PartnerDocumentPage | null>(null);
  const [documentListLoading, setDocumentListLoading] = useState(false);
  const [documentListError, setDocumentListError] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<PartnerDocumentRecord | null>(null);
  const [document, setDocument] = useState<DocumentInfo | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const selectedDocuments = documentSections.find((section) => section.id === activeSection);
  const selectedRecordSource = selectedRecord
    ? relatedRecord(selectedRecord.sale) ?? relatedRecord(selectedRecord.purchase)
    : null;
  const selectedRecordReturn = selectedRecord
    ? relatedRecord(selectedRecord.sale_return) ?? relatedRecord(selectedRecord.purchase_return)
    : null;
  const selectedRecordReference = selectedRecordSource
    ? textValue(selectedRecordSource.sale_number) ?? textValue(selectedRecordSource.purchase_number)
    : selectedRecordReturn
      ? textValue(selectedRecordReturn.return_number)
      : null;
  const selectedRecordItems = selectedRecord && Array.isArray(selectedRecord.items)
    ? selectedRecord.items.filter(isRecord)
    : selectedRecordSource && Array.isArray(selectedRecordSource.items)
      ? selectedRecordSource.items.filter(isRecord)
      : [];
  const selectedRecordCurrency = selectedRecord ? documentCurrency(selectedRecord) : "";
  const selectedRecordAmount = selectedRecord ? documentAmount(selectedRecord) : null;

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
    setActiveSection("overview");
    setPage(1);
    setDocumentPage(1);
    setSelectedRecord(null);
  }, [partnerId, partnerType]);

  useEffect(() => {
    if (!selectedDocuments) return;
    const controller = new AbortController();
    setDocumentListLoading(true);
    setDocumentListError(null);
    setDocumentList(null);
    api.get<unknown>(
      `/api/business-partners/${partnerId}/documents/${selectedDocuments.id}`,
      {
        params: { page: documentPage, per_page: 10 },
        signal: controller.signal,
      },
    ).then(({ data }) => setDocumentList(parseDocumentPage(data)))
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setDocumentList(null);
          setDocumentListError(errorMessage(reason, "Could not load partner documents."));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDocumentListLoading(false);
      });
    return () => controller.abort();
  }, [partnerId, selectedDocuments?.id, documentPage, documentRetry]);

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

  return (
    <section className="partner-statement partner-details-workspace" aria-label={t("Partner documents")}>
      <nav className="partner-document-tabs" role="tablist" aria-label={t("Partner documents")} dir={language === "ps" ? "rtl" : "ltr"}>
        <button id="partner-doc-tab-overview" type="button" role="tab" aria-selected={activeSection === "overview"} aria-controls="partner-document-panel" onClick={() => setActiveSection("overview")}>
          <UserRound size={18} aria-hidden="true" /><span>{t("Overview")}</span>
        </button>
        {documentSections.map((section) => {
          const Icon = section.icon;
          return (
            <button
              key={section.id}
              id={`partner-doc-tab-${section.id}`}
              className={`partner-document-tab--${section.tone}`}
              type="button"
              role="tab"
              aria-selected={activeSection === section.id}
              aria-controls="partner-document-panel"
              onClick={() => {
                setDocumentPage(1);
                setSelectedRecord(null);
                setActiveSection(section.id);
              }}
            >
              <Icon size={18} aria-hidden="true" /><span>{t(section.title)}</span>
            </button>
          );
        })}
        <button id="partner-doc-tab-statement" className="partner-document-tab--indigo" type="button" role="tab" aria-selected={activeSection === "statement"} aria-controls="partner-document-panel" onClick={() => { setSelectedRecord(null); setActiveSection("statement"); }}>
          <BookOpenText size={18} aria-hidden="true" /><span>{t("Account Statement")}</span>
        </button>
      </nav>

      <div className="partner-document-content" dir={language === "ps" ? "rtl" : "ltr"}>
      <header className="partner-statement__heading">
        <div>
          <h3>{t(activeSection === "overview" ? "Partner overview" : selectedDocuments?.title ?? "Account Statement")}</h3>
          <p>{t(activeSection === "statement" ? "Balances are calculated separately for each currency." : "View this partner’s profile and related records.")}</p>
        </div>
        {selectedDocuments ? (
          <button className="overview-refresh" type="button" onClick={() => setDocumentRetry((value) => value + 1)} disabled={documentListLoading} aria-label={t("Refresh documents")}>
            <RefreshCw size={15} aria-hidden="true" /> {t("Refresh")}
          </button>
        ) : activeSection === "statement" ? (
          <button
            className="overview-refresh"
            type="button"
            onClick={() => setRetry((value) => value + 1)}
            disabled={loading}
            aria-label={t("Refresh statement")}
          >
            <RefreshCw size={15} aria-hidden="true" /> {t("Refresh")}
          </button>
        ) : null}
      </header>

      <div
        id="partner-document-panel"
        className="partner-document-panel"
        role="tabpanel"
        aria-labelledby={activeSection === "statement" ? "partner-doc-tab-statement" : `partner-doc-tab-${activeSection}`}
      >
        {activeSection === "overview" ? (
          <div className="partner-profile-overview">{children}</div>
        ) : selectedDocuments ? (
          <section className={`partner-document-list partner-document-list--${selectedDocuments.tone}`} aria-label={t(selectedDocuments.title)}>
            {documentListLoading ? (
              <div className="purchases-state" role="status"><span className="loading-spinner" /> {t("Loading documents…")}</div>
            ) : documentListError ? (
              <div className="purchases-state purchases-state--error" role="alert">
                <span>{t(documentListError)}</span>
                <button type="button" className="purchases-retry" onClick={() => setDocumentRetry((value) => value + 1)}>{t("Try again")}</button>
              </div>
            ) : documentList?.records.length ? (
              <>
                <div className="purchases-table-scroll partner-document-table-scroll">
                  <table className="purchases-table partner-document-table">
                    <thead>
                      <tr>
                        <th>{t("Date")}</th>
                        <th>{t("Document number")}</th>
                        <th>{t("Status")}</th>
                        <th>{t("Currency")}</th>
                        <th>{t("Amount")}</th>
                        <th>{t("Actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {documentList.records.map((record) => {
                        const code = documentCurrency(record);
                        const amount = documentAmount(record);
                        const status = textValue(record.status) ?? textValue(record.payment_status) ?? t("Recorded");
                        const number = documentNumber(record, selectedDocuments);
                        return (
                          <tr key={record.id}>
                            <td data-label={t("Date")} dir="ltr">{formatDocumentDate(documentDate(record, selectedDocuments), language)}</td>
                            <td data-label={t("Document number")} dir="ltr"><strong>{number}</strong></td>
                            <td data-label={t("Status")}><span className={`partner-document-status partner-document-status--${status.toLowerCase()}`}>{status}</span></td>
                            <td data-label={t("Currency")} dir="ltr">{code || "—"}</td>
                            <td data-label={t("Amount")} dir="ltr">{amount === null || !code ? "—" : money(amount, code)}</td>
                            <td data-label={t("Actions")}>
                              <button type="button" className="partner-document-view" onClick={() => setSelectedRecord(record)} aria-label={`${t("View Details")}: ${number}`}>
                                <ExternalLink size={14} aria-hidden="true" /> {t("View Details")}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <footer className="purchases-pagination partner-document-pagination">
                  <span>{documentList.total} {t("documents")}</span>
                  <div className="purchases-pagination__controls">
                    <button type="button" onClick={() => setDocumentPage((value) => value - 1)} disabled={documentPage <= 1 || documentListLoading} aria-label={t("Previous page")}>
                      <ChevronLeft size={16} /> {t("Previous")}
                    </button>
                    <span>{t("Page")} <strong>{documentList.page}</strong> {t("of")} <strong>{documentList.lastPage}</strong></span>
                    <button type="button" onClick={() => setDocumentPage((value) => value + 1)} disabled={documentPage >= documentList.lastPage || documentListLoading} aria-label={t("Next page")}>
                      {t("Next")} <ChevronRight size={16} />
                    </button>
                  </div>
                </footer>
              </>
            ) : (
              <div className="purchases-state purchases-state--empty">{t("No documents found for this partner.")}</div>
            )}
          </section>
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
      </div>

      {selectedRecord && selectedDocuments && (
        <div className="partner-statement__document-backdrop partner-statement__record-backdrop">
          <section className="partner-statement__document partner-document-detail" role="dialog" aria-modal="true" aria-labelledby="partner-record-title" dir={language === "ps" ? "rtl" : "ltr"}>
            <header>
              <div>
                <p className="overview-eyebrow">{t(selectedDocuments.title)}</p>
                <h3 id="partner-record-title" dir="ltr">{documentNumber(selectedRecord, selectedDocuments)}</h3>
              </div>
              <button type="button" onClick={() => setSelectedRecord(null)} aria-label={t("Close document details")}>×</button>
            </header>
            <dl>
              <div><dt>{t("Document number")}</dt><dd dir="ltr">{documentNumber(selectedRecord, selectedDocuments)}</dd></div>
              <div><dt>{t("Date")}</dt><dd dir="ltr">{formatDocumentDate(documentDate(selectedRecord, selectedDocuments), language)}</dd></div>
              <div>
                <dt>{t("Status")}</dt>
                <dd>{textValue(selectedRecord.status) ?? textValue(selectedRecord.payment_status) ?? t("Recorded")}</dd>
              </div>
              <div><dt>{t("Currency")}</dt><dd dir="ltr">{documentCurrency(selectedRecord) || "—"}</dd></div>
              <div>
                <dt>{t("Amount")}</dt>
                <dd dir="ltr">
                  {selectedRecordAmount === null || !selectedRecordCurrency
                    ? "—"
                    : money(selectedRecordAmount, selectedRecordCurrency)}
                </dd>
              </div>
              {textValue(selectedRecord.invoice_number) && (
                <div><dt>{t("Invoice number")}</dt><dd dir="ltr">{textValue(selectedRecord.invoice_number)}</dd></div>
              )}
              {textValue(selectedRecord.payment_status) && (
                <div><dt>{t("Payment status")}</dt><dd>{textValue(selectedRecord.payment_status)}</dd></div>
              )}
              {selectedRecordReference && (
                <div><dt>{t("Related document")}</dt><dd dir="ltr">{selectedRecordReference}</dd></div>
              )}
              {textValue(relatedRecord(selectedRecord.financial_account)?.name) && (
                <div><dt>{t("Financial account")}</dt><dd>{textValue(relatedRecord(selectedRecord.financial_account)?.name)}</dd></div>
              )}
              {textValue(relatedRecord(selectedRecord.warehouse)?.name) && (
                <div><dt>{t("Warehouse")}</dt><dd>{textValue(relatedRecord(selectedRecord.warehouse)?.name)}</dd></div>
              )}
              {textValue(selectedRecord.exchange_rate_to_afn) && (
                <div><dt>{t("Exchange rate")}</dt><dd dir="ltr">{textValue(selectedRecord.exchange_rate_to_afn)}</dd></div>
              )}
              {textValue(selectedRecord.notes) && (
                <div className="partner-document-detail__notes"><dt>{t("Notes")}</dt><dd>{textValue(selectedRecord.notes)}</dd></div>
              )}
            </dl>
            {selectedRecordItems.length > 0 && (
              <section className="partner-document-detail__items">
                <h4>{t("Items")}</h4>
                <div className="purchases-table-scroll">
                  <table className="purchases-table">
                    <thead>
                      <tr><th>{t("Product")}</th><th>{t("Quantity")}</th><th>{t("Unit Price")}</th><th>{t("Amount")}</th></tr>
                    </thead>
                    <tbody>
                      {selectedRecordItems.map((item, index) => {
                        const product = relatedRecord(item.product);
                        const rawUnitAmount = item.unit_price ?? item.unit_cost;
                        const rawLineAmount = item.line_total;
                        const unitAmount = rawUnitAmount === null || rawUnitAmount === undefined ? null : Number(rawUnitAmount);
                        const lineAmount = rawLineAmount === null || rawLineAmount === undefined ? null : Number(rawLineAmount);
                        return (
                          <tr key={textValue(item.id) ?? index}>
                            <td data-label={t("Product")}>{textValue(product?.name) ?? "—"}</td>
                            <td data-label={t("Quantity")} dir="ltr">{textValue(item.quantity) ?? "—"}</td>
                            <td data-label={t("Unit Price")} dir="ltr">{selectedRecordCurrency && unitAmount !== null && Number.isFinite(unitAmount) ? money(unitAmount, selectedRecordCurrency) : "—"}</td>
                            <td data-label={t("Amount")} dir="ltr">{selectedRecordCurrency && lineAmount !== null && Number.isFinite(lineAmount) ? money(lineAmount, selectedRecordCurrency) : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </section>
        </div>
      )}

      {(documentLoading || documentError || document) && (
        <div
          className="partner-statement__document-backdrop"
          role="presentation"
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
