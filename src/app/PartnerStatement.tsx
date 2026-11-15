import { useEffect, useState } from "react";
import axios from "axios";
import { ChevronLeft, ChevronRight, ExternalLink, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";

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
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(0);
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
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
      .catch((reason: unknown) => { if (!controller.signal.aborted) { setStatement(null); setError(errorMessage(reason)); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [partnerId, partnerType, year, month, page, retry]);

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
      const rawAmount = payload.grand_total ?? payload.total_amount ?? payload.amount;
      setDocument({
        title: source.title,
        number: typeof payload[source.numberField] === "string" ? payload[source.numberField] as string : row.documentNumber ?? `#${row.referenceId}`,
        date: typeof payload[source.dateField] === "string" ? payload[source.dateField] as string : row.date,
        status: typeof payload.status === "string" ? payload.status : "Recorded",
        amount: rawAmount === undefined || rawAmount === null ? money(row.amount, row.currency) : money(toNumber(rawAmount), row.currency),
      });
    } catch (reason: unknown) {
      setDocumentError(errorMessage(reason));
    } finally {
      setDocumentLoading(false);
    }
  }

  return <section className="partner-statement" aria-label={`${partnerType} account statement`}>
    <header className="partner-statement__heading">
      <div><h3>Account statement</h3><p>Balances are calculated separately for each currency.</p></div>
      <button className="overview-refresh" type="button" onClick={() => setRetry((value) => value + 1)} disabled={loading} aria-label="Refresh statement"><RefreshCw size={15} aria-hidden="true" /> Refresh</button>
    </header>
    <div className="partner-statement__filters">
      <label>Year<select value={year} onChange={(event) => { setYear(Number(event.target.value)); setPage(1); }}>{Array.from({ length: 9 }, (_, index) => today.getFullYear() - index).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Month<select value={month} onChange={(event) => { setMonth(Number(event.target.value)); setPage(1); }}><option value={0}>All Months</option>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{new Intl.DateTimeFormat(undefined, { month: "long" }).format(new Date(2025, index, 1))}</option>)}</select></label>
    </div>
    {loading ? <div className="purchases-state" role="status"><span className="loading-spinner" /> Loading account statement…</div> : error ? <div className="purchases-state purchases-state--error" role="alert">{error}<button type="button" className="purchases-retry" onClick={() => setRetry((value) => value + 1)}>Try again</button></div> : statement ? <>
      {statement.summaries.length ? <div className="partner-statement__summaries">{statement.summaries.map((summary) => <article className="partner-statement__summary" key={summary.currency}>
        <header><div><strong>{summary.currency}</strong>{summary.currencyName && <span>{summary.currencyName}</span>}</div><span className="partner-statement__balance-type">{summary.balanceType.replaceAll("_", " ")}</span></header>
        <dl><div><dt>Opening balance</dt><dd>{money(summary.openingBalance, summary.currency)}</dd></div><div><dt>Debits</dt><dd>{money(summary.debit, summary.currency)}</dd></div><div><dt>Credits</dt><dd>{money(summary.credit, summary.currency)}</dd></div><div><dt>{partnerType === "Customer" ? "Sales" : "Purchases"}</dt><dd>{money(summary.salesOrPurchases, summary.currency)}</dd></div><div><dt>Returns</dt><dd>{money(summary.returns, summary.currency)}</dd></div><div><dt>Payments</dt><dd>{money(summary.payments, summary.currency)}</dd></div><div><dt>Return settlements</dt><dd>{money(summary.returnSettlements, summary.currency)}</dd></div></dl>
        <footer><span>Closing balance</span><strong>{money(summary.closingBalance, summary.currency)}</strong></footer>
      </article>)}</div> : <div className="purchases-state purchases-state--empty">No account activity is recorded for this period.</div>}
      {statement.rows.length ? <><div className="purchases-table-scroll"><table className="purchases-table partner-statement__table"><thead><tr><th>Date</th><th>Type / reference</th><th>Description</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead><tbody>{statement.rows.map((row) => <tr key={row.id}><td>{row.date.replace("T", " ").slice(0, 16)}</td><td><strong>{row.type.replaceAll("_", " ")}</strong>{row.documentNumber && <small>{row.documentNumber}</small>}{supportedSource(row.referenceType) && row.referenceId !== null && <button type="button" className="partner-statement__source" onClick={() => void openSource(row)}><ExternalLink size={13} aria-hidden="true" /> View document</button>}</td><td>{row.description || "—"}</td><td>{row.direction === "debit" ? money(row.amount, row.currency) : "—"}</td><td>{row.direction === "credit" ? money(row.amount, row.currency) : "—"}</td><td>{money(row.runningBalance, row.currency)}</td></tr>)}</tbody></table></div>
      <footer className="purchases-pagination"><span>{statement.total} statement entries</span><div className="purchases-pagination__controls"><button type="button" onClick={() => setPage((value) => value - 1)} disabled={page <= 1 || loading} aria-label="Previous statement page"><ChevronLeft size={16} /> Previous</button><span>Page <strong>{statement.page}</strong> of <strong>{statement.lastPage}</strong></span><button type="button" onClick={() => setPage((value) => value + 1)} disabled={page >= statement.lastPage || loading} aria-label="Next statement page">Next <ChevronRight size={16} /></button></div></footer></> : <div className="purchases-state purchases-state--empty">No transactions for the selected period.</div>}
    </> : null}
    {(documentLoading || documentError || document) && <div className="partner-statement__document-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setDocument(null); setDocumentError(null); } }}><section className="partner-statement__document" role="dialog" aria-modal="true" aria-labelledby="partner-source-title"><header><h3 id="partner-source-title">{document?.title ?? "Source document"}</h3><button type="button" onClick={() => { setDocument(null); setDocumentError(null); }} aria-label="Close source details">×</button></header>{documentLoading ? <div className="purchases-state" role="status">Loading document…</div> : documentError ? <div className="purchases-state purchases-state--error" role="alert">{documentError}</div> : document && <dl><div><dt>Document number</dt><dd>{document.number}</dd></div><div><dt>Date</dt><dd>{document.date}</dd></div><div><dt>Status</dt><dd>{document.status}</dd></div><div><dt>Amount</dt><dd>{document.amount}</dd></div></dl>}</section></div>}
  </section>;
}
