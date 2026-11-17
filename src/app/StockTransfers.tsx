import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  Eye,
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

interface TransferItem {
  id: number;
  productId: number;
  productName: string;
  sku: string | null;
  unit: string | null;
  quantity: number;
  unitCostAfn: number;
  totalCostAfn: number;
}

interface StockTransfer {
  id: number;
  transferNumber: string;
  transferDate: string;
  fromWarehouse: string;
  toWarehouse: string;
  creator: string | null;
  notes: string | null;
  items: TransferItem[];
}

interface TransferLine {
  key: number;
  productId: string;
  quantity: string;
}

interface TransferForm {
  fromWarehouseId: string;
  toWarehouseId: string;
  transferDate: string;
  notes: string;
}

type TransferPage = LaravelPage<StockTransfer>;
type Translate = (text: string) => string;

const emptyForm: TransferForm = {
  fromWarehouseId: "",
  toWarehouseId: "",
  transferDate: todayValue(),
  notes: "",
};

function parseTransferItem(value: unknown): TransferItem {
  if (
    !isRecord(value) ||
    !isRecord(value.product) ||
    typeof value.product.name !== "string"
  ) {
    throw new Error("The transfer response contains an incomplete item.");
  }
  return {
    id: parseId(value.id, "transfer item ID"),
    productId: parseId(value.product_id, "product ID"),
    productName: value.product.name,
    sku: optionalText(value.product.sku),
    unit: optionalText(value.product.unit),
    quantity: numberValue(value.quantity, "transfer quantity"),
    unitCostAfn: numberValue(value.unit_cost_afn, "unit cost"),
    totalCostAfn: numberValue(value.total_cost_afn, "total cost"),
  };
}

function parseTransfer(value: unknown): StockTransfer {
  if (
    !isRecord(value) ||
    typeof value.transfer_number !== "string" ||
    typeof value.transfer_date !== "string" ||
    !isRecord(value.from_warehouse) ||
    !isRecord(value.to_warehouse) ||
    typeof value.from_warehouse.name !== "string" ||
    typeof value.to_warehouse.name !== "string" ||
    !Array.isArray(value.items)
  ) {
    throw new Error("The transfer response contains an incomplete record.");
  }
  return {
    id: parseId(value.id, "transfer ID"),
    transferNumber: value.transfer_number,
    transferDate: value.transfer_date,
    fromWarehouse: value.from_warehouse.name,
    toWarehouse: value.to_warehouse.name,
    creator: isRecord(value.creator) ? optionalText(value.creator.name) : null,
    notes: optionalText(value.notes),
    items: value.items.map(parseTransferItem),
  };
}

function parseSourceBalances(value: unknown): Record<string, number> {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error("The inventory report response was incomplete.");
  }
  const balances: Record<string, number> = {};
  for (const row of value.data) {
    if (!isRecord(row) || !isRecord(row.product)) {
      throw new Error("The inventory report contains an incomplete balance row.");
    }
    const productId = parseId(row.product.id, "product ID");
    balances[String(productId)] = numberValue(
      row.quantity,
      "inventory quantity",
    );
  }
  return balances;
}

function nextLineKey(lines: TransferLine[]): number {
  return lines.reduce((max, line) => Math.max(max, line.key), 0) + 1;
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

function translateTransferMessage(
  message: string,
  t: Translate,
  language: "en" | "ps",
  fallback = true,
): string {
  const insufficient = message.match(
    /^Insufficient stock for (.+)\. Available: ([\d.,]+)\. Requested: ([\d.,]+)\.$/,
  );
  if (insufficient) {
    return interpolate(
      t("Insufficient stock for {product}. Available: {available}. Requested: {requested}."),
      {
        product: insufficient[1],
        available: insufficient[2],
        requested: insufficient[3],
      },
    );
  }

  const noStock = message.match(
    /^Product (.+) has no stock in the source warehouse\.$/,
  );
  if (noStock) {
    return interpolate(t("Product {product} has no stock in the source warehouse."), {
      product: noStock[1],
    });
  }

  const batchStock = message.match(
    /^Insufficient batch stock for (.+) in the source warehouse\.$/,
  );
  if (batchStock) {
    return interpolate(
      t("Insufficient batch stock for {product} in the source warehouse."),
      { product: batchStock[1] },
    );
  }

  const translated = t(message);
  if (translated !== message) return translated;
  return language === "ps" && fallback
    ? t("The transfer could not be completed. Please try again.")
    : message;
}

function translateFieldMessage(
  message: string,
  t: Translate,
  language: "en" | "ps",
): string {
  const translated = translateTransferMessage(message, t, language, false);
  if (translated !== message || language === "en") return translated;
  if (/field is required\.$/i.test(message)) return t("This field is required.");
  if (/must be greater than 0\.$/i.test(message))
    return t("Enter a quantity greater than zero.");
  if (/must be a number\.$/i.test(message))
    return t("Enter a valid number.");
  if (/must be a date\.$/i.test(message))
    return t("Enter a valid date.");
  if (/must be different\.$/i.test(message))
    return t("Choose a different destination warehouse.");
  if (/must be distinct\.$/i.test(message))
    return t("A product may only appear once in a transfer.");
  if (/has a duplicate value\.$/i.test(message))
    return t("A product may only appear once in a transfer.");
  if (/selected .* is invalid\.$/i.test(message))
    return t("Choose a valid option.");
  if (/given data was invalid/i.test(message))
    return t("Please correct the highlighted fields.");
  return t("Please check this field and try again.");
}

export default function StockTransfers() {
  const { direction, language, t } = useLocale();
  const [transfers, setTransfers] = useState<TransferPage | null>(null);
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
  const [form, setForm] = useState<TransferForm>(emptyForm);
  const [lines, setLines] = useState<TransferLine[]>([
    { key: 1, productId: "", quantity: "" },
  ]);
  const [fields, setFields] = useState<InventoryFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [sourceBalances, setSourceBalances] = useState<Record<string, number>>(
    {},
  );
  const [stockLoading, setStockLoading] = useState(false);
  const [stockLoaded, setStockLoaded] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);
  const [stockRetry, setStockRetry] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<StockTransfer | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRetry, setDetailRetry] = useState(0);

  const quantityFormatter = useMemo(
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
      .get<unknown>("/api/stock-transfers", {
        params: { page },
        signal: controller.signal,
      })
      .then(({ data }) => {
        setTransfers(parseLaravelPage(data, parseTransfer));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setTransfers(null);
          setListError(
            translateTransferMessage(getErrorMessage(error), t, language),
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
            translateTransferMessage(getErrorMessage(error), t, language),
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setOptionsLoading(false);
      });
    return () => controller.abort();
  }, [optionsRetry, t, language]);

  useEffect(() => {
    if (!formOpen || !form.fromWarehouseId) {
      setSourceBalances({});
      setStockLoading(false);
      setStockLoaded(false);
      setStockError(null);
      return;
    }
    const controller = new AbortController();
    setSourceBalances({});
    setStockLoading(true);
    setStockLoaded(false);
    setStockError(null);
    api
      .get<unknown>("/api/reports/inventory", {
        params: { warehouse_id: Number(form.fromWarehouseId) },
        signal: controller.signal,
      })
      .then(({ data }) => {
        setSourceBalances(parseSourceBalances(data));
        setStockLoaded(true);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setStockError(
            translateTransferMessage(getErrorMessage(error), t, language),
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setStockLoading(false);
      });
    return () => controller.abort();
  }, [formOpen, form.fromWarehouseId, stockRetry, t, language]);

  useEffect(() => {
    if (selectedId === null) return;
    const controller = new AbortController();
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    api
      .get<unknown>(`/api/stock-transfers/${selectedId}`, {
        signal: controller.signal,
      })
      .then(({ data }) => {
        if (!isRecord(data) || !("data" in data))
          throw new Error("The transfer details response was incomplete.");
        setDetail(parseTransfer(data.data));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setDetailError(
            translateTransferMessage(getErrorMessage(error), t, language),
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
    setForm({ ...emptyForm, transferDate: todayValue() });
    setLines([{ key: 1, productId: "", quantity: "" }]);
    setFields({});
    setFormError(null);
    setStockRetry(0);
    setFormOpen(true);
  }

  function updateForm(field: keyof TransferForm, value: string) {
    setForm((current) => {
      if (
        field === "fromWarehouseId" &&
        value &&
        value === current.toWarehouseId
      ) {
        return { ...current, fromWarehouseId: value, toWarehouseId: "" };
      }
      return { ...current, [field]: value };
    });
    const fieldName =
      field === "fromWarehouseId"
        ? "from_warehouse_id"
        : field === "toWarehouseId"
          ? "to_warehouse_id"
          : field === "transferDate"
            ? "transfer_date"
            : field;
    setFields((current) => {
      const next = { ...current };
      delete next[fieldName];
      return next;
    });
    setFormError(null);
  }

  function setLineField(
    key: number,
    field: keyof Omit<TransferLine, "key">,
    value: string,
  ) {
    setLines((current) =>
      current.map((line) =>
        line.key === key ? { ...line, [field]: value } : line,
      ),
    );
    setFields((current) => {
      const next = { ...current };
      delete next[
        `item.${key}.${field === "productId" ? "product_id" : field}`
      ];
      delete next.items;
      return next;
    });
    setFormError(null);
  }

  function applyValidation(error: unknown) {
    const result = getValidationResult(error);
    const mapped: InventoryFieldErrors = {};
    for (const [field, message] of Object.entries(result.fields)) {
      const match = field.match(/^items\.(\d+)\.(product_id|quantity)$/);
      if (match) {
        const line = lines[Number(match[1])];
        if (line) {
          mapped[`item.${line.key}.${match[2]}`] = translateFieldMessage(
            message,
            t,
            language,
          );
        } else {
          mapped[field] = translateFieldMessage(message, t, language);
        }
      } else {
        mapped[field] = translateFieldMessage(message, t, language);
      }
    }
    setFields(mapped);
    setFormError(
      result.message === "The given data was invalid."
        ? t("Please correct the highlighted fields.")
        : translateTransferMessage(result.message, t, language),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    const nextFields: InventoryFieldErrors = {};
    if (!form.fromWarehouseId)
      nextFields.from_warehouse_id = t("Select a source warehouse.");
    if (!form.toWarehouseId)
      nextFields.to_warehouse_id = t("Select a destination warehouse.");
    if (form.fromWarehouseId && form.fromWarehouseId === form.toWarehouseId) {
      nextFields.to_warehouse_id = t(
        "Choose a different destination warehouse.",
      );
    }
    if (!form.transferDate)
      nextFields.transfer_date = t("Select a transfer date.");
    if (lines.length === 0)
      nextFields.items = t("Add at least one product.");

    const selectedProductIds = lines
      .map((line) => line.productId)
      .filter(Boolean);
    if (new Set(selectedProductIds).size !== selectedProductIds.length) {
      nextFields.items = t("A product may only appear once in a transfer.");
    }

    for (const [index, line] of lines.entries()) {
      if (!line.productId) {
        nextFields[`item.${line.key}.product_id`] = t("Select a product.");
      }
      const quantity = Number(line.quantity);
      if (!line.quantity || !Number.isFinite(quantity) || quantity <= 0) {
        nextFields[`item.${line.key}.quantity`] = t(
          "Enter a quantity greater than zero.",
        );
      } else if (
        (line.quantity.split(/[eE]/)[0].split(".")[1] ?? "").length > 4
      ) {
        nextFields[`item.${line.key}.quantity`] = t(
          "Enter a quantity with up to 4 decimal places.",
        );
      } else if (
        stockLoaded &&
        line.productId &&
        quantity > (sourceBalances[line.productId] ?? 0)
      ) {
        nextFields[`item.${line.key}.quantity`] = interpolate(
          t("Quantity cannot exceed available stock ({available})."),
          {
            available: quantityFormatter.format(
              sourceBalances[line.productId] ?? 0,
            ),
          },
        );
      }
      if (line.productId && !stockLoaded) {
        nextFields[`item.${line.key}.product_id`] = t(
          "Available stock must be checked before recording the transfer.",
        );
      }
      if (index > 0 && line.productId === lines[index - 1]?.productId) {
        nextFields.items = t(
          "A product may only appear once in a transfer.",
        );
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
      await api.post("/api/stock-transfers", {
        from_warehouse_id: Number(form.fromWarehouseId),
        to_warehouse_id: Number(form.toWarehouseId),
        transfer_date: form.transferDate,
        notes: form.notes.trim() || null,
        items: lines.map((line) => ({
          product_id: Number(line.productId),
          quantity: Number(line.quantity),
        })),
      });
      setFormOpen(false);
      setPage(1);
      setRetry((current) => current + 1);
      setSuccess(t("Stock transfer recorded successfully."));
    } catch (error: unknown) {
      applyValidation(error);
    } finally {
      setIsSaving(false);
    }
  }

  const addLine = () =>
    setLines((current) => [
      ...current,
      { key: nextLineKey(current), productId: "", quantity: "" },
    ]);
  const pageSize = transfers?.perPage ?? 15;
  const selectedProductIds = new Set(
    lines.map((line) => line.productId).filter(Boolean),
  );
  const numberFormat = new Intl.NumberFormat(
    language === "ps" ? "ps-AF" : "en-US",
  );

  return (
    <div
      className="stock-transfers"
      dir={direction}
      lang={language}
    >
      <header className="stock-transfers__heading">
        <div>
          <p className="stock-transfers__eyebrow">{t("STOCK TRANSFERS")}</p>
          <h1>{t("Stock Transfers")}</h1>
          <p>{t("Move stock between active warehouses.")}</p>
        </div>
        <button
          className="stock-transfers__primary"
          type="button"
          onClick={startCreate}
          disabled={formOpen}
        >
          <Plus size={18} aria-hidden="true" />
          <span>{t("New Transfer")}</span>
        </button>
      </header>

      {success && (
        <p className="stock-transfers__success" role="status">
          <span aria-hidden="true">✓</span>
          {success}
        </p>
      )}

      {formOpen && (
        <section
          className="stock-transfers__form-card"
          aria-labelledby="stock-transfer-form-title"
        >
          <header className="stock-transfers__card-heading">
            <div>
              <span className="stock-transfers__form-mark">
                <ArrowLeftRight size={19} aria-hidden="true" />
              </span>
              <div>
                <p className="stock-transfers__eyebrow">
                  {t("NEW STOCK TRANSFER")}
                </p>
                <h2 id="stock-transfer-form-title">
                  {t("Create Stock Transfer")}
                </h2>
              </div>
            </div>
            <button
              className="stock-transfers__secondary"
              type="button"
              onClick={() => setFormOpen(false)}
              disabled={isSaving}
            >
              {t("Cancel")}
            </button>
          </header>

          {optionsError && (
            <div className="stock-transfers__alert" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <span>{optionsError}</span>
              <button
                className="stock-transfers__page-prev"
                type="button"
                onClick={() => setOptionsRetry((value) => value + 1)}
              >
                {t("Retry")}
              </button>
            </div>
          )}
          {optionsLoading && (
            <p className="stock-transfers__stock-hint" role="status">
              <span className="stock-transfers__spinner" />
              {t("Loading warehouses and products…")}
            </p>
          )}
          {!optionsLoading && !optionsError && warehouses.length === 0 && (
            <p className="stock-transfers__form-error" role="alert">
              <AlertCircle size={17} aria-hidden="true" />
              {t("No active warehouses are available.")}
            </p>
          )}
          {!optionsLoading &&
            !optionsError &&
            warehouses.length === 1 && (
              <p className="stock-transfers__form-error" role="alert">
                <AlertCircle size={17} aria-hidden="true" />
                {t(
                  "At least two active warehouses are needed to record a transfer.",
                )}
              </p>
            )}

          <form
            className="stock-transfers__form"
            onSubmit={(event) => void submit(event)}
            noValidate
          >
            <section
              className="stock-transfers__form-section"
              aria-labelledby="transfer-information-title"
            >
              <div className="stock-transfers__section-heading">
                <span className="stock-transfers__step">1</span>
                <div>
                  <h3 id="transfer-information-title">
                    {t("Transfer Information")}
                  </h3>
                  <p>
                    {t(
                      "Choose where the stock is coming from and where it is going.",
                    )}
                  </p>
                </div>
              </div>
              <div className="stock-transfers__fields">
                <label className="stock-transfers__field">
                  <span>
                    {t("Source Warehouse (From)")} <i>*</i>
                  </span>
                  <select
                    value={form.fromWarehouseId}
                    onChange={(event) =>
                      updateForm("fromWarehouseId", event.target.value)
                    }
                    disabled={optionsLoading || Boolean(optionsError)}
                    aria-invalid={Boolean(fields.from_warehouse_id)}
                    aria-describedby={
                      fields.from_warehouse_id
                        ? "stock-transfer-from-error"
                        : undefined
                    }
                  >
                    <option value="">{t("Select source warehouse")}</option>
                    {warehouses.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.name}
                      </option>
                    ))}
                  </select>
                  {fields.from_warehouse_id && (
                    <small
                      id="stock-transfer-from-error"
                      className="stock-transfers__field-error"
                    >
                      {fields.from_warehouse_id}
                    </small>
                  )}
                </label>

                <label className="stock-transfers__field">
                  <span>
                    {t("Destination Warehouse (To)")} <i>*</i>
                  </span>
                  <select
                    value={form.toWarehouseId}
                    onChange={(event) =>
                      updateForm("toWarehouseId", event.target.value)
                    }
                    disabled={optionsLoading || Boolean(optionsError)}
                    aria-invalid={Boolean(fields.to_warehouse_id)}
                    aria-describedby={
                      fields.to_warehouse_id
                        ? "stock-transfer-to-error"
                        : undefined
                    }
                  >
                    <option value="">
                      {t("Select destination warehouse")}
                    </option>
                    {warehouses.map((warehouse) => (
                      <option
                        key={warehouse.id}
                        value={warehouse.id}
                        disabled={
                          String(warehouse.id) === form.fromWarehouseId
                        }
                      >
                        {warehouse.name}
                      </option>
                    ))}
                  </select>
                  {fields.to_warehouse_id && (
                    <small
                      id="stock-transfer-to-error"
                      className="stock-transfers__field-error"
                    >
                      {fields.to_warehouse_id}
                    </small>
                  )}
                </label>

                <label className="stock-transfers__field">
                  <span>
                    {t("Transfer Date")} <i>*</i>
                  </span>
                  <input
                    type="date"
                    value={form.transferDate}
                    onChange={(event) =>
                      updateForm("transferDate", event.target.value)
                    }
                    aria-invalid={Boolean(fields.transfer_date)}
                    aria-describedby={
                      fields.transfer_date
                        ? "stock-transfer-date-error"
                        : undefined
                    }
                  />
                  {fields.transfer_date && (
                    <small
                      id="stock-transfer-date-error"
                      className="stock-transfers__field-error"
                    >
                      {fields.transfer_date}
                    </small>
                  )}
                </label>

                <label className="stock-transfers__field stock-transfers__field--notes">
                  <span>{t("Notes")}</span>
                  <textarea
                    rows={2}
                    value={form.notes}
                    onChange={(event) =>
                      updateForm("notes", event.target.value)
                    }
                    placeholder={t("Add an optional note for this transfer")}
                  />
                </label>
              </div>
            </section>

            <section
              className="stock-transfers__form-section stock-transfers__products-section"
              aria-labelledby="transfer-products-title"
            >
              <div className="stock-transfers__section-heading">
                <span className="stock-transfers__step">2</span>
                <div>
                  <h3 id="transfer-products-title">
                    {t("Products to Transfer")}
                  </h3>
                  <p>
                    {t(
                      "Choose a source warehouse first, then select products and quantities.",
                    )}
                  </p>
                </div>
                <button
                  className="stock-transfers__add-product"
                  type="button"
                  onClick={addLine}
                  disabled={
                    optionsLoading ||
                    Boolean(optionsError) ||
                    !form.fromWarehouseId ||
                    stockLoading ||
                    Boolean(stockError) ||
                    products.length === 0
                  }
                >
                  <Plus size={16} aria-hidden="true" />
                  {t("Add Product")}
                </button>
              </div>

              {!form.fromWarehouseId && (
                <p className="stock-transfers__stock-hint">
                  <Warehouse size={15} aria-hidden="true" />
                  {t("Select a warehouse first to see available stock.")}
                </p>
              )}
              {stockLoading && (
                <p className="stock-transfers__stock-hint" role="status">
                  <span className="stock-transfers__spinner" />
                  {t("Checking source stock…")}
                </p>
              )}
              {stockError && (
                <div
                  className="stock-transfers__alert stock-transfers__alert--inline"
                  role="alert"
                >
                  <AlertCircle size={18} aria-hidden="true" />
                  <span>{stockError}</span>
                  <button
                    className="stock-transfers__page-next"
                    type="button"
                    onClick={() => setStockRetry((value) => value + 1)}
                  >
                    {t("Retry")}
                  </button>
                </div>
              )}
              {fields.items && (
                <p className="stock-transfers__field-error" role="alert">
                  {fields.items}
                </p>
              )}
              {products.length === 0 && stockLoaded && !optionsLoading && (
                <p className="stock-transfers__stock-hint">
                  {t("No active products are available.")}
                </p>
              )}

              <div className="stock-transfers__lines">
                {lines.map((line, index) => {
                  const product = products.find(
                    (option) => String(option.id) === line.productId,
                  );
                  const available = line.productId
                    ? (sourceBalances[line.productId] ?? 0)
                    : null;
                  const productError =
                    fields[`item.${line.key}.product_id`] ??
                    fields[`items.${index}.product_id`];
                  const quantityError =
                    fields[`item.${line.key}.quantity`] ??
                    fields[`items.${index}.quantity`];

                  return (
                    <div className="stock-transfers__line" key={line.key}>
                      <label className="stock-transfers__field stock-transfers__line-product">
                        <span>{t("Product")}</span>
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
                            !form.fromWarehouseId ||
                            stockLoading ||
                            Boolean(stockError)
                          }
                          aria-invalid={Boolean(productError)}
                        >
                          <option value="">{t("Select a product")}</option>
                          {products.map((option) => (
                            <option
                              key={option.id}
                              value={option.id}
                              disabled={
                                selectedProductIds.has(String(option.id)) &&
                                String(option.id) !== line.productId
                              }
                            >
                              {option.name}
                              {option.sku ? ` · ${option.sku}` : ""}
                            </option>
                          ))}
                        </select>
                        {productError && (
                          <small className="stock-transfers__field-error">
                            {productError}
                          </small>
                        )}
                      </label>

                      <div className="stock-transfers__available">
                        <span>{t("Available Stock")}</span>
                        {available === null || !stockLoaded ? (
                          <strong>—</strong>
                        ) : (
                          <strong>
                            {quantityFormatter.format(available)}
                            <small>{product?.unit ?? ""}</small>
                          </strong>
                        )}
                      </div>

                      <label className="stock-transfers__field stock-transfers__line-quantity">
                        <span>{t("Transfer Quantity")}</span>
                        <div className="stock-transfers__quantity-control">
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
                            disabled={!stockLoaded || Boolean(stockError)}
                            aria-invalid={Boolean(quantityError)}
                          />
                          {product?.unit && (
                            <span className="stock-transfers__unit">
                              {product.unit}
                            </span>
                          )}
                        </div>
                        {quantityError && (
                          <small className="stock-transfers__field-error">
                            {quantityError}
                          </small>
                        )}
                      </label>

                      <button
                        className="stock-transfers__remove"
                        type="button"
                        onClick={() => {
                          setLines((current) =>
                            current.filter((entry) => entry.key !== line.key),
                          );
                          setFields((current) => {
                            const next = { ...current };
                            delete next[`item.${line.key}.product_id`];
                            delete next[`item.${line.key}.quantity`];
                            delete next.items;
                            return next;
                          });
                        }}
                        disabled={lines.length <= 1 || isSaving}
                        aria-label={t("Remove product")}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                        <span>{t("Remove")}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
              <p className="stock-transfers__fefo-note">
                {t(
                  "Available batches are allocated by earliest expiry date.",
                )}
              </p>
            </section>

            {formError && (
              <p className="stock-transfers__form-error" role="alert">
                <AlertCircle size={17} aria-hidden="true" />
                {formError}
              </p>
            )}

            <footer className="stock-transfers__form-actions">
              <p>
                {t(
                  "Review the warehouses, products and quantities before recording.",
                )}
              </p>
              <div>
                <button
                  className="stock-transfers__secondary"
                  type="button"
                  onClick={() => setFormOpen(false)}
                  disabled={isSaving}
                >
                  {t("Cancel")}
                </button>
                <button
                  className="stock-transfers__primary"
                  type="submit"
                  disabled={
                    isSaving ||
                    optionsLoading ||
                    Boolean(optionsError) ||
                    stockLoading ||
                    Boolean(stockError) ||
                    !stockLoaded
                  }
                >
                  <ArrowLeftRight size={17} aria-hidden="true" />
                  {isSaving ? t("Saving…") : t("Record Transfer")}
                </button>
              </div>
            </footer>
          </form>
        </section>
      )}

      <section
        className="stock-transfers__list-card"
        aria-label={t("Stock transfer history")}
      >
        <header className="stock-transfers__list-heading">
          <div className="stock-transfers__list-icon">
            <ArrowLeftRight size={19} aria-hidden="true" />
          </div>
          <div>
            <h2>{t("Transfer History")}</h2>
            <p>{t("Review previous stock movements between warehouses.")}</p>
          </div>
          {transfers && !isLoading && (
            <span className="stock-transfers__record-count">
              {interpolate(
                t(
                  transfers.total === 1
                    ? "{count} transfer"
                    : "{count} transfers",
                ),
                { count: numberFormat.format(transfers.total) },
              )}
            </span>
          )}
        </header>

        {isLoading ? (
          <div className="stock-transfers__state" role="status">
            <span className="stock-transfers__spinner" />
            {t("Loading transfers…")}
          </div>
        ) : listError ? (
          <div className="stock-transfers__state stock-transfers__state--error" role="alert">
            <AlertCircle size={21} aria-hidden="true" />
            <span>{listError}</span>
            <button
              className="stock-transfers__text-button"
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              {t("Try again")}
            </button>
          </div>
        ) : transfers && transfers.data.length === 0 ? (
          <div className="stock-transfers__state stock-transfers__state--empty">
            <span className="stock-transfers__empty-icon">
              <ArrowLeftRight size={21} aria-hidden="true" />
            </span>
            <strong>{t("No stock transfers yet")}</strong>
            <span>{t("Posted transfers will appear here.")}</span>
          </div>
        ) : transfers ? (
          <>
            <div className="stock-transfers__table-scroll">
              <table className="stock-transfers__table">
                <thead>
                  <tr>
                    <th>{t("Transfer Number")}</th>
                    <th>{t("Transfer Date")}</th>
                    <th>{t("Source Warehouse")}</th>
                    <th>{t("Destination Warehouse")}</th>
                    <th>{t("Products")}</th>
                    <th>{t("Created By")}</th>
                    <th>{t("Details")}</th>
                  </tr>
                </thead>
                <tbody>
                  {transfers.data.map((transfer) => (
                    <tr key={transfer.id}>
                      <td data-label={t("Transfer Number")}>
                        <strong className="stock-transfers__number">
                          {transfer.transferNumber}
                        </strong>
                      </td>
                      <td data-label={t("Transfer Date")}>
                        {transfer.transferDate}
                      </td>
                      <td data-label={t("Source Warehouse")}>
                        <span className="stock-transfers__warehouse">
                          <Warehouse size={15} aria-hidden="true" />
                          {transfer.fromWarehouse}
                        </span>
                      </td>
                      <td data-label={t("Destination Warehouse")}>
                        <span className="stock-transfers__warehouse">
                          <Warehouse size={15} aria-hidden="true" />
                          {transfer.toWarehouse}
                        </span>
                      </td>
                      <td data-label={t("Products")}>
                        <span className="stock-transfers__product-count">
                          {numberFormat.format(transfer.items.length)}
                        </span>
                      </td>
                      <td data-label={t("Created By")}>
                        {transfer.creator || "—"}
                      </td>
                      <td data-label={t("Details")}>
                        <button
                          className="stock-transfers__details-button"
                          type="button"
                          onClick={() => {
                            setDetailRetry(0);
                            setSelectedId(transfer.id);
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
            <TransferPagination
              page={page}
              pageSize={pageSize}
              total={transfers.total}
              lastPage={transfers.lastPage}
              setPage={setPage}
              numberFormat={numberFormat}
              t={t}
            />
          </>
        ) : null}
      </section>

      {selectedId !== null && (
        <div className="stock-transfers__backdrop">
          <section
            className="stock-transfers__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="stock-transfer-detail-title"
          >
            <header className="stock-transfers__dialog-heading">
              <div>
                <p className="stock-transfers__eyebrow">
                  {t("TRANSFER DETAILS")}
                </p>
                <h2 id="stock-transfer-detail-title">
                  {detail?.transferNumber ?? t("Stock Transfer")}
                </h2>
                <p>
                  {detail
                    ? interpolate(t("Recorded on {date}"), {
                        date: detail.transferDate,
                      })
                    : t("Transfer details")}
                </p>
              </div>
              <span className="stock-transfers__dialog-mark">
                <ArrowLeftRight size={21} aria-hidden="true" />
              </span>
            </header>

            <div className="stock-transfers__dialog-body">
              {detailLoading ? (
                <div className="stock-transfers__state" role="status">
                  <span className="stock-transfers__spinner" />
                  {t("Loading transfer details…")}
                </div>
              ) : detailError ? (
                <div
                  className="stock-transfers__state stock-transfers__state--error"
                  role="alert"
                >
                  <AlertCircle size={20} aria-hidden="true" />
                  <span>{detailError}</span>
                  <button
                    className="stock-transfers__text-button"
                    type="button"
                    onClick={() => setDetailRetry((value) => value + 1)}
                  >
                    {t("Retry")}
                  </button>
                </div>
              ) : detail ? (
                <>
                  <div className="stock-transfers__route-summary">
                    <div>
                      <span>{t("Source Warehouse")}</span>
                      <strong>{detail.fromWarehouse}</strong>
                    </div>
                    <span className="stock-transfers__route-arrow">
                      <ArrowLeftRight size={19} aria-hidden="true" />
                    </span>
                    <div>
                      <span>{t("Destination Warehouse")}</span>
                      <strong>{detail.toWarehouse}</strong>
                    </div>
                  </div>

                  <dl className="stock-transfers__meta">
                    <div>
                      <dt>{t("Transfer Date")}</dt>
                      <dd>{detail.transferDate}</dd>
                    </div>
                    <div>
                      <dt>{t("Reference Number")}</dt>
                      <dd>{detail.transferNumber}</dd>
                    </div>
                    <div>
                      <dt>{t("Created By")}</dt>
                      <dd>{detail.creator || "—"}</dd>
                    </div>
                    <div className="stock-transfers__notes">
                      <dt>{t("Notes")}</dt>
                      <dd>{detail.notes || t("No notes")}</dd>
                    </div>
                  </dl>

                  <div className="stock-transfers__detail-products">
                    <div className="stock-transfers__detail-heading">
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
                    <div className="stock-transfers__table-scroll">
                      <table className="stock-transfers__table stock-transfers__detail-table">
                        <thead>
                          <tr>
                            <th>{t("Product")}</th>
                            <th>{t("Quantity")}</th>
                            <th>{t("Unit Cost")}</th>
                            <th>{t("Total Cost")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.items.map((item) => (
                            <tr key={item.id}>
                              <td data-label={t("Product")}>
                                <strong>{item.productName}</strong>
                                {item.sku && (
                                  <small className="stock-transfers__sku">
                                    {item.sku}
                                  </small>
                                )}
                              </td>
                              <td data-label={t("Quantity")}>
                                {quantityFormatter.format(item.quantity)}{" "}
                                {item.unit || "—"}
                              </td>
                              <td data-label={t("Unit Cost")}>
                                {formatCurrency(item.unitCostAfn)}
                              </td>
                              <td data-label={t("Total Cost")}>
                                <strong>
                                  {formatCurrency(item.totalCostAfn)}
                                </strong>
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

            <footer className="stock-transfers__dialog-footer">
              <button
                className="stock-transfers__primary"
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

function TransferPagination({
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
    <footer className="stock-transfers__pagination">
      <span>
        {interpolate(t("Showing {start}-{end} of {total} transfers"), {
          start: numberFormat.format(start),
          end: numberFormat.format(end),
          total: numberFormat.format(total),
        })}
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
          {interpolate(t("Page {page} of {lastPage}"), {
            page: numberFormat.format(page),
            lastPage: numberFormat.format(lastPage),
          })}
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
