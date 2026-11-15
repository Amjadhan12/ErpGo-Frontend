import { useEffect, useState } from "react";
import { AlertCircle, LoaderCircle, RefreshCw, UserRound } from "lucide-react";
import type { UserRole } from "@/auth/AuthContext";
import { api } from "@/lib/api";
import { getErrorMessage, isRecord, numberValue, optionalText, parseId } from "@/app/InventoryShared";

type PortalRole = Extract<UserRole, "Customer" | "Supplier">;
type PortalProfile = { name: string; businessName: string | null; phone: string | null; email: string | null; address: string | null };
type PortalBalance = { currency: string; currencyName: string; currencySymbol: string; opening: number; credit: number; debit: number; balance: number; balanceType: string };
type OpeningBalance = { id: number; date: string; amount: number; currency: string; currencyName: string; currencySymbol: string; notes: string | null };
type PortalTransaction = { id: number; date: string; type: string; direction: string; amount: number; currency: string; description: string | null; referenceType: string | null; referenceId: number | null };
type TransactionPage = { rows: PortalTransaction[]; page: number; lastPage: number; total: number };
type PortalData = { profile: PortalProfile; balances: PortalBalance[]; openings: OpeningBalance[]; transactions: TransactionPage };

const roleConfig: Record<PortalRole, { path: string; noun: string; balanceEndpoint: string }> = {
  Customer: { path: "/api/customer", noun: "customer", balanceEndpoint: "/api/customer/balance" },
  Supplier: { path: "/api/supplier", noun: "supplier", balanceEndpoint: "/api/supplier/balance" },
};

function parseProfile(value: unknown, role: PortalRole): PortalProfile {
  if (!isRecord(value) || !isRecord(value.data) || !isRecord(value.data[role.toLowerCase()])) throw new Error("The portal profile response is incomplete.");
  const partner = value.data[role.toLowerCase()] as Record<string, unknown>;
  if (typeof partner.name !== "string") throw new Error("The portal profile is missing the partner name.");
  return { name: partner.name, businessName: optionalText(partner.business_name), phone: optionalText(partner.phone), email: optionalText(partner.email), address: optionalText(partner.address) };
}

function parseBalances(value: unknown): PortalBalance[] {
  if (!isRecord(value) || !isRecord(value.data) || !Array.isArray(value.data.balances)) throw new Error("The portal balance response is incomplete.");
  return value.data.balances.map((row): PortalBalance => {
    if (!isRecord(row) || typeof row.currency !== "string") throw new Error("The portal balance response contains an invalid currency row.");
    return { currency: row.currency.toUpperCase(), currencyName: typeof row.currency_name === "string" ? row.currency_name : row.currency, currencySymbol: typeof row.currency_symbol === "string" ? row.currency_symbol : "", opening: numberValue(row.opening_balance, "opening balance"), credit: numberValue(row.total_credit, "total credit"), debit: numberValue(row.total_debit, "total debit"), balance: numberValue(row.balance, "current balance"), balanceType: typeof row.balance_type === "string" ? row.balance_type : "settled" };
  });
}

function parseOpening(value: unknown): OpeningBalance {
  if (!isRecord(value) || !isRecord(value.currency) || typeof value.opening_date !== "string") throw new Error("The opening balance record is incomplete.");
  return { id: parseId(value.id, "opening balance ID"), date: value.opening_date.slice(0, 10), amount: numberValue(value.amount, "opening balance amount"), currency: typeof value.currency.code === "string" ? value.currency.code.toUpperCase() : "—", currencyName: typeof value.currency.name === "string" ? value.currency.name : "Currency", currencySymbol: typeof value.currency.symbol === "string" ? value.currency.symbol : "", notes: optionalText(value.notes) };
}

function parseTransaction(value: unknown): PortalTransaction {
  if (!isRecord(value) || !isRecord(value.currency) || typeof value.transaction_date !== "string") throw new Error("A transaction record is incomplete.");
  return { id: parseId(value.id, "transaction ID"), date: value.transaction_date.slice(0, 10), type: typeof value.transaction_type === "string" ? value.transaction_type : "Transaction", direction: typeof value.direction === "string" ? value.direction : "", amount: numberValue(value.amount, "transaction amount"), currency: typeof value.currency.code === "string" ? value.currency.code.toUpperCase() : "—", description: optionalText(value.description), referenceType: optionalText(value.reference_type), referenceId: typeof value.reference_id === "number" ? value.reference_id : null };
}

function parseTransactionResponse(value: unknown): { openings: OpeningBalance[]; transactions: TransactionPage } {
  if (!isRecord(value) || !isRecord(value.data) || !Array.isArray(value.data.opening_balances) || !isRecord(value.data.transactions) || !Array.isArray(value.data.transactions.data)) throw new Error("The portal transaction response is incomplete.");
  const pagination = value.data.transactions;
  const transactionRows = pagination.data as unknown[];
  return {
    openings: value.data.opening_balances.map(parseOpening),
    transactions: { rows: transactionRows.map(parseTransaction), page: numberValue(pagination.current_page, "transaction page"), lastPage: numberValue(pagination.last_page, "last transaction page"), total: numberValue(pagination.total, "transaction count") },
  };
}

function money(amount: number, currency: string): string {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 4 }).format(amount); }
  catch { return `${amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${currency}`; }
}

function dateLabel(value: string): string {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(parsed);
}

export default function PartnerPortal({ role }: { role: PortalRole }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const config = roleConfig[role];

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    void Promise.all([
      api.get<unknown>(`${config.path}/profile`, { signal: controller.signal }),
      api.get<unknown>(config.balanceEndpoint, { signal: controller.signal }),
      api.get<unknown>(`${config.path}/transactions`, { params: { page, per_page: 20 }, signal: controller.signal }),
    ]).then(([profileResponse, balanceResponse, transactionResponse]) => {
      const transactions = parseTransactionResponse(transactionResponse.data);
      setData({ profile: parseProfile(profileResponse.data, role), balances: parseBalances(balanceResponse.data), openings: transactions.openings, transactions: transactions.transactions });
    }).catch((requestError: unknown) => {
      if (!controller.signal.aborted) { setData(null); setError(getErrorMessage(requestError)); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [config.balanceEndpoint, config.path, page, retry, role]);

  const balanceDescription = (value: PortalBalance): string => {
    if (value.balanceType === "settled") return "Settled";
    if (role === "Customer") return value.balanceType === "customer_owes_us" ? "You owe the company" : "The company owes you";
    return value.balanceType === "we_owe_supplier" ? "The company owes you" : "You owe the company";
  };

  return <main className="partner-portal-page">
    <div className="partner-portal-content">
      <header className="partner-portal-heading"><div><p className="overview-eyebrow">{role.toUpperCase()} ACCOUNT</p><h1>{role} portal</h1><p>Your account profile, balances, and transaction history.</p></div><button className="partner-portal-refresh" type="button" onClick={() => setRetry((value) => value + 1)} disabled={loading}><RefreshCw size={16} /> Refresh</button></header>
      {loading ? <div className="partner-portal-state" role="status"><LoaderCircle className="partner-portal-spin" size={20} /> Loading your account…</div>
        : error ? <div className="partner-portal-state partner-portal-state--error" role="alert"><AlertCircle size={18} /><span>{error}</span><button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div>
          : data && <>
            <section className="partner-portal-profile" aria-labelledby="portal-profile-title"><span className="partner-portal-profile-icon"><UserRound size={21} /></span><div><h2 id="portal-profile-title">{data.profile.name}</h2>{data.profile.businessName && <p>{data.profile.businessName}</p>}<div className="partner-portal-contact">{data.profile.phone && <span>{data.profile.phone}</span>}{data.profile.email && <span>{data.profile.email}</span>}{data.profile.address && <span>{data.profile.address}</span>}</div></div></section>
            <section className="partner-portal-section"><header><div><h2>Balances by currency</h2><p>Each currency is shown separately.</p></div></header>
              {data.balances.length === 0 ? <div className="partner-portal-empty">No balances are available.</div> : <div className="partner-portal-balances">{data.balances.map((balance) => <article key={balance.currency}><div className="partner-portal-currency"><strong>{balance.currency}</strong><span>{balance.currencyName}</span></div><div className="partner-portal-balance-main"><small>Current balance</small><strong>{money(balance.balance, balance.currency)}</strong><span>{balanceDescription(balance)}</span></div><dl><div><dt>Opening balance</dt><dd>{money(balance.opening, balance.currency)}</dd></div><div><dt>Total debit</dt><dd>{money(balance.debit, balance.currency)}</dd></div><div><dt>Total credit</dt><dd>{money(balance.credit, balance.currency)}</dd></div></dl></article>)}</div>}
            </section>
            <section className="partner-portal-section"><header><div><h2>Opening balances</h2><p>Initial amounts recorded for your account.</p></div></header>
              {data.openings.length === 0 ? <div className="partner-portal-empty">No opening balances are recorded.</div> : <div className="partner-portal-table-wrap"><table className="partner-portal-table"><thead><tr><th>Date</th><th>Currency</th><th>Amount</th><th>Notes</th></tr></thead><tbody>{data.openings.map((opening) => <tr key={opening.id}><td>{dateLabel(opening.date)}</td><td>{opening.currency}</td><td><strong>{money(opening.amount, opening.currency)}</strong></td><td>{opening.notes || "—"}</td></tr>)}</tbody></table></div>}
            </section>
            <section className="partner-portal-section"><header><div><h2>Transaction history</h2><p>{data.transactions.total} transaction{data.transactions.total === 1 ? "" : "s"}</p></div></header>
              {data.transactions.rows.length === 0 ? <div className="partner-portal-empty">No transactions recorded.</div> : <div className="partner-portal-table-wrap"><table className="partner-portal-table"><thead><tr><th>Date</th><th>Type</th><th>Direction</th><th>Currency</th><th>Amount</th><th>Reference / description</th></tr></thead><tbody>{data.transactions.rows.map((transaction) => <tr key={transaction.id}><td>{dateLabel(transaction.date)}</td><td>{transaction.type.replaceAll("_", " ")}</td><td>{transaction.direction}</td><td>{transaction.currency}</td><td><strong>{money(transaction.amount, transaction.currency)}</strong></td><td>{[transaction.referenceType, transaction.referenceId === null ? null : `#${transaction.referenceId}`, transaction.description].filter(Boolean).join(" · ") || "—"}</td></tr>)}</tbody></table></div>}
              {data.transactions.lastPage > 1 && <div className="partner-portal-pagination"><span>Page {data.transactions.page} of {data.transactions.lastPage}</span><div><button type="button" disabled={data.transactions.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><button type="button" disabled={data.transactions.page >= data.transactions.lastPage} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>}
            </section>
          </>}
    </div>
  </main>;
}
