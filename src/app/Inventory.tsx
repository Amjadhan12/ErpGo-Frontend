import { useEffect, useState } from "react";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
} from "lucide-react";
import { api } from "@/lib/api";
import DatePeriodFilter from "@/app/DatePeriodFilter";
import { useLocale } from "@/lib/locale";
import {
  formatCurrency,
  formatQuantity,
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
} from "@/app/InventoryShared";

interface InventoryBalanceRow {
  id: number;
  warehouse: InventoryWarehouseOption;
  product: {
    id: number;
    name: string;
    sku: string | null;
    unit: string;
    category: string | null;
  };
  quantity: number;
  averageUnitCostAfn: number;
  minimumStock: number;
  stockValueAfn: number;
  stockStatus: "in_stock" | "low_stock" | "out_of_stock";
}

interface InventorySummary {
  productsCount: number;
  totalStockValueAfn: number;
  inStockCount: number;
  lowStockCount: number;
  outOfStockCount: number;
}

interface InventoryMovement {
  id: number;
  warehouse: string;
  product: string;
  sku: string | null;
  unit: string;
  movementType: string;
  quantityIn: number;
  quantityOut: number;
  unitCost: number | null;
  totalCost: number | null;
  referenceType: string | null;
  referenceId: number | null;
  movementDate: string;
  notes: string | null;
  creator: string | null;
}

interface MovementSummary {
  totalMovements: number;
  totalQuantityIn: number;
  totalQuantityOut: number;
  totalCostIn: number;
}

type InventoryTab = "balances" | "movements";
const pageSize = 10;

const movementTypes = [
  "purchase",
  "purchase_return",
  "sale",
  "sale_return",
  "opening_stock",
  "transfer_in",
  "transfer_out",
  "adjustment_in",
  "adjustment_out",
  "wastage_out",
];

function parseBalance(value: unknown): InventoryBalanceRow {
  if (
    !isRecord(value) ||
    !isRecord(value.warehouse) ||
    !isRecord(value.product) ||
    typeof value.stock_status !== "string"
  ) {
    throw new Error("The inventory report contains an incomplete balance row.");
  }
  const stockStatus = value.stock_status;
  if (
    stockStatus !== "in_stock" &&
    stockStatus !== "low_stock" &&
    stockStatus !== "out_of_stock"
  ) {
    throw new Error("The inventory report contains an unknown stock status.");
  }
  if (
    typeof value.warehouse.name !== "string" ||
    typeof value.product.name !== "string" ||
    typeof value.product.unit !== "string"
  ) {
    throw new Error(
      "The inventory report is missing product or warehouse names.",
    );
  }
  return {
    id: parseId(value.id, "inventory balance ID"),
    warehouse: {
      id: parseId(value.warehouse.id, "warehouse ID"),
      name: value.warehouse.name,
      location: optionalText(value.warehouse.location),
    },
    product: {
      id: parseId(value.product.id, "product ID"),
      name: value.product.name,
      sku: optionalText(value.product.sku),
      unit: value.product.unit,
      category: optionalText(value.product.category),
    },
    quantity: numberValue(value.quantity, "inventory quantity"),
    averageUnitCostAfn: numberValue(
      value.average_unit_cost_afn,
      "average unit cost",
    ),
    minimumStock: numberValue(value.minimum_stock, "minimum stock"),
    stockValueAfn: numberValue(value.stock_value_afn, "stock value"),
    stockStatus,
  };
}

function parseInventoryResponse(value: unknown): {
  rows: InventoryBalanceRow[];
  summary: InventorySummary;
} {
  if (
    !isRecord(value) ||
    !Array.isArray(value.data) ||
    !isRecord(value.summary)
  ) {
    throw new Error("The inventory report response was incomplete.");
  }
  return {
    rows: value.data.map(parseBalance),
    summary: {
      productsCount: numberValue(
        value.summary.products_count,
        "inventory record count",
      ),
      totalStockValueAfn: numberValue(
        value.summary.total_stock_value_afn,
        "total stock value",
      ),
      inStockCount: numberValue(value.summary.in_stock_count, "in-stock count"),
      lowStockCount: numberValue(
        value.summary.low_stock_count,
        "low-stock count",
      ),
      outOfStockCount: numberValue(
        value.summary.out_of_stock_count,
        "out-of-stock count",
      ),
    },
  };
}

function parseMovement(value: unknown): InventoryMovement {
  if (
    !isRecord(value) ||
    !isRecord(value.warehouse) ||
    !isRecord(value.product) ||
    typeof value.warehouse.name !== "string" ||
    typeof value.product.name !== "string" ||
    typeof value.product.unit !== "string" ||
    typeof value.movement_type !== "string" ||
    typeof value.movement_date !== "string"
  ) {
    throw new Error("The movement report contains an incomplete record.");
  }
  return {
    id: parseId(value.id, "movement ID"),
    warehouse: value.warehouse.name,
    product: value.product.name,
    sku: optionalText(value.product.sku),
    unit: value.product.unit,
    movementType: value.movement_type,
    quantityIn: numberValue(value.quantity_in, "quantity in"),
    quantityOut: numberValue(value.quantity_out, "quantity out"),
    unitCost:
      value.unit_cost === null
        ? null
        : numberValue(value.unit_cost, "unit cost"),
    totalCost:
      value.total_cost === null
        ? null
        : numberValue(value.total_cost, "total cost"),
    referenceType: optionalText(value.reference_type),
    referenceId:
      value.reference_id === null
        ? null
        : parseId(value.reference_id, "reference ID"),
    movementDate: value.movement_date,
    notes: optionalText(value.notes),
    creator: isRecord(value.creator) ? optionalText(value.creator.name) : null,
  };
}

function parseMovementSummary(value: unknown): MovementSummary {
  if (!isRecord(value) || !isRecord(value.summary)) {
    throw new Error("The movement report did not include summary data.");
  }
  return {
    totalMovements: numberValue(
      value.summary.total_movements,
      "movement count",
    ),
    totalQuantityIn: numberValue(
      value.summary.total_quantity_in,
      "total quantity in",
    ),
    totalQuantityOut: numberValue(
      value.summary.total_quantity_out,
      "total quantity out",
    ),
    totalCostIn: numberValue(value.summary.total_cost_in, "total inbound cost"),
  };
}

function formatMovementType(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

export default function Inventory() {
  const { t, language } = useLocale();
  const [tab, setTab] = useState<InventoryTab>("balances");
  const [balances, setBalances] = useState<InventoryBalanceRow[]>([]);
  const [inventorySummary, setInventorySummary] =
    useState<InventorySummary | null>(null);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [movementSummary, setMovementSummary] =
    useState<MovementSummary | null>(null);
  const [warehouses, setWarehouses] = useState<InventoryWarehouseOption[]>([]);
  const [products, setProducts] = useState<InventoryProductOption[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [productId, setProductId] = useState("");
  const [movementType, setMovementType] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      loadWarehouses(controller.signal),
      loadProducts(controller.signal),
    ])
      .then(([warehouseOptions, productOptions]) => {
        setWarehouses(warehouseOptions);
        setProducts(productOptions);
        setOptionsError(null);
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted)
          setOptionsError(getErrorMessage(loadError));
      });
    return () => controller.abort();
  }, [retry]);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    if (tab === "balances") {
      api
        .get<unknown>("/api/reports/inventory", {
          params: {
            warehouse_id: warehouseId || undefined,
            product_id: productId || undefined,
          },
          signal: controller.signal,
        })
        .then(({ data }) => {
          const parsed = parseInventoryResponse(data);
          setBalances(parsed.rows);
          setInventorySummary(parsed.summary);
        })
        .catch((loadError: unknown) => {
          if (!controller.signal.aborted) {
            setBalances([]);
            setInventorySummary(null);
            setError(getErrorMessage(loadError));
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoading(false);
        });
      return () => controller.abort();
    }

    const params = {
      warehouse_id: warehouseId || undefined,
      product_id: productId || undefined,
      movement_type: movementType || undefined,
      from_date: fromDate || undefined,
      to_date: toDate || undefined,
    };
    void (async () => {
      try {
        let currentPage = 1;
        let lastPage = 1;
        const allMovements: InventoryMovement[] = [];
        let summary: MovementSummary | null = null;
        do {
          const { data } = await api.get<unknown>(
            "/api/reports/inventory-movements",
            {
              params: { ...params, page: currentPage },
              signal: controller.signal,
            },
          );
          if (currentPage === 1) summary = parseMovementSummary(data);
          const parsed = parseLaravelPage(data, parseMovement);
          allMovements.push(...parsed.data);
          lastPage = parsed.lastPage;
          currentPage += 1;
        } while (currentPage <= lastPage && !controller.signal.aborted);
        if (!controller.signal.aborted) {
          setMovements(allMovements);
          setMovementSummary(summary);
        }
      } catch (loadError: unknown) {
        if (!controller.signal.aborted) {
          setMovements([]);
          setMovementSummary(null);
          setError(getErrorMessage(loadError));
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    })();
    return () => controller.abort();
  }, [tab, warehouseId, productId, movementType, fromDate, toDate, retry]);

  useEffect(
    () => setPage(1),
    [tab, warehouseId, productId, movementType, fromDate, toDate, search],
  );

  const filteredBalances = balances.filter((row) => {
    const needle = search.trim().toLowerCase();
    return (
      !needle ||
      [row.product.name, row.product.sku ?? "", row.warehouse.name].some(
        (value) => value.toLowerCase().includes(needle),
      )
    );
  });
  const filteredMovements = movements.filter((movement) => {
    const needle = search.trim().toLowerCase();
    return (
      !needle ||
      [
        movement.product,
        movement.sku ?? "",
        movement.warehouse,
        movement.movementType,
        movement.referenceType ?? "",
        movement.referenceId === null ? "" : String(movement.referenceId),
        movement.notes ?? "",
      ].some((value) => value.toLowerCase().includes(needle))
    );
  });
  const activeRows = tab === "balances" ? filteredBalances : filteredMovements;
  const lastPage = Math.max(1, Math.ceil(activeRows.length / pageSize));
  const pageRows = activeRows.slice((page - 1) * pageSize, page * pageSize);
  const startRecord = activeRows.length ? (page - 1) * pageSize + 1 : 0;
  const endRecord = Math.min(page * pageSize, activeRows.length);

  function updateFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  return (
    <div className="purchases-page inventory-page">
      <header className="purchases-heading">
        <div>
          <p className="overview-eyebrow">{t("INVENTORY")}</p>
          <h1>{t("Inventory")}</h1>
          <p className="overview-heading__description">
            {t("Stock balances, valuation, and movement history.")}
          </p>
        </div>
        <button
          className="overview-refresh"
          type="button"
          onClick={() => setRetry((current) => current + 1)}
          disabled={isLoading}
          aria-label={t("Refresh inventory")}
        >
          <RefreshCw
            size={16}
            className={isLoading ? "overview-refresh__spinning" : ""}
            aria-hidden="true"
          />
          <span>{t("Refresh")}</span>
        </button>
      </header>

      {inventorySummary && tab === "balances" && (
        <section
          className="inventory-summary"
          aria-label={t("Inventory summary")}
        >
          <div>
            <span>{t("Balance records")}</span>
            <strong>{formatQuantity(inventorySummary.productsCount)}</strong>
          </div>
          <div>
            <span>{t("Stock value")}</span>
            <strong>
              {formatCurrency(inventorySummary.totalStockValueAfn)}
            </strong>
          </div>
          <div>
            <span>{t("In stock")}</span>
            <strong>{formatQuantity(inventorySummary.inStockCount)}</strong>
          </div>
          <div>
            <span>{t("Low stock")}</span>
            <strong className="inventory-summary__low">
              {formatQuantity(inventorySummary.lowStockCount)}
            </strong>
          </div>
          <div>
            <span>{t("Out of stock")}</span>
            <strong className="inventory-summary__out">
              {formatQuantity(inventorySummary.outOfStockCount)}
            </strong>
          </div>
        </section>
      )}

      <section
        className="purchases-panel inventory-panel"
        aria-label={t("Inventory records")}
      >
        <div
          className="inventory-tabs"
          role="tablist"
          aria-label={t("Inventory views")}
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "balances"}
            className={
              tab === "balances"
                ? "inventory-tab inventory-tab--active"
                : "inventory-tab"
            }
            onClick={() => setTab("balances")}
          >
            {t("Stock Balances")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "movements"}
            className={
              tab === "movements"
                ? "inventory-tab inventory-tab--active"
                : "inventory-tab"
            }
            onClick={() => setTab("movements")}
          >
            {t("Movement History")}
          </button>
        </div>

        <div className="inventory-filters">
          <label className="inventory-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => updateFilter(setSearch, event.target.value)}
              placeholder={
                tab === "balances"
                  ? t("Search product or warehouse")
                  : t("Search loaded movement records")
              }
              aria-label={t("Search inventory records")}
            />
          </label>
          <label className="inventory-filter">
            <span>{t("Warehouse")}</span>
            <select
              value={warehouseId}
              onChange={(event) =>
                updateFilter(setWarehouseId, event.target.value)
              }
            >
              <option value="">{t("All warehouses")}</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </select>
          </label>
          <label className="inventory-filter">
            <span>{t("Product")}</span>
            <select
              value={productId}
              onChange={(event) =>
                updateFilter(setProductId, event.target.value)
              }
            >
              <option value="">{t("All products")}</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                  {product.sku ? ` · ${product.sku}` : ""}
                </option>
              ))}
            </select>
          </label>
          {tab === "movements" && (
            <>
              <label className="inventory-filter">
                <span>{t("Movement Type")}</span>
                <select
                  value={movementType}
                  onChange={(event) =>
                    updateFilter(setMovementType, event.target.value)
                  }
                >
                  <option value="">{t("All types")}</option>
                  {movementTypes.map((type) => (
                    <option key={type} value={type}>
                      {t(formatMovementType(type))}
                    </option>
                  ))}
                </select>
              </label>
              <DatePeriodFilter
                className="inventory-period-filter"
                fromDate={fromDate}
                toDate={toDate}
                translate={t}
                locale={language === "ps" ? "ps-AF" : "en"}
                onApply={(nextFromDate, nextToDate) => {
                  setFromDate(nextFromDate);
                  setToDate(nextToDate);
                  setPage(1);
                }}
              />
            </>
          )}
        </div>

        {optionsError && (
          <p className="inventory-inline-error" role="alert">
            {t("Filter options could not be loaded:")} {t(optionsError)}
          </p>
        )}
        {error ? (
          <div className="purchases-state purchases-state--error" role="alert">
            <AlertCircle size={20} aria-hidden="true" />
            <span>{t(error)}</span>
            <button
              type="button"
              className="purchases-retry"
              onClick={() => setRetry((current) => current + 1)}
            >
              {t("Try again")}
            </button>
          </div>
        ) : isLoading ? (
          <div className="purchases-state" role="status">
            <span className="loading-spinner" /> {t("Loading inventory…")}
          </div>
        ) : pageRows.length === 0 ? (
          <div className="purchases-state purchases-state--empty">
            <strong>
              {search ||
              warehouseId ||
              productId ||
              movementType ||
              fromDate ||
              toDate
                ? t("No records match these filters")
                : t("No inventory records")}
            </strong>
            <span>{t("Adjust the filters or check inventory activity.")}</span>
          </div>
        ) : tab === "balances" ? (
          <>
            <div className="purchases-table-scroll">
              <table className="purchases-table inventory-balance-table">
                <thead>
                  <tr>
                    <th>{t("Product")}</th>
                    <th>{t("SKU")}</th>
                    <th>{t("Category")}</th>
                    <th>{t("Warehouse")}</th>
                    <th className="purchases-table__numeric">
                      {t("Quantity")}
                    </th>
                    <th className="purchases-table__numeric">
                      {t("Average Cost")}
                    </th>
                    <th className="purchases-table__numeric">
                      {t("Stock Value")}
                    </th>
                    <th>{t("Status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => {
                    if (!("stockStatus" in row)) return null;
                    return (
                      <tr key={row.id}>
                        <td data-label={t("Product")}>
                          <strong className="purchases-number">
                            {row.product.name}
                          </strong>
                          <small className="inventory-unit">
                            {row.product.unit}
                          </small>
                        </td>
                        <td data-label={t("SKU")}>
                          {row.product.sku || "—"}
                        </td>
                        <td data-label={t("Category")}>
                          {row.product.category || "—"}
                        </td>
                        <td data-label={t("Warehouse")}>
                          {row.warehouse.name}
                        </td>
                        <td
                          className="purchases-table__numeric"
                          data-label={t("Quantity")}
                        >
                          {formatQuantity(row.quantity)} {row.product.unit}
                        </td>
                        <td
                          className="purchases-table__numeric"
                          data-label={t("Average Cost")}
                        >
                          {formatCurrency(row.averageUnitCostAfn)}
                        </td>
                        <td
                          className="purchases-table__numeric purchases-total"
                          data-label={t("Stock Value")}
                        >
                          {formatCurrency(row.stockValueAfn)}
                        </td>
                        <td data-label={t("Status")}>
                          <span
                            className={`product-status product-status--${row.stockStatus}`}
                          >
                            {t(
                              row.stockStatus === "in_stock"
                                ? "In stock"
                                : row.stockStatus === "low_stock"
                                  ? "Low stock"
                                  : "Out of stock",
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              start={startRecord}
              end={endRecord}
              total={activeRows.length}
              page={page}
              lastPage={lastPage}
              setPage={setPage}
              translate={t}
            />
          </>
        ) : (
          <>
            {movementSummary && (
              <div className="inventory-movement-summary">
                <span>
                  {formatQuantity(movementSummary.totalMovements)}{" "}
                  {t("movements")}
                </span>
                <span>
                  {t("In")} {formatQuantity(movementSummary.totalQuantityIn)}
                </span>
                <span>
                  {t("Out")} {formatQuantity(movementSummary.totalQuantityOut)}
                </span>
                <span>
                  {t("Inbound cost")}{" "}
                  {formatCurrency(movementSummary.totalCostIn)}
                </span>
              </div>
            )}
            <div className="purchases-table-scroll">
              <table className="purchases-table inventory-movement-table">
                <thead>
                  <tr>
                    <th>{t("Date")}</th>
                    <th>{t("Type")}</th>
                    <th>{t("Product")}</th>
                    <th>{t("Warehouse")}</th>
                    <th className="purchases-table__numeric">{t("In")}</th>
                    <th className="purchases-table__numeric">{t("Out")}</th>
                    <th className="purchases-table__numeric">
                      {t("Unit Cost")}
                    </th>
                    <th className="purchases-table__numeric">
                      {t("Total Cost")}
                    </th>
                    <th>{t("Reference")}</th>
                    <th>{t("Notes")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => {
                    if (!("movementType" in row)) return null;
                    return (
                      <tr key={row.id}>
                        <td data-label={t("Date")}>
                          {formatDate(
                            row.movementDate,
                            language === "ps" ? "ps-AF" : "en",
                          )}
                        </td>
                        <td data-label={t("Type")}>
                          {t(formatMovementType(row.movementType))}
                        </td>
                        <td data-label={t("Product")}>
                          <strong>{row.product}</strong>
                          {row.sku && (
                            <small className="inventory-unit">
                              {row.sku} · {row.unit}
                            </small>
                          )}
                        </td>
                        <td data-label={t("Warehouse")}>{row.warehouse}</td>
                        <td
                          className="purchases-table__numeric"
                          data-label={t("In")}
                        >
                          {row.quantityIn
                            ? formatQuantity(row.quantityIn)
                            : "—"}
                        </td>
                        <td
                          className="purchases-table__numeric"
                          data-label={t("Out")}
                        >
                          {row.quantityOut
                            ? formatQuantity(row.quantityOut)
                            : "—"}
                        </td>
                        <td
                          className="purchases-table__numeric"
                          data-label={t("Unit Cost")}
                        >
                          {row.unitCost === null
                            ? "—"
                            : formatCurrency(row.unitCost)}
                        </td>
                        <td
                          className="purchases-table__numeric"
                          data-label={t("Total Cost")}
                        >
                          {row.totalCost === null
                            ? "—"
                            : formatCurrency(row.totalCost)}
                        </td>
                        <td data-label={t("Reference")}>
                          {row.referenceType
                            ? `${row.referenceType.split("\\").pop()} #${row.referenceId ?? "—"}`
                            : "—"}
                        </td>
                        <td
                          className="inventory-notes-cell"
                          data-label={t("Notes")}
                        >
                          {row.notes || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              start={startRecord}
              end={endRecord}
              total={activeRows.length}
              page={page}
              lastPage={lastPage}
              setPage={setPage}
              translate={t}
            />
          </>
        )}
      </section>
    </div>
  );
}

function Pagination({
  start,
  end,
  total,
  page,
  lastPage,
  setPage,
  translate,
}: {
  start: number;
  end: number;
  total: number;
  page: number;
  lastPage: number;
  setPage: (page: number) => void;
  translate: (text: string) => string;
}) {
  return (
    <footer className="purchases-pagination">
      <span>
        {translate("Showing")} {start}-{end} {translate("of")}{" "}
        {new Intl.NumberFormat().format(total)} {translate("records")}
      </span>
      <div className="purchases-pagination__controls">
        <button
          type="button"
          onClick={() => setPage(page - 1)}
          disabled={page <= 1}
          aria-label={translate("Previous page")}
        >
          <ChevronLeft size={16} aria-hidden="true" /> {translate("Previous")}
        </button>
        <span>
          {translate("Page")} <strong>{page}</strong> {translate("of")}{" "}
          <strong>{lastPage}</strong>
        </span>
        <button
          type="button"
          onClick={() => setPage(page + 1)}
          disabled={page >= lastPage}
          aria-label={translate("Next page")}
        >
          {translate("Next")} <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </footer>
  );
}
