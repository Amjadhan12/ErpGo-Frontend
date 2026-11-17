import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Eye,
  PackageCheck,
  Plus,
  Trash2,
  Warehouse,
} from "lucide-react";
import { api } from "@/lib/api";
import {
  formatCurrency,
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

type AdjustmentType = "increase" | "decrease";

interface AdjustmentItem {
  id: number;
  product: string;
  sku: string | null;
  unit: string | null;
  adjustmentType: AdjustmentType;
  quantity: number;
  unitCostAfn: number;
  totalCostAfn: number;
  reason: string;
  notes: string | null;
  batchNumber: string | null;
  expiryDate: string | null;
}

interface Adjustment {
  id: number;
  number: string;
  date: string;
  warehouse: string;
  creator: string | null;
  notes: string | null;
  items: AdjustmentItem[];
}

interface AdjustmentLine {
  key: number;
  productId: string;
  type: AdjustmentType;
  quantity: string;
  unitCostAfn: string;
  batchNumber: string;
  expiryDate: string;
  reason: string;
  notes: string;
}

interface AdjustmentForm {
  warehouseId: string;
  date: string;
  notes: string;
}

type Translate = (text: string) => string;

const emptyForm: AdjustmentForm = {
  warehouseId: "",
  date: todayValue(),
  notes: "",
};

function emptyLine(key: number): AdjustmentLine {
  return {
    key,
    productId: "",
    type: "increase",
    quantity: "",
    unitCostAfn: "",
    batchNumber: "",
    expiryDate: "",
    reason: "",
    notes: "",
  };
}

function parseAdjustmentItem(value: unknown): AdjustmentItem {
  if (
    !isRecord(value) ||
    !isRecord(value.product) ||
    typeof value.product.name !== "string"
  ) {
    throw new Error("The adjustment response contains an incomplete item.");
  }
  const type = value.adjustment_type;
  if (type !== "increase" && type !== "decrease") {
    throw new Error("The adjustment contains an unknown type.");
  }
  return {
    id: parseId(value.id, "adjustment item ID"),
    product: value.product.name,
    sku: optionalText(value.product.sku),
    unit: optionalText(value.product.unit),
    adjustmentType: type,
    quantity: numberValue(value.quantity, "adjustment quantity"),
    unitCostAfn: numberValue(value.unit_cost_afn, "unit cost"),
    totalCostAfn: numberValue(value.total_cost_afn, "total cost"),
    reason: typeof value.reason === "string" ? value.reason : "—",
    notes: optionalText(value.notes),
    batchNumber: optionalText(value.batch_number),
    expiryDate: optionalText(value.expiry_date),
  };
}

function parseAdjustment(value: unknown): Adjustment {
  if (
    !isRecord(value) ||
    typeof value.adjustment_number !== "string" ||
    typeof value.adjustment_date !== "string" ||
    !isRecord(value.warehouse) ||
    typeof value.warehouse.name !== "string" ||
    !Array.isArray(value.items)
  ) {
    throw new Error("The adjustment response contains an incomplete record.");
  }
  return {
    id: parseId(value.id, "adjustment ID"),
    number: value.adjustment_number,
    date: value.adjustment_date,
    warehouse: value.warehouse.name,
    creator: isRecord(value.creator) ? optionalText(value.creator.name) : null,
    notes: optionalText(value.notes),
    items: value.items.map(parseAdjustmentItem),
  };
}

function interpolate(
  template: string,
  values: Record<string, string>,
): string {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replaceAll(`{${key}}`, value),
    template,
  );
}

function translateAdjustmentMessage(
  message: string,
  t: Translate,
  language: "en" | "ps",
  fallback = true,
): string {
  const insufficient = message.match(
    /^Insufficient batch stock for product (.+)\.$/,
  );
  if (insufficient) {
    return interpolate(
      t("Insufficient batch stock for {product}."),
      { product: insufficient[1] },
    );
  }

  const unavailableProduct = message.match(
    /^Product ID (\d+) is inactive or unavailable\.$/,
  );
  if (unavailableProduct) {
    return interpolate(t("Product ID {id} is inactive or unavailable."), {
      id: unavailableProduct[1],
    });
  }

  const translated = t(message);
  if (translated !== message) return translated;
  return language === "ps" && fallback
    ? t("The adjustment could not be completed. Please try again.")
    : message;
}

function translateFieldMessage(
  message: string,
  t: Translate,
  language: "en" | "ps",
): string {
  const translated = translateAdjustmentMessage(message, t, language, false);
  if (translated !== message || language === "en") return translated;

  if (/field is required\.$/i.test(message))
    return t("This field is required.");
  if (/must be greater than 0\.$/i.test(message))
    return t("Enter a quantity greater than zero.");
  if (/must be greater than or equal to 0\.$/i.test(message))
    return t("Enter a non-negative unit cost.");
  if (/must be a number\.$/i.test(message))
    return t("Enter a valid number.");
  if (/must be a valid date\.$/i.test(message))
    return t("Enter a valid date.");
  if (/must match the format Y-m-d\.$/i.test(message))
    return t("Use the year-month-day date format.");
  if (/must be in increase, decrease\.$/i.test(message))
    return t("Choose Increase or Decrease.");
  if (/must be distinct\.$/i.test(message) || /has a duplicate value\.$/i.test(message))
    return t("A product may only appear once per adjustment.");
  if (/must have 4 decimal places or fewer\.$/i.test(message))
    return t("Quantity can have up to 4 decimal places.");
  if (/must have 6 decimal places or fewer\.$/i.test(message))
    return t("Unit cost can have up to 6 decimal places.");
  if (/must not be greater than 100 characters\.$/i.test(message))
    return t("This field cannot exceed 100 characters.");
  if (/selected .* is invalid\.$/i.test(message))
    return t("Choose a valid option.");
  return t("Please check this field and try again.");
}

export default function StockAdjustments() {
  const { direction, language, t } = useLocale();
  const [adjustments, setAdjustments] =
    useState<LaravelPage<Adjustment> | null>(null);
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [warehouses, setWarehouses] = useState<InventoryWarehouseOption[]>([]);
  const [products, setProducts] = useState<InventoryProductOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<AdjustmentForm>(emptyForm);
  const [lines, setLines] = useState<AdjustmentLine[]>([emptyLine(1)]);
  const [fields, setFields] = useState<InventoryFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Adjustment | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRetry, setDetailRetry] = useState(0);

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
    setIsLoading(true);
    setListError(null);
    api
      .get<unknown>("/api/stock-adjustments", {
        params: { page },
        signal: controller.signal,
      })
      .then(({ data }) =>
        setAdjustments(parseLaravelPage(data, parseAdjustment)),
      )
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setAdjustments(null);
          setListError(
            translateAdjustmentMessage(getErrorMessage(error), t, language),
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [page, retry, t, language]);

  useEffect(() => {
    const controller = new AbortController();
    setOptionsLoading(true);
    Promise.all([
      loadWarehouses(controller.signal),
      loadProducts(controller.signal),
    ])
      .then(([warehouseOptions, productOptions]) => {
        setWarehouses(warehouseOptions);
        setProducts(productOptions);
        setOptionsError(null);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setWarehouses([]);
          setProducts([]);
          setOptionsError(
            translateAdjustmentMessage(getErrorMessage(error), t, language),
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setOptionsLoading(false);
      });
    return () => controller.abort();
  }, [optionsRetry, t, language]);

  useEffect(() => {
    if (selectedId === null) return;
    const controller = new AbortController();
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    api
      .get<unknown>(`/api/stock-adjustments/${selectedId}`, {
        signal: controller.signal,
      })
      .then(({ data }) => {
        if (!isRecord(data) || !("data" in data)) {
          throw new Error("The adjustment detail response was incomplete.");
        }
        setDetail(parseAdjustment(data.data));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setDetailError(
            translateAdjustmentMessage(getErrorMessage(error), t, language),
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [selectedId, detailRetry, t, language]);

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(null), 6000);
    return () => window.clearTimeout(timer);
  }, [success]);

  function startCreate() {
    setForm({ ...emptyForm, date: todayValue() });
    setLines([emptyLine(1)]);
    setFields({});
    setFormError(null);
    setFormOpen(true);
  }

  function updateForm(field: keyof AdjustmentForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    const fieldName = field === "date" ? "adjustment_date" : field;
    setFields((current) => {
      const next = { ...current };
      delete next[fieldName];
      return next;
    });
    setFormError(null);
  }

  function setLineField(
    key: number,
    field: keyof Omit<AdjustmentLine, "key">,
    value: string,
  ) {
    setLines((current) =>
      current.map((line) =>
        line.key === key ? { ...line, [field]: value } : line,
      ),
    );
    setFields((current) => {
      const next = { ...current };
      const backendField =
        field === "type"
          ? "adjustment_type"
          : field === "unitCostAfn"
            ? "unit_cost_afn"
            : field === "batchNumber"
              ? "batch_number"
              : field === "expiryDate"
                ? "expiry_date"
                : field;
      delete next[`item.${key}.${backendField}`];
      delete next.items;
      return next;
    });
    setFormError(null);
  }

  function applyValidation(error: unknown) {
    const result = getValidationResult(error);
    const mapped: InventoryFieldErrors = {};
    for (const [field, message] of Object.entries(result.fields)) {
      const match = field.match(/^items\.(\d+)\.(.+)$/);
      if (match) {
        const line = lines[Number(match[1])];
        mapped[
          line ? `item.${line.key}.${match[2]}` : field
        ] = translateFieldMessage(message, t, language);
      } else {
        mapped[field] = translateFieldMessage(message, t, language);
      }
    }
    setFields(mapped);
    setFormError(
      result.message === "The given data was invalid."
        ? t("Please correct the highlighted fields.")
        : translateAdjustmentMessage(result.message, t, language),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;

    const nextFields: InventoryFieldErrors = {};
    if (!form.warehouseId)
      nextFields.warehouse_id = t("Select a warehouse.");
    if (!form.date)
      nextFields.adjustment_date = t("Select an adjustment date.");
    if (!lines.length) nextFields.items = t("Add at least one product.");

    const productIds = lines.map((line) => line.productId).filter(Boolean);
    if (new Set(productIds).size !== productIds.length) {
      nextFields.items = t("A product may only appear once per adjustment.");
    }

    for (const [index, line] of lines.entries()) {
      const prefix = `item.${line.key}`;
      if (!line.productId)
        nextFields[`${prefix}.product_id`] = t("Select a product.");
      const quantity = Number(line.quantity);
      if (!line.quantity || !Number.isFinite(quantity) || quantity <= 0) {
        nextFields[`${prefix}.quantity`] = t(
          "Enter a quantity greater than zero.",
        );
      } else if (
        !/^(?:\d+(?:\.\d{1,4})?|\.\d{1,4})$/.test(line.quantity)
      ) {
        nextFields[`${prefix}.quantity`] = t(
          "Quantity can have up to 4 decimal places.",
        );
      }
      if (!line.reason.trim())
        nextFields[`${prefix}.reason`] = t("Enter a reason.");
      if (line.reason.trim().length > 100)
        nextFields[`${prefix}.reason`] = t(
          "This field cannot exceed 100 characters.",
        );

      if (line.type === "increase") {
        const unitCost = Number(line.unitCostAfn);
        if (
          !line.unitCostAfn ||
          !Number.isFinite(unitCost) ||
          unitCost < 0
        ) {
          nextFields[`${prefix}.unit_cost_afn`] = t(
            "Enter a non-negative unit cost.",
          );
        } else if (
          !/^(?:\d+(?:\.\d{1,6})?|\.\d{1,6})$/.test(line.unitCostAfn)
        ) {
          nextFields[`${prefix}.unit_cost_afn`] = t(
            "Unit cost can have up to 6 decimal places.",
          );
        }
        if (line.batchNumber.length > 100)
          nextFields[`${prefix}.batch_number`] = t(
            "This field cannot exceed 100 characters.",
          );
      }

      if (
        line.productId &&
        index > 0 &&
        line.productId === lines[index - 1]?.productId
      ) {
        nextFields.items = t("A product may only appear once per adjustment.");
      }
    }

    setFields(nextFields);
    if (Object.keys(nextFields).length) {
      setFormError(t("Please correct the highlighted fields."));
      return;
    }

    setIsSaving(true);
    setFormError(null);
    try {
      await api.post("/api/stock-adjustments", {
        warehouse_id: Number(form.warehouseId),
        adjustment_date: form.date,
        notes: form.notes.trim() || null,
        items: lines.map((line) => ({
          product_id: Number(line.productId),
          adjustment_type: line.type,
          quantity: Number(line.quantity),
          ...(line.type === "increase"
            ? {
                unit_cost_afn: Number(line.unitCostAfn),
                batch_number: line.batchNumber.trim() || null,
                expiry_date: line.expiryDate || null,
              }
            : {}),
          reason: line.reason.trim(),
          notes: line.notes.trim() || null,
        })),
      });
      setFormOpen(false);
      setPage(1);
      setRetry((current) => current + 1);
      setSuccess(t("Stock adjustment recorded successfully."));
    } catch (error: unknown) {
      applyValidation(error);
    } finally {
      setIsSaving(false);
    }
  }

  function addLine() {
    setLines((current) => [
      ...current,
      emptyLine(current.reduce((max, line) => Math.max(max, line.key), 0) + 1),
    ]);
  }

  function removeLine(key: number) {
    setLines((current) => current.filter((line) => line.key !== key));
    setFields((current) => {
      const next = { ...current };
      for (const field of [
        "product_id",
        "adjustment_type",
        "quantity",
        "unit_cost_afn",
        "batch_number",
        "expiry_date",
        "reason",
        "notes",
      ]) {
        delete next[`item.${key}.${field}`];
      }
      delete next.items;
      return next;
    });
  }

  const pageSize = adjustments?.perPage ?? 20;
  const selectedProductIds = new Set(
    lines.map((line) => line.productId).filter(Boolean),
  );

  return (
    <div className="stock-adjustments" dir={direction} lang={language}>
      <header className="stock-adjustments__heading">
        <div>
          <p className="stock-adjustments__eyebrow">
            {t("STOCK ADJUSTMENTS")}
          </p>
          <h1>{t("Stock Adjustments")}</h1>
          <p>{t("Record counted stock increases and decreases.")}</p>
        </div>
        <button
          className="stock-adjustments__primary"
          type="button"
          onClick={startCreate}
          disabled={formOpen}
        >
          <Plus size={18} aria-hidden="true" />
          <span>{t("New Adjustment")}</span>
        </button>
      </header>

      {success && (
        <p className="stock-adjustments__success" role="status">
          <span aria-hidden="true">✓</span>
          {success}
        </p>
      )}

      {formOpen && (
        <section
          className="stock-adjustments__form-card"
          aria-labelledby="stock-adjustment-form-title"
        >
          <header className="stock-adjustments__card-heading">
            <div>
              <span className="stock-adjustments__form-mark">
                <PackageCheck size={19} aria-hidden="true" />
              </span>
              <div>
                <p className="stock-adjustments__eyebrow">
                  {t("NEW STOCK ADJUSTMENT")}
                </p>
                <h2 id="stock-adjustment-form-title">
                  {t("Create Stock Adjustment")}
                </h2>
              </div>
            </div>
            <button
              className="stock-adjustments__secondary"
              type="button"
              onClick={() => setFormOpen(false)}
              disabled={isSaving}
            >
              {t("Cancel")}
            </button>
          </header>

          {optionsError && (
            <div className="stock-adjustments__alert" role="alert">
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
            <p className="stock-adjustments__loading-options" role="status">
              <span className="stock-adjustments__spinner" />
              {t("Loading warehouses and products…")}
            </p>
          )}
          {!optionsLoading && !optionsError && warehouses.length === 0 && (
            <p className="stock-adjustments__form-error" role="alert">
              <AlertCircle size={17} aria-hidden="true" />
              {t("No active warehouses are available.")}
            </p>
          )}
          {!optionsLoading && !optionsError && products.length === 0 && (
            <p className="stock-adjustments__form-error" role="alert">
              <AlertCircle size={17} aria-hidden="true" />
              {t("No active products are available.")}
            </p>
          )}

          <form
            className="stock-adjustments__form"
            onSubmit={(event) => void submit(event)}
            noValidate
          >
            <section
              className="stock-adjustments__form-section"
              aria-labelledby="adjustment-information-title"
            >
              <div className="stock-adjustments__section-heading">
                <span className="stock-adjustments__step">1</span>
                <div>
                  <h3 id="adjustment-information-title">
                    {t("Adjustment Information")}
                  </h3>
                  <p>{t("Choose the warehouse and date for this adjustment.")}</p>
                </div>
              </div>
              <div className="stock-adjustments__fields">
                <label className="stock-adjustments__field">
                  <span>
                    {t("Warehouse")} <i>*</i>
                  </span>
                  <select
                    value={form.warehouseId}
                    onChange={(event) =>
                      updateForm("warehouseId", event.target.value)
                    }
                    disabled={optionsLoading || Boolean(optionsError)}
                    aria-invalid={Boolean(fields.warehouse_id)}
                  >
                    <option value="">{t("Select warehouse")}</option>
                    {warehouses.map((warehouse) => (
                      <option value={warehouse.id} key={warehouse.id}>
                        {warehouse.name}
                      </option>
                    ))}
                  </select>
                  {fields.warehouse_id && (
                    <small className="stock-adjustments__field-error">
                      {fields.warehouse_id}
                    </small>
                  )}
                </label>

                <label className="stock-adjustments__field">
                  <span>
                    {t("Adjustment Date")} <i>*</i>
                  </span>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(event) => updateForm("date", event.target.value)}
                    aria-invalid={Boolean(fields.adjustment_date)}
                  />
                  {fields.adjustment_date && (
                    <small className="stock-adjustments__field-error">
                      {fields.adjustment_date}
                    </small>
                  )}
                </label>

                <label className="stock-adjustments__field stock-adjustments__field--wide">
                  <span>{t("Notes")}</span>
                  <textarea
                    rows={2}
                    value={form.notes}
                    onChange={(event) =>
                      updateForm("notes", event.target.value)
                    }
                    placeholder={t("Add optional adjustment notes")}
                  />
                </label>
              </div>
            </section>

            <section
              className="stock-adjustments__form-section stock-adjustments__products-section"
              aria-labelledby="adjustment-products-title"
            >
              <div className="stock-adjustments__section-heading">
                <span className="stock-adjustments__step">2</span>
                <div>
                  <h3 id="adjustment-products-title">
                    {t("Adjustment Products")}
                  </h3>
                  <p>
                    {t(
                      "Choose whether stock is being added or removed, then enter the quantity and reason.",
                    )}
                  </p>
                </div>
                <button
                  className="stock-adjustments__add-product"
                  type="button"
                  onClick={addLine}
                  disabled={optionsLoading || Boolean(optionsError) || !products.length}
                >
                  <Plus size={16} aria-hidden="true" />
                  {t("Add Product")}
                </button>
              </div>

              {fields.items && (
                <p className="stock-adjustments__field-error" role="alert">
                  {fields.items}
                </p>
              )}
              <div className="stock-adjustments__lines">
                {lines.map((line, index) => {
                  const product = products.find(
                    (item) => String(item.id) === line.productId,
                  );
                  const fieldError = (name: string) =>
                    fields[`item.${line.key}.${name}`] ??
                    fields[`items.${index}.${name}`];

                  return (
                    <article
                      className={`stock-adjustments__line stock-adjustments__line--${line.type}`}
                      key={line.key}
                    >
                      <div className="stock-adjustments__line-heading">
                        <span className="stock-adjustments__line-index">
                          {numberFormat.format(index + 1)}
                        </span>
                        <strong>{t("Adjustment Product")}</strong>
                        <button
                          className="stock-adjustments__remove"
                          type="button"
                          onClick={() => removeLine(line.key)}
                          disabled={lines.length <= 1 || isSaving}
                          aria-label={`${t("Remove Product")} ${numberFormat.format(index + 1)}`}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                          <span>{t("Remove Product")}</span>
                        </button>
                      </div>

                      <div className="stock-adjustments__type-picker" role="group" aria-label={t("Adjustment Type")}>
                        <button
                          className={
                            line.type === "increase"
                              ? "stock-adjustments__type-option stock-adjustments__type-option--increase is-selected"
                              : "stock-adjustments__type-option stock-adjustments__type-option--increase"
                          }
                          type="button"
                          aria-pressed={line.type === "increase"}
                          onClick={() =>
                            setLineField(line.key, "type", "increase")
                          }
                          disabled={isSaving}
                        >
                          <ArrowUp size={17} aria-hidden="true" />
                          <span>
                            <strong>{t("Increase")}</strong>
                            <small>{t("Add stock to this warehouse")}</small>
                          </span>
                        </button>
                        <button
                          className={
                            line.type === "decrease"
                              ? "stock-adjustments__type-option stock-adjustments__type-option--decrease is-selected"
                              : "stock-adjustments__type-option stock-adjustments__type-option--decrease"
                          }
                          type="button"
                          aria-pressed={line.type === "decrease"}
                          onClick={() =>
                            setLineField(line.key, "type", "decrease")
                          }
                          disabled={isSaving}
                        >
                          <ArrowDown size={17} aria-hidden="true" />
                          <span>
                            <strong>{t("Decrease")}</strong>
                            <small>{t("Remove stock from this warehouse")}</small>
                          </span>
                        </button>
                      </div>
                      {fieldError("adjustment_type") && (
                        <small className="stock-adjustments__field-error">
                          {fieldError("adjustment_type")}
                        </small>
                      )}

                      {line.type === "decrease" && (
                        <p className="stock-adjustments__type-note stock-adjustments__type-note--decrease">
                          {t(
                            "The requested quantity is removed from available batches, starting with the earliest expiry.",
                          )}
                        </p>
                      )}
                      {line.type === "increase" && (
                        <p className="stock-adjustments__type-note stock-adjustments__type-note--increase">
                          {t(
                            "Enter the unit cost. Batch number and expiry date are optional.",
                          )}
                        </p>
                      )}

                      <div className="stock-adjustments__line-fields">
                        <label className="stock-adjustments__field stock-adjustments__product-field">
                          <span>
                            {t("Product")} <i>*</i>
                          </span>
                          <select
                            value={line.productId}
                            onChange={(event) =>
                              setLineField(
                                line.key,
                                "productId",
                                event.target.value,
                              )
                            }
                            disabled={
                              optionsLoading ||
                              Boolean(optionsError) ||
                              !products.length
                            }
                            aria-invalid={Boolean(fieldError("product_id"))}
                          >
                            <option value="">{t("Select a product")}</option>
                            {products.map((item) => (
                              <option
                                value={item.id}
                                key={item.id}
                                disabled={
                                  selectedProductIds.has(String(item.id)) &&
                                  String(item.id) !== line.productId
                                }
                              >
                                {item.name}
                                {item.sku ? ` · ${item.sku}` : ""}
                              </option>
                            ))}
                          </select>
                          {fieldError("product_id") && (
                            <small className="stock-adjustments__field-error">
                              {fieldError("product_id")}
                            </small>
                          )}
                        </label>

                        <label className="stock-adjustments__field">
                          <span>
                            {t("Quantity")} <i>*</i>
                          </span>
                          <div className="stock-adjustments__quantity">
                            <input
                              type="number"
                              min="0"
                              step="0.0001"
                              value={line.quantity}
                              onChange={(event) =>
                                setLineField(
                                  line.key,
                                  "quantity",
                                  event.target.value,
                                )
                              }
                              aria-invalid={Boolean(fieldError("quantity"))}
                            />
                            {product?.unit && (
                              <span className="stock-adjustments__unit">
                                {product.unit}
                              </span>
                            )}
                          </div>
                          {fieldError("quantity") && (
                            <small className="stock-adjustments__field-error">
                              {fieldError("quantity")}
                            </small>
                          )}
                        </label>

                        {line.type === "increase" && (
                          <>
                            <label className="stock-adjustments__field">
                              <span>
                                {t("Unit Cost AFN")} <i>*</i>
                              </span>
                              <input
                                type="number"
                                min="0"
                                step="0.000001"
                                value={line.unitCostAfn}
                                onChange={(event) =>
                                  setLineField(
                                    line.key,
                                    "unitCostAfn",
                                    event.target.value,
                                  )
                                }
                                aria-invalid={Boolean(
                                  fieldError("unit_cost_afn"),
                                )}
                              />
                              {fieldError("unit_cost_afn") && (
                                <small className="stock-adjustments__field-error">
                                  {fieldError("unit_cost_afn")}
                                </small>
                              )}
                            </label>
                            <label className="stock-adjustments__field">
                              <span>{t("Batch Number (optional)")}</span>
                              <input
                                maxLength={100}
                                value={line.batchNumber}
                                onChange={(event) =>
                                  setLineField(
                                    line.key,
                                    "batchNumber",
                                    event.target.value,
                                  )
                                }
                                aria-invalid={Boolean(
                                  fieldError("batch_number"),
                                )}
                              />
                              {fieldError("batch_number") && (
                                <small className="stock-adjustments__field-error">
                                  {fieldError("batch_number")}
                                </small>
                              )}
                            </label>
                            <label className="stock-adjustments__field">
                              <span>{t("Expiry Date (optional)")}</span>
                              <input
                                type="date"
                                value={line.expiryDate}
                                onChange={(event) =>
                                  setLineField(
                                    line.key,
                                    "expiryDate",
                                    event.target.value,
                                  )
                                }
                                aria-invalid={Boolean(
                                  fieldError("expiry_date"),
                                )}
                              />
                              {fieldError("expiry_date") && (
                                <small className="stock-adjustments__field-error">
                                  {fieldError("expiry_date")}
                                </small>
                              )}
                            </label>
                          </>
                        )}

                        <label className="stock-adjustments__field">
                          <span>
                            {t("Reason")} <i>*</i>
                          </span>
                          <input
                            maxLength={100}
                            value={line.reason}
                            onChange={(event) =>
                              setLineField(
                                line.key,
                                "reason",
                                event.target.value,
                              )
                            }
                            aria-invalid={Boolean(fieldError("reason"))}
                          />
                          {fieldError("reason") && (
                            <small className="stock-adjustments__field-error">
                              {fieldError("reason")}
                            </small>
                          )}
                        </label>

                        <label className="stock-adjustments__field stock-adjustments__field--wide">
                          <span>{t("Product Notes (optional)")}</span>
                          <textarea
                            rows={2}
                            value={line.notes}
                            onChange={(event) =>
                              setLineField(
                                line.key,
                                "notes",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            {formError && (
              <p className="stock-adjustments__form-error" role="alert">
                <AlertCircle size={17} aria-hidden="true" />
                {formError}
              </p>
            )}

            <footer className="stock-adjustments__form-actions">
              <p>{t("Review the adjustment before saving.")}</p>
              <div>
                <button
                  className="stock-adjustments__secondary"
                  type="button"
                  onClick={() => setFormOpen(false)}
                  disabled={isSaving}
                >
                  {t("Cancel")}
                </button>
                <button
                  className="stock-adjustments__primary"
                  type="submit"
                  disabled={
                    isSaving ||
                    optionsLoading ||
                    Boolean(optionsError) ||
                    !warehouses.length ||
                    !products.length
                  }
                >
                  <PackageCheck size={17} aria-hidden="true" />
                  {isSaving ? t("Saving…") : t("Save Adjustment")}
                </button>
              </div>
            </footer>
          </form>
        </section>
      )}

      <section
        className="stock-adjustments__list-card"
        aria-label={t("Stock adjustment history")}
      >
        <header className="stock-adjustments__list-heading">
          <div className="stock-adjustments__list-icon">
            <ArrowLeftRight size={19} aria-hidden="true" />
          </div>
          <div>
            <h2>{t("Adjustment History")}</h2>
            <p>{t("Review previous stock increases and decreases.")}</p>
          </div>
          {adjustments && !isLoading && (
            <span className="stock-adjustments__record-count">
              {interpolate(
                t(
                  adjustments.total === 1
                    ? "{count} adjustment"
                    : "{count} adjustments",
                ),
                { count: numberFormat.format(adjustments.total) },
              )}
            </span>
          )}
        </header>

        {isLoading ? (
          <div className="stock-adjustments__state" role="status">
            <span className="stock-adjustments__spinner" />
            {t("Loading adjustments…")}
          </div>
        ) : listError ? (
          <div
            className="stock-adjustments__state stock-adjustments__state--error"
            role="alert"
          >
            <AlertCircle size={21} aria-hidden="true" />
            <span>{listError}</span>
            <button
              className="stock-adjustments__text-button"
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              {t("Try again")}
            </button>
          </div>
        ) : adjustments && adjustments.data.length === 0 ? (
          <div className="stock-adjustments__state stock-adjustments__state--empty">
            <span className="stock-adjustments__empty-icon">
              <ArrowLeftRight size={21} aria-hidden="true" />
            </span>
            <strong>{t("No adjustments yet")}</strong>
            <span>{t("Recorded adjustments will appear here.")}</span>
          </div>
        ) : adjustments ? (
          <>
            <div className="stock-adjustments__table-scroll">
              <table className="stock-adjustments__table">
                <thead>
                  <tr>
                    <th>{t("Adjustment Number")}</th>
                    <th>{t("Adjustment Date")}</th>
                    <th>{t("Warehouse")}</th>
                    <th>{t("Products")}</th>
                    <th>{t("Created By")}</th>
                    <th>{t("Details")}</th>
                  </tr>
                </thead>
                <tbody>
                  {adjustments.data.map((record) => (
                    <tr key={record.id}>
                      <td data-label={t("Adjustment Number")}>
                        <strong className="stock-adjustments__number">
                          {record.number}
                        </strong>
                      </td>
                      <td data-label={t("Adjustment Date")}>{record.date}</td>
                      <td data-label={t("Warehouse")}>
                        <span className="stock-adjustments__warehouse">
                          <Warehouse size={15} aria-hidden="true" />
                          {record.warehouse}
                        </span>
                      </td>
                      <td data-label={t("Products")}>
                        <span className="stock-adjustments__product-count">
                          {numberFormat.format(record.items.length)}
                        </span>
                      </td>
                      <td data-label={t("Created By")}>
                        {record.creator || "—"}
                      </td>
                      <td data-label={t("Details")}>
                        <button
                          className="stock-adjustments__details-button"
                          type="button"
                          onClick={() => {
                            setDetailRetry(0);
                            setSelectedId(record.id);
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
            <AdjustmentPagination
              page={page}
              pageSize={pageSize}
              total={adjustments.total}
              lastPage={adjustments.lastPage}
              setPage={setPage}
              numberFormat={numberFormat}
              t={t}
            />
          </>
        ) : null}
      </section>

      {selectedId !== null && (
        <div className="stock-adjustments__backdrop">
          <section
            className="stock-adjustments__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="stock-adjustment-detail-title"
          >
            <header className="stock-adjustments__dialog-heading">
              <div>
                <p className="stock-adjustments__eyebrow">
                  {t("ADJUSTMENT DETAILS")}
                </p>
                <h2 id="stock-adjustment-detail-title">
                  {detail?.number ?? t("Stock Adjustment")}
                </h2>
                <p>
                  {detail
                    ? interpolate(t("Recorded on {date}"), {
                        date: detail.date,
                      })
                    : t("Adjustment Details")}
                </p>
              </div>
              <span className="stock-adjustments__dialog-mark">
                <PackageCheck size={21} aria-hidden="true" />
              </span>
            </header>

            <div className="stock-adjustments__dialog-body">
              {detailLoading ? (
                <div className="stock-adjustments__state" role="status">
                  <span className="stock-adjustments__spinner" />
                  {t("Loading adjustment details…")}
                </div>
              ) : detailError ? (
                <div
                  className="stock-adjustments__state stock-adjustments__state--error"
                  role="alert"
                >
                  <AlertCircle size={20} aria-hidden="true" />
                  <span>{detailError}</span>
                  <button
                    className="stock-adjustments__text-button"
                    type="button"
                    onClick={() => setDetailRetry((value) => value + 1)}
                  >
                    {t("Retry")}
                  </button>
                </div>
              ) : detail ? (
                <>
                  <div className="stock-adjustments__warehouse-summary">
                    <span className="stock-adjustments__warehouse-summary-icon">
                      <Warehouse size={19} aria-hidden="true" />
                    </span>
                    <div>
                      <span>{t("Warehouse")}</span>
                      <strong>{detail.warehouse}</strong>
                    </div>
                  </div>

                  <dl className="stock-adjustments__meta">
                    <div>
                      <dt>{t("Adjustment Date")}</dt>
                      <dd>{detail.date}</dd>
                    </div>
                    <div>
                      <dt>{t("Adjustment Number")}</dt>
                      <dd>{detail.number}</dd>
                    </div>
                    <div>
                      <dt>{t("Created By")}</dt>
                      <dd>{detail.creator || "—"}</dd>
                    </div>
                    <div className="stock-adjustments__notes">
                      <dt>{t("Notes")}</dt>
                      <dd>{detail.notes || t("No notes")}</dd>
                    </div>
                  </dl>

                  <div className="stock-adjustments__detail-products">
                    <div className="stock-adjustments__detail-heading">
                      <h3>{t("Products")}</h3>
                      <span>
                        {interpolate(
                          t(
                            detail.items.length === 1
                              ? "{count} product"
                              : "{count} products",
                          ),
                          { count: numberFormat.format(detail.items.length) },
                        )}
                      </span>
                    </div>
                    <div className="stock-adjustments__table-scroll">
                      <table className="stock-adjustments__table stock-adjustments__detail-table">
                        <thead>
                          <tr>
                            <th>{t("Product")}</th>
                            <th>{t("Adjustment Type")}</th>
                            <th>{t("Quantity")}</th>
                            <th>{t("Unit Cost")}</th>
                            <th>{t("Total Cost")}</th>
                            <th>{t("Batch Number")}</th>
                            <th>{t("Expiry Date")}</th>
                            <th>{t("Reason")}</th>
                            <th>{t("Notes")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.items.map((item) => (
                            <tr key={item.id}>
                              <td data-label={t("Product")}>
                                <strong>{item.product}</strong>
                                {item.sku && (
                                  <small className="stock-adjustments__sku">
                                    {item.sku}
                                  </small>
                                )}
                              </td>
                              <td data-label={t("Adjustment Type")}>
                                <span
                                  className={`stock-adjustments__type-badge stock-adjustments__type-badge--${item.adjustmentType}`}
                                >
                                  {item.adjustmentType === "increase" ? (
                                    <ArrowUp size={13} aria-hidden="true" />
                                  ) : (
                                    <ArrowDown size={13} aria-hidden="true" />
                                  )}
                                  {item.adjustmentType === "increase"
                                    ? t("Increase")
                                    : t("Decrease")}
                                </span>
                              </td>
                              <td data-label={t("Quantity")}>
                                {quantityFormat.format(item.quantity)}{" "}
                                {item.unit || "—"}
                              </td>
                              <td data-label={t("Unit Cost")}>
                                {formatCurrency(item.unitCostAfn)}
                              </td>
                              <td data-label={t("Total Cost")}>
                                {formatCurrency(item.totalCostAfn)}
                              </td>
                              <td data-label={t("Batch Number")}>
                                {item.batchNumber || "—"}
                              </td>
                              <td data-label={t("Expiry Date")}>
                                {item.expiryDate || "—"}
                              </td>
                              <td data-label={t("Reason")}>{item.reason}</td>
                              <td data-label={t("Notes")}>
                                {item.notes || "—"}
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

            <footer className="stock-adjustments__dialog-footer">
              <button
                className="stock-adjustments__primary"
                type="button"
                onClick={() => setSelectedId(null)}
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

function AdjustmentPagination({
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
    <footer className="stock-adjustments__pagination">
      <span>
        {interpolate(t("Showing {start}-{end} of {total} adjustments"), {
          start: numberFormat.format(start),
          end: numberFormat.format(end),
          total: numberFormat.format(total),
        })}
      </span>
      <div>
        <button
          className="stock-adjustments__page-prev"
          type="button"
          onClick={() => setPage(page - 1)}
          disabled={page <= 1}
          aria-label={t("Previous page")}
        >
          <ChevronLeft size={16} aria-hidden="true" />
          {t("Previous")}
        </button>
        <span>
          {interpolate(t("Page {page} of {lastPage}"), {
            page: numberFormat.format(page),
            lastPage: numberFormat.format(lastPage),
          })}
        </span>
        <button
          className="stock-adjustments__page-next"
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
