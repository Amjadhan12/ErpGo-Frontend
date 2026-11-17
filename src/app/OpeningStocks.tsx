import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Eye,
  Plus,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import {
  formatCurrency,
  formatQuantity,
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

interface OpeningItem {
  id: number;
  product: string;
  sku: string | null;
  unit: string | null;
  quantity: number;
  unitCostAfn: number;
  totalCostAfn: number;
}

interface OpeningStock {
  id: number;
  number: string;
  date: string;
  warehouse: string;
  creator: string | null;
  notes: string | null;
  items: OpeningItem[];
}

interface OpeningLine {
  key: number;
  productId: string;
  quantity: string;
  unitCostAfn: string;
  batchNumber: string;
  expiryDate: string;
}

interface OpeningForm {
  warehouseId: string;
  date: string;
  notes: string;
}

function parseOpeningItem(value: unknown): OpeningItem {
  if (
    !isRecord(value) ||
    !isRecord(value.product) ||
    typeof value.product.name !== "string"
  ) {
    throw new Error("The opening stock response contains an incomplete item.");
  }
  return {
    id: parseId(value.id, "opening item ID"),
    product: value.product.name,
    sku: optionalText(value.product.sku),
    unit: optionalText(value.product.unit),
    quantity: numberValue(value.quantity, "opening quantity"),
    unitCostAfn: numberValue(value.unit_cost_afn, "unit cost"),
    totalCostAfn: numberValue(value.total_cost_afn, "total cost"),
  };
}

function parseOpeningStock(value: unknown): OpeningStock {
  if (
    !isRecord(value) ||
    typeof value.opening_number !== "string" ||
    typeof value.opening_date !== "string" ||
    !isRecord(value.warehouse) ||
    typeof value.warehouse.name !== "string" ||
    !Array.isArray(value.items)
  ) {
    throw new Error(
      "The opening stock response contains an incomplete record.",
    );
  }
  return {
    id: parseId(value.id, "opening stock ID"),
    number: value.opening_number,
    date: value.opening_date.slice(0, 10),
    warehouse: value.warehouse.name,
    creator: isRecord(value.creator) ? optionalText(value.creator.name) : null,
    notes: optionalText(value.notes),
    items: value.items.map(parseOpeningItem),
  };
}

export default function OpeningStocks({
  createMode = false,
}: {
  createMode?: boolean;
}) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const { id: routeId } = useParams();
  const isDetailsPage = routeId !== undefined;
  const detailId =
    routeId && /^\d+$/.test(routeId) && Number(routeId) > 0
      ? Number(routeId)
      : null;
  const [records, setRecords] = useState<LaravelPage<OpeningStock> | null>(
    null,
  );
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
  const [form, setForm] = useState<OpeningForm>({
    warehouseId: "",
    date: todayValue(),
    notes: "",
  });
  const [lines, setLines] = useState<OpeningLine[]>([
    {
      key: 1,
      productId: "",
      quantity: "",
      unitCostAfn: "",
      batchNumber: "",
      expiryDate: "",
    },
  ]);
  const [fields, setFields] = useState<InventoryFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [detail, setDetail] = useState<OpeningStock | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRetry, setDetailRetry] = useState(0);

  function translateError(message: string): string {
    return t(message.replace(/\bitems\.\d+\./g, "items.*."));
  }

  useEffect(() => {
    if (createMode || isDetailsPage) return;
    const controller = new AbortController();
    setIsLoading(true);
    setListError(null);
    api
      .get<unknown>("/api/opening-stocks", {
        params: { page },
        signal: controller.signal,
      })
      .then(({ data }) => setRecords(parseLaravelPage(data, parseOpeningStock)))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setRecords(null);
          setListError(getErrorMessage(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [createMode, isDetailsPage, page, retry]);

  useEffect(() => {
    if (!createMode) return;
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
        if (!controller.signal.aborted) setOptionsError(getErrorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setOptionsLoading(false);
      });
    return () => controller.abort();
  }, [createMode, optionsRetry]);

  useEffect(() => {
    if (!createMode) return;
    setForm({ warehouseId: "", date: todayValue(), notes: "" });
    setLines([
      {
        key: 1,
        productId: "",
        quantity: "",
        unitCostAfn: "",
        batchNumber: "",
        expiryDate: "",
      },
    ]);
    setFields({});
    setFormError(null);
  }, [createMode, location.pathname]);

  useEffect(() => {
    if (!isDetailsPage) return;
    if (detailId === null) {
      setDetail(null);
      setDetailError("Invalid opening stock reference.");
      setDetailLoading(false);
      return;
    }
    const controller = new AbortController();
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    api
      .get<unknown>(`/api/opening-stocks/${detailId}`, {
        signal: controller.signal,
      })
      .then(({ data }) => {
        if (!isRecord(data) || !("data" in data))
          throw new Error("The opening stock details response was incomplete.");
        setDetail(parseOpeningStock(data.data));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setDetailError(getErrorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [detailId, detailRetry, isDetailsPage]);

  useEffect(() => {
    if (
      createMode ||
      isDetailsPage ||
      !isRecord(location.state) ||
      location.state.openingStockCreated !== true
    ) {
      return;
    }
    setSuccess("Opening stock recorded successfully.");
    setPage(1);
    setRetry((current) => current + 1);
    navigate(location.pathname, { replace: true, state: null });
  }, [createMode, isDetailsPage, location.pathname, location.state, navigate]);

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(null), 6000);
    return () => window.clearTimeout(timer);
  }, [success]);

  function startCreate() {
    navigate("/secretary/opening-stocks/create");
  }

  function setLineField(
    key: number,
    field: keyof Omit<OpeningLine, "key">,
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
        `items.${key}.${field === "productId" ? "product_id" : field === "unitCostAfn" ? "unit_cost_afn" : field}`
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
      const match = field.match(/^items\.(\d+)\.(.+)$/);
      if (match && lines[Number(match[1])])
        mapped[`items.${lines[Number(match[1])].key}.${match[2]}`] = message;
      else mapped[field] = message;
    }
    setFields(mapped);
    setFormError(result.message);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    const nextFields: InventoryFieldErrors = {};
    if (!form.warehouseId) nextFields.warehouse_id = "Select a warehouse.";
    if (!form.date) nextFields.opening_date = "Select an opening date.";
    if (!lines.length) nextFields.items = "Add at least one product.";
    if (
      new Set(lines.map((line) => line.productId).filter(Boolean)).size !==
      lines.map((line) => line.productId).filter(Boolean).length
    )
      nextFields.items = "A product may only appear once per opening entry.";
    for (const line of lines) {
      if (!line.productId)
        nextFields[`items.${line.key}.product_id`] = "Select a product.";
      const quantity = Number(line.quantity);
      const cost = Number(line.unitCostAfn);
      if (!line.quantity || !Number.isFinite(quantity) || quantity <= 0)
        nextFields[`items.${line.key}.quantity`] =
          "Enter a quantity greater than zero.";
      if (!line.unitCostAfn || !Number.isFinite(cost) || cost < 0)
        nextFields[`items.${line.key}.unit_cost_afn`] =
          "Enter a non-negative unit cost.";
      if (line.batchNumber.length > 100)
        nextFields[`items.${line.key}.batch_number`] =
          "Batch number cannot exceed 100 characters.";
      if (line.expiryDate && form.date && line.expiryDate < form.date)
        nextFields[`items.${line.key}.expiry_date`] =
          "Expiry date cannot be before the opening date.";
    }
    setFields(nextFields);
    if (Object.keys(nextFields).length) {
      setFormError("Check the highlighted fields.");
      return;
    }
    setIsSaving(true);
    setFormError(null);
    try {
      await api.post("/api/opening-stocks", {
        warehouse_id: Number(form.warehouseId),
        opening_date: form.date,
        notes: form.notes.trim() || null,
        items: lines.map((line) => ({
          product_id: Number(line.productId),
          quantity: Number(line.quantity),
          unit_cost_afn: Number(line.unitCostAfn),
          batch_number: line.batchNumber.trim() || null,
          expiry_date: line.expiryDate || null,
        })),
      });
      navigate("/secretary/opening-stocks", {
        replace: true,
        state: { openingStockCreated: true },
      });
    } catch (error: unknown) {
      applyValidation(error);
    } finally {
      setIsSaving(false);
    }
  }

  const addLine = () =>
    setLines((current) => [
      ...current,
      {
        key: current.reduce((max, line) => Math.max(max, line.key), 0) + 1,
        productId: "",
        quantity: "",
        unitCostAfn: "",
        batchNumber: "",
        expiryDate: "",
      },
    ]);
  const pageSize = records?.perPage ?? 15;

  if (isDetailsPage) {
    return (
      <main className="purchases-page inventory-operation-page opening-stock-details-page">
        <header className="purchases-heading">
          <div>
            <p className="overview-eyebrow">{t("INVENTORY")}</p>
            <h1>{t("Opening Stock Details")}</h1>
            <p className="overview-heading__description">
              {detail?.number ?? t("Review the saved opening stock entry.")}
            </p>
          </div>
          <button
            className="overview-refresh"
            type="button"
            onClick={() => navigate("/secretary/opening-stocks")}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            {t("Back to Opening Stocks")}
          </button>
        </header>
        {detailLoading ? (
          <section className="purchases-panel purchases-state" role="status">
            <span className="loading-spinner" /> {t("Loading opening stock…")}
          </section>
        ) : detailError ? (
          <section
            className="purchases-panel purchases-state purchases-state--error"
            role="alert"
          >
            <span>{t(detailError)}</span>
            {detailId !== null && (
              <button
                className="purchases-retry"
                type="button"
                onClick={() => setDetailRetry((value) => value + 1)}
              >
                {t("Try again")}
              </button>
            )}
          </section>
        ) : detail ? (
          <>
            <section
              className="opening-stock-summary"
              aria-label={t("Opening stock summary")}
            >
              <article className="opening-stock-summary__primary">
                <span>{t("Opening Number")}</span>
                <strong>{detail.number}</strong>
              </article>
              <article>
                <span>{t("Opening Date")}</span>
                <strong>{detail.date}</strong>
              </article>
              <article>
                <span>{t("Warehouse")}</span>
                <strong>{detail.warehouse}</strong>
              </article>
              <article>
                <span>{t("Products")}</span>
                <strong>{detail.items.length}</strong>
              </article>
            </section>
            <section className="purchases-panel opening-stock-details-panel">
              <header className="opening-stock-section-heading">
                <div>
                  <h2>{t("Product entries")}</h2>
                  <p>{t("Saved quantities and cost information.")}</p>
                </div>
              </header>
              <div className="purchases-table-scroll">
                <table className="purchases-table inventory-detail-table opening-stock-detail-table">
                  <thead>
                    <tr>
                      <th>{t("Product")}</th>
                      <th>{t("Quantity")}</th>
                      <th>{t("Unit")}</th>
                      <th>{t("Unit Cost")}</th>
                      <th>{t("Total Cost")}</th>
                      <th>{t("Currency")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((item) => (
                      <tr key={item.id}>
                        <td data-label={t("Product")}>
                          <span className="opening-stock-product-name">
                            <strong>{item.product}</strong>
                            {item.sku && (
                              <small className="opening-stock-item-sku">
                                {t("SKU")}: {item.sku}
                              </small>
                            )}
                          </span>
                        </td>
                        <td data-label={t("Quantity")}>
                          {formatQuantity(item.quantity)}
                        </td>
                        <td data-label={t("Unit")}>{item.unit || "—"}</td>
                        <td data-label={t("Unit Cost")}>
                          {formatCurrency(item.unitCostAfn)}
                        </td>
                        <td data-label={t("Total Cost")}>
                          {formatCurrency(item.totalCostAfn)}
                        </td>
                        <td data-label={t("Currency")}>
                          <span className="opening-stock-currency">AFN</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <dl className="opening-stock-notes">
                <div>
                  <dt>{t("Created By")}</dt>
                  <dd>{detail.creator || "—"}</dd>
                </div>
                <div>
                  <dt>{t("Notes")}</dt>
                  <dd>{detail.notes || "—"}</dd>
                </div>
              </dl>
            </section>
          </>
        ) : null}
      </main>
    );
  }

  if (createMode) {
    return (
      <main className="purchases-page inventory-operation-page opening-stock-create-page">
        <header className="purchases-heading">
          <div>
            <p className="overview-eyebrow">{t("INVENTORY")}</p>
            <h1>{t("Create Opening Stock")}</h1>
            <p className="overview-heading__description">
              {t("Enter the starting stock and its known purchase details.")}
            </p>
          </div>
          <button
            className="overview-refresh"
            type="button"
            onClick={() => navigate("/secretary/opening-stocks")}
            disabled={isSaving}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            {t("Back to Opening Stocks")}
          </button>
        </header>
        {formError && (
          <p
            className="create-purchase-alert inventory-form-alert"
            role="alert"
          >
            {translateError(formError)}
          </p>
        )}
        {optionsError && (
          <div className="purchase-options-error" role="alert">
            {translateError(optionsError)}{" "}
            <button
              type="button"
              onClick={() => setOptionsRetry((value) => value + 1)}
            >
              {t("Try again")}
            </button>
          </div>
        )}
        <form
          className="opening-stock-form"
          onSubmit={(event) => void submit(event)}
          noValidate
        >
          <section className="purchases-panel opening-stock-form-section">
            <header className="opening-stock-section-heading">
              <div>
                <h2>{t("General Information")}</h2>
                <p>{t("Choose where and when the opening stock applies.")}</p>
              </div>
              <span className="opening-stock-required-note">
                <i>*</i> {t("Required")}
              </span>
            </header>
            <div className="opening-stock-general-grid">
              <label className="purchase-field">
                <span>
                  {t("Warehouse")} <i>*</i>
                </span>
                <select
                  value={form.warehouseId}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      warehouseId: event.target.value,
                    }))
                  }
                  disabled={optionsLoading || Boolean(optionsError)}
                  aria-invalid={Boolean(fields.warehouse_id)}
                >
                  <option value="">{t("Select a warehouse")}</option>
                  {warehouses.map((warehouse) => (
                    <option value={warehouse.id} key={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                </select>
                {fields.warehouse_id && (
                  <small className="purchase-field__error">
                    {translateError(fields.warehouse_id)}
                  </small>
                )}
              </label>
              <label className="purchase-field">
                <span>
                  {t("Opening Date")} <i>*</i>
                </span>
                <input
                  type="date"
                  value={form.date}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      date: event.target.value,
                    }))
                  }
                  aria-invalid={Boolean(fields.opening_date)}
                />
                {fields.opening_date && (
                  <small className="purchase-field__error">
                    {translateError(fields.opening_date)}
                  </small>
                )}
              </label>
              <label className="purchase-field opening-stock-notes-field">
                <span>{t("Notes")}</span>
                <textarea
                  rows={3}
                  value={form.notes}
                  placeholder={t("Add any helpful notes (optional)")}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
          </section>

          <section className="purchases-panel opening-stock-form-section">
            <header className="opening-stock-section-heading">
              <div>
                <h2>{t("Product Entries")}</h2>
                <p>
                  {t("Select each product and enter its quantity and AFN unit cost.")}
                </p>
              </div>
              <button
                className="purchase-add-item"
                type="button"
                onClick={addLine}
                disabled={optionsLoading || isSaving}
              >
                <Plus size={14} aria-hidden="true" /> {t("Add Product")}
              </button>
            </header>
            <div className="opening-stock-lines">
              {lines.map((line, index) => {
                const selectedProduct = products.find(
                  (product) => String(product.id) === line.productId,
                );
                return (
                  <fieldset className="opening-stock-line" key={line.key}>
                    <legend>
                      {t("Product")} {index + 1}
                    </legend>
                    <div className="opening-stock-line-grid">
                      <label className="purchase-field opening-stock-product-field">
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
                          disabled={optionsLoading || Boolean(optionsError)}
                          aria-invalid={Boolean(
                            fields[`items.${line.key}.product_id`],
                          )}
                        >
                          <option value="">{t("Select a product")}</option>
                          {products.map((product) => (
                            <option value={product.id} key={product.id}>
                              {product.name}
                              {product.sku ? ` · ${product.sku}` : ""}
                            </option>
                          ))}
                        </select>
                        {fields[`items.${line.key}.product_id`] && (
                          <small className="purchase-field__error">
                            {translateError(fields[`items.${line.key}.product_id`])}
                          </small>
                        )}
                      </label>
                      <label className="purchase-field">
                        <span>
                          {t("Quantity")} <i>*</i>
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          value={line.quantity}
                          placeholder={t("Enter quantity")}
                          onChange={(event) =>
                            setLineField(
                              line.key,
                              "quantity",
                              event.target.value,
                            )
                          }
                          aria-invalid={Boolean(
                            fields[`items.${line.key}.quantity`],
                          )}
                        />
                        {fields[`items.${line.key}.quantity`] && (
                          <small className="purchase-field__error">
                            {translateError(fields[`items.${line.key}.quantity`])}
                          </small>
                        )}
                      </label>
                      <label className="purchase-field">
                        <span>{t("Unit")}</span>
                        <input
                          value={selectedProduct?.unit ?? ""}
                          placeholder={t("Selected product unit")}
                          readOnly
                        />
                      </label>
                      <label className="purchase-field">
                        <span>
                          {t("Unit Cost (AFN)")} <i>*</i>
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.000001"
                          value={line.unitCostAfn}
                          placeholder={t("Enter unit cost")}
                          onChange={(event) =>
                            setLineField(
                              line.key,
                              "unitCostAfn",
                              event.target.value,
                            )
                          }
                          aria-invalid={Boolean(
                            fields[`items.${line.key}.unit_cost_afn`],
                          )}
                        />
                        {fields[`items.${line.key}.unit_cost_afn`] && (
                          <small className="purchase-field__error">
                            {translateError(fields[`items.${line.key}.unit_cost_afn`])}
                          </small>
                        )}
                      </label>
                      <label className="purchase-field">
                        <span>{t("Batch Number (optional)")}</span>
                        <input
                          maxLength={100}
                          value={line.batchNumber}
                          placeholder={t("Enter batch number")}
                          onChange={(event) =>
                            setLineField(
                              line.key,
                              "batchNumber",
                              event.target.value,
                            )
                          }
                        />
                        {fields[`items.${line.key}.batch_number`] && (
                          <small className="purchase-field__error">
                            {translateError(fields[`items.${line.key}.batch_number`])}
                          </small>
                        )}
                      </label>
                      <label className="purchase-field">
                        <span>{t("Expiry Date (optional)")}</span>
                        <input
                          type="date"
                          min={form.date || undefined}
                          value={line.expiryDate}
                          onChange={(event) =>
                            setLineField(
                              line.key,
                              "expiryDate",
                              event.target.value,
                            )
                          }
                          aria-invalid={Boolean(
                            fields[`items.${line.key}.expiry_date`],
                          )}
                        />
                        {fields[`items.${line.key}.expiry_date`] && (
                          <small className="purchase-field__error">
                            {translateError(fields[`items.${line.key}.expiry_date`])}
                          </small>
                        )}
                      </label>
                    </div>
                    <button
                      className="opening-stock-line-remove"
                      type="button"
                      onClick={() =>
                        setLines((current) =>
                          current.filter((entry) => entry.key !== line.key),
                        )
                      }
                      disabled={lines.length <= 1 || isSaving}
                      aria-label={`${t("Remove opening stock product")} ${index + 1}`}
                    >
                      <X size={15} aria-hidden="true" />
                      {t("Remove")}
                    </button>
                  </fieldset>
                );
              })}
            </div>
            <p className="opening-stock-form-hint">
              {t("Leave batch and expiry blank when the original lot details are unknown.")}
            </p>
          </section>

          <footer className="opening-stock-form-actions">
            <button
              className="purchase-cancel-button"
              type="button"
              onClick={() => navigate("/secretary/opening-stocks")}
              disabled={isSaving}
            >
              {t("Cancel")}
            </button>
            <button
              className="purchase-save-button"
              type="submit"
              disabled={isSaving || optionsLoading || Boolean(optionsError)}
            >
              {isSaving ? t("Saving…") : t("Record Opening Stock")}
            </button>
          </footer>
        </form>
      </main>
    );
  }

  return (
    <main className="purchases-page inventory-operation-page opening-stock-list-page">
      <header className="purchases-heading">
        <div>
          <p className="overview-eyebrow">{t("INVENTORY")}</p>
          <h1>{t("Opening Stock")}</h1>
          <p className="overview-heading__description">
            {t("Record initial quantities and known lot details.")}
          </p>
        </div>
        <button
          className="purchase-create-button"
          type="button"
          onClick={startCreate}
        >
          <Plus size={16} aria-hidden="true" />
          <span>{t("New Opening Stock")}</span>
        </button>
      </header>
      {success && (
        <p className="purchase-success-message inventory-success" role="status">
          {t(success)}
        </p>
      )}
      <section
        className="purchases-panel"
        aria-label={t("Opening stock records")}
      >
        {isLoading ? (
          <div className="purchases-state" role="status">
            <span className="loading-spinner" /> {t("Loading opening stock…")}
          </div>
        ) : listError ? (
          <div className="purchases-state purchases-state--error" role="alert">
            <span>{t(listError)}</span>
            <button
              className="purchases-retry"
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              {t("Try again")}
            </button>
          </div>
        ) : records && records.data.length === 0 ? (
          <div className="purchases-state purchases-state--empty">
            <strong>{t("No opening stock records")}</strong>
            <span>{t("Opening entries will appear here.")}</span>
          </div>
        ) : records ? (
          <>
            <div className="purchases-table-scroll">
              <table className="purchases-table inventory-table">
                <thead>
                  <tr>
                    <th>{t("Opening Number")}</th>
                    <th>{t("Date")}</th>
                    <th>{t("Warehouse")}</th>
                    <th>{t("Products")}</th>
                    <th>{t("Created By")}</th>
                    <th>{t("Details")}</th>
                  </tr>
                </thead>
                <tbody>
                  {records.data.map((record) => (
                    <tr key={record.id}>
                      <td>
                        <strong className="purchases-number">
                          {record.number}
                        </strong>
                      </td>
                      <td>{record.date}</td>
                      <td>{record.warehouse}</td>
                      <td>{record.items.length}</td>
                      <td>{record.creator || "—"}</td>
                      <td>
                        <button
                          className="purchase-view-button"
                          type="button"
                          onClick={() =>
                            navigate(`/secretary/opening-stocks/${record.id}`)
                          }
                        >
                          <Eye size={14} aria-hidden="true" /> {t("Details")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <OpeningPagination
              page={page}
              pageSize={pageSize}
              total={records.total}
              lastPage={records.lastPage}
              setPage={setPage}
              translate={t}
            />
          </>
        ) : null}
      </section>
    </main>
  );
}

function OpeningPagination({
  page,
  pageSize,
  total,
  lastPage,
  setPage,
  translate,
}: {
  page: number;
  pageSize: number;
  total: number;
  lastPage: number;
  setPage: (page: number) => void;
  translate: (text: string) => string;
}) {
  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(page * pageSize, total);
  return (
    <footer className="purchases-pagination">
      <span>
        {translate("Showing")} {start}-{end} {translate("of")}{" "}
        {new Intl.NumberFormat().format(total)} {translate("opening records")}
      </span>
      <div className="purchases-pagination__controls">
        <button
          type="button"
          onClick={() => setPage(page - 1)}
          disabled={page <= 1}
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
        >
          {translate("Next")} <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </footer>
  );
}
