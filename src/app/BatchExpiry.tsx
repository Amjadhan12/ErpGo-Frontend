import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  PackageCheck,
  Warehouse,
} from "lucide-react";
import { api } from "@/lib/api";
import {
  getErrorMessage,
  isRecord,
  loadProducts,
  loadWarehouses,
  numberValue,
  optionalText,
  parseId,
  parseLaravelPage,
  type InventoryProductOption,
  type InventoryWarehouseOption,
  type LaravelPage,
} from "@/app/InventoryShared";
import { useLocale } from "@/lib/locale";

type ExpiryStatus = "expired" | "expiring" | "no_expiry" | "normal";

interface BatchRow {
  id: number;
  product: string;
  sku: string | null;
  warehouse: string;
  batchNumber: string | null;
  quantity: number;
  expiryDate: string | null;
  daysRemaining: number | null;
  unitCost: number;
}

interface BatchSummary {
  expired: number;
  expiringSoon: number;
  withoutExpiry: number;
  totalWithStock: number;
}

type Translate = (text: string) => string;

const pageSize = 20;

function parseBatch(value: unknown): BatchRow {
  if (
    !isRecord(value) ||
    typeof value.product_name !== "string" ||
    typeof value.warehouse_name !== "string"
  ) {
    throw new Error("The batch report contains an invalid record.");
  }
  return {
    id: parseId(value.id, "batch ID"),
    product: value.product_name,
    sku: optionalText(value.product_sku),
    warehouse: value.warehouse_name,
    batchNumber: optionalText(value.batch_number),
    quantity: numberValue(value.remaining_quantity, "remaining quantity"),
    expiryDate: optionalText(value.expiry_date),
    daysRemaining:
      value.days_remaining == null
        ? null
        : numberValue(value.days_remaining, "days remaining"),
    unitCost: numberValue(value.unit_cost_afn, "unit cost"),
  };
}

function parseSummary(value: unknown): BatchSummary {
  if (!isRecord(value)) {
    throw new Error("The batch expiry response contains no summary.");
  }
  return {
    expired: numberValue(value.expired, "expired batch count"),
    expiringSoon: numberValue(value.expiring_soon, "expiring batch count"),
    withoutExpiry: numberValue(value.without_expiry, "batch count without expiry"),
    totalWithStock: numberValue(
      value.total_batches_with_stock,
      "total batch count",
    ),
  };
}

function formatDate(value: string, language: "en" | "ps"): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return new Intl.DateTimeFormat(language === "ps" ? "ps-AF" : "en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

function translateReportError(
  message: string,
  t: Translate,
  language: "en" | "ps",
): string {
  const translated = t(message);
  if (translated !== message) return translated;
  return language === "ps"
    ? t("The batch expiry report could not be loaded. Please try again.")
    : message;
}

function statusFor(row: BatchRow): ExpiryStatus {
  if (row.daysRemaining === null) return "no_expiry";
  if (row.daysRemaining < 0) return "expired";
  if (row.daysRemaining <= 30) return "expiring";
  return "normal";
}

export default function BatchExpiry() {
  const { direction, language, t } = useLocale();
  const [rows, setRows] = useState<LaravelPage<BatchRow> | null>(null);
  const [summary, setSummary] = useState<BatchSummary | null>(null);
  const [warehouses, setWarehouses] = useState<InventoryWarehouseOption[]>([]);
  const [products, setProducts] = useState<InventoryProductOption[]>([]);
  const [warehouse, setWarehouse] = useState("");
  const [product, setProduct] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  const numberFormat = useMemo(
    () => new Intl.NumberFormat(language === "ps" ? "ps-AF" : "en-US"),
    [language],
  );
  const quantityFormat = useMemo(
    () =>
      new Intl.NumberFormat(language === "ps" ? "ps-AF" : "en-US", {
        maximumFractionDigits: 4,
      }),
    [language],
  );
  const currencyFormat = useMemo(
    () =>
      new Intl.NumberFormat(language === "ps" ? "ps-AF" : "en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      }),
    [language],
  );

  useEffect(() => {
    const controller = new AbortController();
    setOptionsLoading(true);
    setOptionsError(null);
    Promise.all([
      loadWarehouses(controller.signal),
      loadProducts(controller.signal),
    ])
      .then(([warehouseOptions, productOptions]) => {
        setWarehouses(warehouseOptions);
        setProducts(productOptions);
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setOptionsError(
            translateReportError(
              getErrorMessage(requestError),
              t,
              language,
            ),
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setOptionsLoading(false);
      });
    return () => controller.abort();
  }, [optionsRetry, t, language]);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    setSummary(null);
    api
      .get<unknown>("/api/reports/batch-expiry", {
        params: {
          warehouse_id: warehouse || undefined,
          product_id: product || undefined,
          status,
          page,
          per_page: pageSize,
          days: 30,
        },
        signal: controller.signal,
      })
      .then(({ data }) => {
        if (!isRecord(data) || !isRecord(data.summary)) {
          throw new Error("The batch expiry response is incomplete.");
        }
        setSummary(parseSummary(data.summary));
        setRows(parseLaravelPage(data, parseBatch));
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setRows(null);
          setSummary(null);
          setError(
            translateReportError(
              getErrorMessage(requestError),
              t,
              language,
            ),
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [warehouse, product, status, page, retry, t, language]);

  const statusLabel = (rowStatus: ExpiryStatus) => {
    switch (rowStatus) {
      case "expired":
        return t("Expired");
      case "expiring":
        return t("Expiring soon");
      case "no_expiry":
        return t("No expiry date");
      case "normal":
        return t("Normal");
    }
  };

  return (
    <div className="batch-expiry" dir={direction} lang={language}>
      <header className="batch-expiry__heading">
        <div>
          <p className="batch-expiry__eyebrow">{t("INVENTORY")}</p>
          <h1>{t("Batch & Expiry")}</h1>
          <p>{t("Review batch stock, expiry dates, and batches without an expiry date.")}</p>
        </div>
        <span className="batch-expiry__heading-icon">
          <CalendarDays size={23} aria-hidden="true" />
        </span>
      </header>

      <section
        className="batch-expiry__filter-card"
        aria-label={t("Filter batches")}
      >
        <header className="batch-expiry__section-heading">
          <span className="batch-expiry__section-icon">
            <PackageCheck size={18} aria-hidden="true" />
          </span>
          <div>
            <h2>{t("Batch Filters")}</h2>
            <p>{t("Narrow the batch list by warehouse, product, or expiry status.")}</p>
          </div>
        </header>
        {optionsError && (
          <div className="batch-expiry__alert" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <span>{optionsError}</span>
            <button
              type="button"
              onClick={() => setOptionsRetry((value) => value + 1)}
            >
              {t("Retry")}
            </button>
          </div>
        )}
        {optionsLoading && (
          <p className="batch-expiry__options-loading" role="status">
            <span className="batch-expiry__spinner" />
            {t("Loading filters…")}
          </p>
        )}
        <div className="batch-expiry__filters">
          <label className="batch-expiry__field">
            <span>{t("Warehouse")}</span>
            <select
              value={warehouse}
              onChange={(event) => {
                setWarehouse(event.target.value);
                setPage(1);
              }}
              disabled={optionsLoading || Boolean(optionsError)}
            >
              <option value="">{t("All warehouses")}</option>
              {warehouses.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          <label className="batch-expiry__field">
            <span>{t("Product")}</span>
            <select
              value={product}
              onChange={(event) => {
                setProduct(event.target.value);
                setPage(1);
              }}
              disabled={optionsLoading || Boolean(optionsError)}
            >
              <option value="">{t("All products")}</option>
              {products.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          <label className="batch-expiry__field">
            <span>{t("Expiry Status")}</span>
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">{t("All batches")}</option>
              <option value="expired">{t("Expired")}</option>
              <option value="expiring">{t("Expiring soon")}</option>
              <option value="no_expiry">{t("No expiry date")}</option>
            </select>
          </label>
        </div>
      </section>

      {summary && !isLoading && !error && (
        <section
          className="batch-expiry__summary"
          aria-label={t("Batch summary")}
        >
          <SummaryCard
            label={t("Expired")}
            value={summary.expired}
            numberFormat={numberFormat}
            tone="expired"
          />
          <SummaryCard
            label={t("Expiring soon")}
            value={summary.expiringSoon}
            numberFormat={numberFormat}
            tone="expiring"
          />
          <SummaryCard
            label={t("No expiry date")}
            value={summary.withoutExpiry}
            numberFormat={numberFormat}
            tone="no_expiry"
          />
          <SummaryCard
            label={t("Batches with stock")}
            value={summary.totalWithStock}
            numberFormat={numberFormat}
            tone="total"
          />
        </section>
      )}

      <section
        className="batch-expiry__list-card"
        aria-label={t("Batch and expiry records")}
      >
        <header className="batch-expiry__list-heading">
          <div className="batch-expiry__list-icon">
            <Warehouse size={19} aria-hidden="true" />
          </div>
          <div>
            <h2>{t("Batch Stock")}</h2>
            <p>{t("Remaining quantities and expiry details for recorded batches.")}</p>
          </div>
          {rows && !isLoading && !error && (
            <span className="batch-expiry__record-count">
              {t("{count} batches").replace(
                "{count}",
                numberFormat.format(rows.total),
              )}
            </span>
          )}
        </header>

        {isLoading ? (
          <div className="batch-expiry__state" role="status">
            <span className="batch-expiry__spinner" />
            {t("Loading batches…")}
          </div>
        ) : error ? (
          <div
            className="batch-expiry__state batch-expiry__state--error"
            role="alert"
          >
            <AlertCircle size={21} aria-hidden="true" />
            <span>{error}</span>
            <button
              className="batch-expiry__text-button"
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              {t("Try again")}
            </button>
          </div>
        ) : rows && rows.data.length === 0 ? (
          <div className="batch-expiry__state batch-expiry__state--empty">
            <span className="batch-expiry__empty-icon">
              <PackageCheck size={21} aria-hidden="true" />
            </span>
            <strong>{t("No batches match these filters.")}</strong>
            <span>{t("Batches with remaining stock will appear here.")}</span>
          </div>
        ) : rows ? (
          <>
            <div className="batch-expiry__table-scroll">
              <table className="batch-expiry__table">
                <thead>
                  <tr>
                    <th>{t("Product")}</th>
                    <th>{t("Warehouse")}</th>
                    <th>{t("Batch Number")}</th>
                    <th>{t("Remaining Quantity")}</th>
                    <th>{t("Expiry Date")}</th>
                    <th>{t("Unit Cost")}</th>
                    <th>{t("Status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.data.map((row) => {
                    const rowStatus = statusFor(row);
                    return (
                      <tr key={row.id}>
                        <td data-label={t("Product")}>
                          <strong className="batch-expiry__product">
                            {row.product}
                          </strong>
                          {row.sku && (
                            <small className="batch-expiry__sku">{row.sku}</small>
                          )}
                        </td>
                        <td data-label={t("Warehouse")}>
                          <span className="batch-expiry__warehouse">
                            <Warehouse size={14} aria-hidden="true" />
                            {row.warehouse}
                          </span>
                        </td>
                        <td data-label={t("Batch Number")}>
                          <span className="batch-expiry__batch-number">
                            {row.batchNumber || t("Not recorded")}
                          </span>
                        </td>
                        <td data-label={t("Remaining Quantity")}>
                          {quantityFormat.format(row.quantity)}
                        </td>
                        <td data-label={t("Expiry Date")}>
                          {row.expiryDate
                            ? formatDate(row.expiryDate, language)
                            : t("No expiry date")}
                        </td>
                        <td data-label={t("Unit Cost")}>
                          {currencyFormat.format(row.unitCost)} AFN
                        </td>
                        <td data-label={t("Status")}>
                          <span
                            className={`batch-expiry__status batch-expiry__status--${rowStatus}`}
                          >
                            {statusLabel(rowStatus)}
                            {rowStatus === "expiring" &&
                              row.daysRemaining !== null && (
                                <small>
                                  {t("{count} days left").replace(
                                    "{count}",
                                    numberFormat.format(row.daysRemaining),
                                  )}
                                </small>
                              )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <BatchPagination
              page={page}
              pageSizeValue={rows.perPage || pageSize}
              total={rows.total}
              lastPage={rows.lastPage}
              setPage={setPage}
              numberFormat={numberFormat}
              t={t}
            />
          </>
        ) : null}
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  numberFormat,
  tone,
}: {
  label: string;
  value: number;
  numberFormat: Intl.NumberFormat;
  tone: ExpiryStatus | "total";
}) {
  return (
    <div className={`batch-expiry__summary-card batch-expiry__summary-card--${tone}`}>
      <span>{label}</span>
      <strong>{numberFormat.format(value)}</strong>
    </div>
  );
}

function BatchPagination({
  page,
  pageSizeValue,
  total,
  lastPage,
  setPage,
  numberFormat,
  t,
}: {
  page: number;
  pageSizeValue: number;
  total: number;
  lastPage: number;
  setPage: (page: number) => void;
  numberFormat: Intl.NumberFormat;
  t: Translate;
}) {
  const start = total ? (page - 1) * pageSizeValue + 1 : 0;
  const end = Math.min(page * pageSizeValue, total);
  return (
    <footer className="batch-expiry__pagination">
      <span>
        {t("Showing {start}-{end} of {total} batches")
          .replace("{start}", numberFormat.format(start))
          .replace("{end}", numberFormat.format(end))
          .replace("{total}", numberFormat.format(total))}
      </span>
      <div>
        <button
          type="button"
          onClick={() => setPage(page - 1)}
          disabled={page <= 1}
          aria-label={t("Previous page")}
        >
          <ChevronLeft size={16} aria-hidden="true" />
          {t("Previous")}
        </button>
        <span>
          {t("Page {page} of {lastPage}")
            .replace("{page}", numberFormat.format(page))
            .replace("{lastPage}", numberFormat.format(lastPage))}
        </span>
        <button
          type="button"
          onClick={() => setPage(page + 1)}
          disabled={page >= lastPage}
          aria-label={t("Next page")}
        >
          {t("Next")}
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </footer>
  );
}
