import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Eye,
  PackageX,
  Warehouse,
} from "lucide-react";
import { api } from "@/lib/api";
import {
  getErrorMessage,
  getValidationResult,
  isRecord,
  loadProducts,
  loadWarehouses,
  numberValue,
  optionalText,
  parseId,
  parseLaravelPage,
  todayValue,
  type InventoryFieldErrors,
  type InventoryProductOption,
  type InventoryWarehouseOption,
  type LaravelPage,
} from "@/app/InventoryShared";
import { useLocale } from "@/lib/locale";

interface WastageAllocation {
  batchNumber: string | null;
  expiryDate: string | null;
  quantity: number;
}

interface WastageItem {
  id: number;
  productId: number;
  product: string;
  sku: string | null;
  unit: string | null;
  quantity: number;
  unitCostAfn: number | null;
  totalCostAfn: number | null;
  reason: string;
  notes: string | null;
  allocations: WastageAllocation[];
}

interface Wastage {
  id: number;
  number: string;
  date: string;
  warehouse: string | null;
  creator: string | null;
  notes: string | null;
  items: WastageItem[];
}

type Translate = (text: string) => string;

const pageSize = 20;

function parseAllocation(value: unknown): WastageAllocation {
  if (!isRecord(value)) {
    throw new Error("The wastage response contains an invalid batch allocation.");
  }
  return {
    batchNumber: optionalText(value.batch_number),
    expiryDate: optionalText(value.expiry_date),
    quantity: numberValue(value.quantity, "allocated quantity"),
  };
}

function parseWastageItem(value: unknown): WastageItem {
  if (!isRecord(value)) {
    throw new Error("The wastage response contains an invalid item.");
  }
  const product = isRecord(value.product) ? value.product : null;
  const allocations = Array.isArray(value.batch_allocations)
    ? value.batch_allocations.map(parseAllocation)
    : [];
  return {
    id: parseId(value.id, "wastage item ID"),
    productId: parseId(value.product_id, "product ID"),
    product: product && typeof product.name === "string"
      ? product.name
      : "—",
    sku: optionalText(product?.sku),
    unit: optionalText(product?.unit),
    quantity: numberValue(value.quantity, "wastage quantity"),
    unitCostAfn:
      value.unit_cost_afn == null
        ? null
        : numberValue(value.unit_cost_afn, "unit cost"),
    totalCostAfn:
      value.total_cost_afn == null
        ? null
        : numberValue(value.total_cost_afn, "total cost"),
    reason: typeof value.reason === "string" ? value.reason : "",
    notes: optionalText(value.notes),
    allocations,
  };
}

function parseWastage(value: unknown): Wastage {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("The wastage response is incomplete.");
  }
  const warehouse = isRecord(value.warehouse) ? value.warehouse : null;
  const creator = isRecord(value.creator) ? value.creator : null;
  if (
    typeof value.wastage_number !== "string" ||
    typeof value.wastage_date !== "string"
  ) {
    throw new Error("The wastage response contains an incomplete record.");
  }
  return {
    id: parseId(value.id, "wastage ID"),
    number: value.wastage_number,
    date: value.wastage_date,
    warehouse:
      warehouse && typeof warehouse.name === "string" ? warehouse.name : null,
    creator: optionalText(creator?.name),
    notes: optionalText(value.notes),
    items: value.items.map(parseWastageItem),
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

function translateWastageMessage(
  message: string,
  t: Translate,
  language: "en" | "ps",
  fallback = true,
): string {
  const insufficientStock = message.match(
    /^Insufficient stock for product (\d+)\. Available: ([\d.,]+)$/,
  );
  if (insufficientStock) {
    return t("Insufficient stock for product {id}. Available: {available}.")
      .replace("{id}", insufficientStock[1])
      .replace("{available}", insufficientStock[2]);
  }
  const insufficientBatches = message.match(
    /^Insufficient batch stock for product (\d+)\.$/,
  );
  if (insufficientBatches) {
    return t("Insufficient batch stock for product {id}.").replace(
      "{id}",
      insufficientBatches[1],
    );
  }
  const translated = t(message);
  if (translated !== message) return translated;
  return language === "ps" && fallback
    ? t("The wastage request could not be completed. Please try again.")
    : message;
}

function translateFieldMessage(
  message: string,
  t: Translate,
  language: "en" | "ps",
): string {
  const translated = translateWastageMessage(message, t, language, false);
  if (translated !== message || language === "en") return translated;
  if (/field is required\.$/i.test(message)) return t("This field is required.");
  if (/must be greater than 0\.$/i.test(message))
    return t("Enter a quantity greater than zero.");
  if (/must have 4 decimal places or fewer\.$/i.test(message))
    return t("Quantity can have up to 4 decimal places.");
  if (/must not be greater than 100 characters\.$/i.test(message))
    return t("This field cannot exceed 100 characters.");
  if (/selected .* is invalid\.$/i.test(message))
    return t("Choose a valid option.");
  return t("Please check this field and try again.");
}

export default function StockWastage() {
  const { direction, language, t } = useLocale();
  const [warehouses, setWarehouses] = useState<InventoryWarehouseOption[]>([]);
  const [products, setProducts] = useState<InventoryProductOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [rows, setRows] = useState<LaravelPage<Wastage> | null>(null);
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<InventoryFieldErrors>({});
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Wastage | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRetry, setDetailRetry] = useState(0);
  const [warehouseId, setWarehouseId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(todayValue);
  const [notes, setNotes] = useState("");

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
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setOptionsError(
            translateWastageMessage(getErrorMessage(error), t, language),
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
    setListError(null);
    api
      .get<unknown>("/api/stock-wastages", {
        params: { page, per_page: pageSize },
        signal: controller.signal,
      })
      .then(({ data }) => setRows(parseLaravelPage(data, parseWastage)))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setRows(null);
          setListError(
            translateWastageMessage(getErrorMessage(error), t, language),
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [page, retry, t, language]);

  useEffect(() => {
    if (detailId === null) return;
    const controller = new AbortController();
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    api
      .get<unknown>(`/api/stock-wastages/${detailId}`, {
        signal: controller.signal,
      })
      .then(({ data }) => {
        if (!isRecord(data) || !("data" in data)) {
          throw new Error("The wastage details response was incomplete.");
        }
        setDetail(parseWastage(data.data));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setDetailError(
            translateWastageMessage(getErrorMessage(error), t, language),
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [detailId, detailRetry, t, language]);

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(null), 6000);
    return () => window.clearTimeout(timer);
  }, [success]);

  function updateField(field: string, value: string) {
    switch (field) {
      case "warehouse_id":
        setWarehouseId(value);
        break;
      case "items.0.product_id":
        setProductId(value);
        break;
      case "items.0.quantity":
        setQuantity(value);
        break;
      case "wastage_date":
        setDate(value);
        break;
      case "items.0.reason":
        setReason(value);
        break;
      case "notes":
        setNotes(value);
        break;
    }
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setFormError(null);
  }

  function applyValidation(error: unknown) {
    const result = getValidationResult(error);
    const mapped: InventoryFieldErrors = {};
    for (const [field, message] of Object.entries(result.fields)) {
      mapped[field] = translateFieldMessage(message, t, language);
    }
    setFieldErrors(mapped);
    setFormError(
      mapped.items ??
      (result.message === "The given data was invalid."
        ? t("Please correct the highlighted fields.")
        : translateWastageMessage(result.message, t, language)),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    const nextErrors: InventoryFieldErrors = {};
    if (!warehouseId) nextErrors.warehouse_id = t("Select a warehouse.");
    if (!date) nextErrors.wastage_date = t("Select a wastage date.");
    if (!productId)
      nextErrors["items.0.product_id"] = t("Select a product.");
    const numericQuantity = Number(quantity);
    if (
      !quantity ||
      !Number.isFinite(numericQuantity) ||
      numericQuantity <= 0
    ) {
      nextErrors["items.0.quantity"] = t(
        "Enter a quantity greater than zero.",
      );
    } else if (!/^(?:\d+(?:\.\d{1,4})?|\.\d{1,4})$/.test(quantity)) {
      nextErrors["items.0.quantity"] = t(
        "Quantity can have up to 4 decimal places.",
      );
    }
    if (!reason.trim()) nextErrors["items.0.reason"] = t("Enter a reason.");
    if (reason.trim().length > 100)
      nextErrors["items.0.reason"] = t(
        "This field cannot exceed 100 characters.",
      );
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setFormError(t("Please correct the highlighted fields."));
      return;
    }
    setIsSaving(true);
    setFormError(null);
    setSuccess(null);
    try {
      await api.post("/api/stock-wastages", {
        warehouse_id: Number(warehouseId),
        wastage_date: date,
        notes: notes || null,
        items: [
          {
            product_id: Number(productId),
            quantity: Number(quantity),
            reason,
          },
        ],
      });
      setSuccess(t("Stock wastage recorded."));
      setProductId("");
      setQuantity("");
      setReason("");
      setNotes("");
      setPage(1);
      setRetry((value) => value + 1);
    } catch (error: unknown) {
      applyValidation(error);
    } finally {
      setIsSaving(false);
    }
  }

  const pageSizeValue = rows?.perPage ?? pageSize;
  const selectedProduct = products.find(
    (productOption) => String(productOption.id) === productId,
  );

  return (
    <div className="stock-wastage" dir={direction} lang={language}>
      <header className="stock-wastage__heading">
        <div>
          <p className="stock-wastage__eyebrow">{t("INVENTORY")}</p>
          <h1>{t("Stock Wastage")}</h1>
          <p>{t("Record damaged, expired, or unusable stock.")}</p>
        </div>
        <span className="stock-wastage__heading-icon">
          <PackageX size={23} aria-hidden="true" />
        </span>
      </header>

      {success && (
        <p className="stock-wastage__success" role="status">
          <span aria-hidden="true">✓</span>
          {success}
        </p>
      )}

      <section
        className="stock-wastage__form-card"
        aria-labelledby="stock-wastage-form-title"
      >
        <header className="stock-wastage__card-heading">
          <div>
            <span className="stock-wastage__form-mark">
              <PackageX size={19} aria-hidden="true" />
            </span>
            <div>
              <p className="stock-wastage__eyebrow">{t("INVENTORY")}</p>
              <h2 id="stock-wastage-form-title">{t("Record Wastage")}</h2>
            </div>
          </div>
        </header>

        {optionsError && (
          <div className="stock-wastage__alert" role="alert">
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
          <p className="stock-wastage__loading-options" role="status">
            <span className="stock-wastage__spinner" />
            {t("Loading warehouses and products…")}
          </p>
        )}

        <form
          className="stock-wastage__form"
          onSubmit={(event) => void submit(event)}
          noValidate
        >
          <section className="stock-wastage__form-section">
            <div className="stock-wastage__section-heading">
              <span className="stock-wastage__step">1</span>
              <div>
                <h3>{t("Wastage Information")}</h3>
                <p>{t("Choose the warehouse and date for this wastage record.")}</p>
              </div>
            </div>
            <div className="stock-wastage__fields">
              <label className="stock-wastage__field">
                <span>
                  {t("Warehouse")} <i>*</i>
                </span>
                <select
                  value={warehouseId}
                  onChange={(event) =>
                    updateField("warehouse_id", event.target.value)
                  }
                  disabled={optionsLoading || Boolean(optionsError)}
                  aria-invalid={Boolean(fieldErrors.warehouse_id)}
                >
                  <option value="">{t("Select warehouse")}</option>
                  {warehouses.map((warehouseOption) => (
                    <option value={warehouseOption.id} key={warehouseOption.id}>
                      {warehouseOption.name}
                    </option>
                  ))}
                </select>
                {fieldErrors.warehouse_id && (
                  <small className="stock-wastage__field-error">
                    {fieldErrors.warehouse_id}
                  </small>
                )}
              </label>

              <label className="stock-wastage__field">
                <span>
                  {t("Wastage Date")} <i>*</i>
                </span>
                <input
                  type="date"
                  value={date}
                  onChange={(event) =>
                    updateField("wastage_date", event.target.value)
                  }
                  aria-invalid={Boolean(fieldErrors.wastage_date)}
                />
                {fieldErrors.wastage_date && (
                  <small className="stock-wastage__field-error">
                    {fieldErrors.wastage_date}
                  </small>
                )}
              </label>
              <label className="stock-wastage__field stock-wastage__field--wide">
                <span>{t("Notes")}</span>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(event) => updateField("notes", event.target.value)}
                  aria-invalid={Boolean(fieldErrors.notes)}
                  placeholder={t("Add optional wastage notes")}
                />
                {fieldErrors.notes && (
                  <small className="stock-wastage__field-error">
                    {fieldErrors.notes}
                  </small>
                )}
              </label>
            </div>
          </section>

          <section className="stock-wastage__form-section">
            <div className="stock-wastage__section-heading">
              <span className="stock-wastage__step">2</span>
              <div>
                <h3>{t("Wastage Product")}</h3>
                <p>{t("Select the affected product, quantity, and reason.")}</p>
              </div>
            </div>
            <div className="stock-wastage__fields stock-wastage__fields--indented">
              <label className="stock-wastage__field">
                <span>
                  {t("Product")} <i>*</i>
                </span>
                <select
                  value={productId}
                  onChange={(event) =>
                    updateField("items.0.product_id", event.target.value)
                  }
                  disabled={optionsLoading || Boolean(optionsError)}
                  aria-invalid={Boolean(fieldErrors["items.0.product_id"])}
                >
                  <option value="">{t("Select a product")}</option>
                  {products.map((productOption) => (
                    <option value={productOption.id} key={productOption.id}>
                      {productOption.name}
                      {productOption.sku ? ` · ${productOption.sku}` : ""}
                    </option>
                  ))}
                </select>
                {fieldErrors["items.0.product_id"] && (
                  <small className="stock-wastage__field-error">
                    {fieldErrors["items.0.product_id"]}
                  </small>
                )}
              </label>

              <label className="stock-wastage__field">
                <span>
                  {t("Quantity")} <i>*</i>
                </span>
                <div className="stock-wastage__quantity-control">
                  <input
                    type="number"
                    min="0.0001"
                    step="0.0001"
                    value={quantity}
                    onChange={(event) =>
                      updateField("items.0.quantity", event.target.value)
                    }
                    aria-invalid={Boolean(fieldErrors["items.0.quantity"])}
                  />
                  {selectedProduct?.unit && (
                    <span className="stock-wastage__unit">
                      {selectedProduct.unit}
                    </span>
                  )}
                </div>
                {fieldErrors["items.0.quantity"] && (
                  <small className="stock-wastage__field-error">
                    {fieldErrors["items.0.quantity"]}
                  </small>
                )}
              </label>

              <label className="stock-wastage__field stock-wastage__field--wide">
                <span>
                  {t("Reason")} <i>*</i>
                </span>
                <input
                  maxLength={100}
                  value={reason}
                  onChange={(event) =>
                    updateField("items.0.reason", event.target.value)
                  }
                  aria-invalid={Boolean(fieldErrors["items.0.reason"])}
                />
                {fieldErrors["items.0.reason"] && (
                  <small className="stock-wastage__field-error">
                    {fieldErrors["items.0.reason"]}
                  </small>
                )}
              </label>
            </div>
          </section>

          {formError && (
            <p className="stock-wastage__form-error" role="alert">
              <AlertCircle size={17} aria-hidden="true" />
              {formError}
            </p>
          )}

          <footer className="stock-wastage__form-actions">
            <p>{t("Wastage is deducted from available batches by earliest expiry.")}</p>
            <button
              className="stock-wastage__primary"
              type="submit"
              disabled={
                isSaving ||
                optionsLoading ||
                Boolean(optionsError) ||
                !warehouses.length ||
                !products.length
              }
            >
              <PackageX size={17} aria-hidden="true" />
              {isSaving ? t("Saving…") : t("Record Wastage")}
            </button>
          </footer>
        </form>
      </section>

      <section
        className="stock-wastage__list-card"
        aria-label={t("Stock wastage records")}
      >
        <header className="stock-wastage__list-heading">
          <div className="stock-wastage__list-icon">
            <CalendarDays size={19} aria-hidden="true" />
          </div>
          <div>
            <h2>{t("Wastage History")}</h2>
            <p>{t("Review previous stock wastage records.")}</p>
          </div>
          {rows && !isLoading && (
            <span className="stock-wastage__record-count">
              {t("{count} wastage records").replace(
                "{count}",
                numberFormat.format(rows.total),
              )}
            </span>
          )}
        </header>

        {isLoading ? (
          <div className="stock-wastage__state" role="status">
            <span className="stock-wastage__spinner" />
            {t("Loading wastage…")}
          </div>
        ) : listError ? (
          <div
            className="stock-wastage__state stock-wastage__state--error"
            role="alert"
          >
            <AlertCircle size={21} aria-hidden="true" />
            <span>{listError}</span>
            <button
              className="stock-wastage__text-button"
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              {t("Try again")}
            </button>
          </div>
        ) : rows && rows.data.length === 0 ? (
          <div className="stock-wastage__state stock-wastage__state--empty">
            <span className="stock-wastage__empty-icon">
              <PackageX size={21} aria-hidden="true" />
            </span>
            <strong>{t("No wastage records yet.")}</strong>
            <span>{t("Recorded wastage will appear here.")}</span>
          </div>
        ) : rows ? (
          <>
            <div className="stock-wastage__table-scroll">
              <table className="stock-wastage__table">
                <thead>
                  <tr>
                    <th>{t("Reference Number")}</th>
                    <th>{t("Wastage Date")}</th>
                    <th>{t("Warehouse")}</th>
                    <th>{t("Products")}</th>
                    <th>{t("Created By")}</th>
                    <th>{t("Details")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.data.map((record) => (
                    <tr key={record.id}>
                      <td data-label={t("Reference Number")}>
                        <strong className="stock-wastage__number">
                          {record.number}
                        </strong>
                      </td>
                      <td data-label={t("Wastage Date")}>
                        {formatDate(record.date, language)}
                      </td>
                      <td data-label={t("Warehouse")}>
                        <span className="stock-wastage__warehouse">
                          <Warehouse size={15} aria-hidden="true" />
                          {record.warehouse || "—"}
                        </span>
                      </td>
                      <td data-label={t("Products")}>
                        <span className="stock-wastage__product-count">
                          {numberFormat.format(record.items.length)}
                        </span>
                      </td>
                      <td data-label={t("Created By")}>
                        {record.creator || "—"}
                      </td>
                      <td data-label={t("Details")}>
                        <button
                          className="stock-wastage__details-button"
                          type="button"
                          onClick={() => {
                            setDetailRetry(0);
                            setDetailId(record.id);
                          }}
                        >
                          <Eye size={16} aria-hidden="true" />
                          {t("Details")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <WastagePagination
              page={page}
              pageSize={pageSizeValue}
              total={rows.total}
              lastPage={rows.lastPage}
              setPage={setPage}
              numberFormat={numberFormat}
              t={t}
            />
          </>
        ) : null}
      </section>

      {detailId !== null && (
        <div className="stock-wastage__backdrop">
          <section
            className="stock-wastage__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="stock-wastage-detail-title"
          >
            <header className="stock-wastage__dialog-heading">
              <div>
                <p className="stock-wastage__eyebrow">{t("WASTAGE DETAILS")}</p>
                <h2 id="stock-wastage-detail-title">
                  {detail?.number ?? t("Stock Wastage")}
                </h2>
                <p>
                  {detail
                    ? t("Recorded on {date}").replace(
                        "{date}",
                        formatDate(detail.date, language),
                      )
                    : t("Wastage record details")}
                </p>
              </div>
              <span className="stock-wastage__dialog-mark">
                <PackageX size={21} aria-hidden="true" />
              </span>
            </header>

            <div className="stock-wastage__dialog-body">
              {detailLoading ? (
                <div className="stock-wastage__state" role="status">
                  <span className="stock-wastage__spinner" />
                  {t("Loading wastage details…")}
                </div>
              ) : detailError ? (
                <div
                  className="stock-wastage__state stock-wastage__state--error"
                  role="alert"
                >
                  <AlertCircle size={20} aria-hidden="true" />
                  <span>{detailError}</span>
                  <button
                    className="stock-wastage__text-button"
                    type="button"
                    onClick={() => setDetailRetry((value) => value + 1)}
                  >
                    {t("Retry")}
                  </button>
                </div>
              ) : detail ? (
                <>
                  <div className="stock-wastage__warehouse-summary">
                    <span className="stock-wastage__warehouse-summary-icon">
                      <Warehouse size={19} aria-hidden="true" />
                    </span>
                    <div>
                      <span>{t("Warehouse")}</span>
                      <strong>{detail.warehouse || "—"}</strong>
                    </div>
                  </div>
                  <dl className="stock-wastage__meta">
                    <div>
                      <dt>{t("Wastage Date")}</dt>
                      <dd>{formatDate(detail.date, language)}</dd>
                    </div>
                    <div>
                      <dt>{t("Reference Number")}</dt>
                      <dd>{detail.number}</dd>
                    </div>
                    <div>
                      <dt>{t("Created By")}</dt>
                      <dd>{detail.creator || "—"}</dd>
                    </div>
                    <div className="stock-wastage__notes">
                      <dt>{t("Notes")}</dt>
                      <dd>{detail.notes || t("No notes")}</dd>
                    </div>
                  </dl>

                  <div className="stock-wastage__detail-products">
                    <div className="stock-wastage__detail-heading">
                      <h3>{t("Products")}</h3>
                      <span>
                        {t("{count} products").replace(
                          "{count}",
                          numberFormat.format(detail.items.length),
                        )}
                      </span>
                    </div>
                    <div className="stock-wastage__table-scroll">
                      <table className="stock-wastage__table stock-wastage__detail-table">
                        <thead>
                          <tr>
                            <th>{t("Product")}</th>
                            <th>{t("Quantity")}</th>
                            <th>{t("Reason")}</th>
                            <th>{t("Notes")}</th>
                            <th>{t("Batch Allocations")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.items.map((item) => (
                            <tr key={item.id}>
                              <td data-label={t("Product")}>
                                <strong>{item.product}</strong>
                                {item.sku && (
                                  <small className="stock-wastage__sku">
                                    {item.sku}
                                  </small>
                                )}
                              </td>
                              <td data-label={t("Quantity")}>
                                {quantityFormat.format(item.quantity)}{" "}
                                {item.unit || "—"}
                              </td>
                              <td data-label={t("Reason")}>{item.reason || "—"}</td>
                              <td data-label={t("Notes")}>
                                {item.notes || "—"}
                              </td>
                              <td data-label={t("Batch Allocations")}>
                                {item.allocations.length ? (
                                  <ul className="stock-wastage__allocations">
                                    {item.allocations.map((allocation, index) => (
                                      <li key={`${item.id}-${index}`}>
                                        <strong>
                                          {t("Batch Number")}:{" "}
                                          {allocation.batchNumber ||
                                            t("Not recorded")}
                                        </strong>
                                        <span>
                                          {t("Allocated Quantity")}:{" "}
                                          {quantityFormat.format(
                                            allocation.quantity,
                                          )}
                                          {item.unit ? ` ${item.unit}` : ""}
                                        </span>
                                        <span>
                                          {t("Expiry Date")}:{" "}
                                          {allocation.expiryDate
                                            ? formatDate(
                                                allocation.expiryDate,
                                                language,
                                              )
                                            : t("No expiry date")}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  "—"
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : null}
            </div>

            <footer className="stock-wastage__dialog-footer">
              <button
                className="stock-wastage__primary"
                type="button"
                onClick={() => {
                  setDetailId(null);
                  setDetail(null);
                }}
              >
                {t("Cancel")}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

function WastagePagination({
  page,
  pageSize,
  total,
  lastPage,
  setPage,
  numberFormat,
  t,
}: {
  page: number;
  pageSize: number;
  total: number;
  lastPage: number;
  setPage: (page: number) => void;
  numberFormat: Intl.NumberFormat;
  t: Translate;
}) {
  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(page * pageSize, total);
  return (
    <footer className="stock-wastage__pagination">
      <span>
        {t("Showing {start}-{end} of {total} wastage records")
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
