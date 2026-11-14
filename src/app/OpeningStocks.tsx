import { useEffect, useState, type FormEvent } from "react";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Eye,
  Plus,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
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
    date: value.opening_date,
    warehouse: value.warehouse.name,
    creator: isRecord(value.creator) ? optionalText(value.creator.name) : null,
    notes: optionalText(value.notes),
    items: value.items.map(parseOpeningItem),
  };
}

export default function OpeningStocks() {
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
  const [formOpen, setFormOpen] = useState(false);
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
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<OpeningStock | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRetry, setDetailRetry] = useState(0);

  useEffect(() => {
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
  }, [page, retry]);

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
        if (!controller.signal.aborted) setOptionsError(getErrorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setOptionsLoading(false);
      });
    return () => controller.abort();
  }, [optionsRetry]);

  useEffect(() => {
    if (selectedId === null) return;
    const controller = new AbortController();
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    api
      .get<unknown>(`/api/opening-stocks/${selectedId}`, {
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
  }, [selectedId, detailRetry]);

  useEffect(() => {
    if (selectedId === null) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedId(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId]);

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(null), 6000);
    return () => window.clearTimeout(timer);
  }, [success]);

  function startCreate() {
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
    setFormOpen(true);
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
      setFormOpen(false);
      setPage(1);
      setRetry((current) => current + 1);
      setSuccess("Opening stock recorded successfully.");
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

  return (
    <div className="purchases-page inventory-operation-page">
      <header className="purchases-heading">
        <div>
          <p className="overview-eyebrow">INVENTORY</p>
          <h1>Opening Stock</h1>
          <p className="overview-heading__description">
            Record initial quantities and known lot details.
          </p>
        </div>
        <button
          className="purchase-create-button"
          type="button"
          onClick={startCreate}
          disabled={formOpen}
        >
          <Plus size={16} aria-hidden="true" />
          <span>New Opening Stock</span>
        </button>
      </header>
      {success && (
        <p className="purchase-success-message inventory-success" role="status">
          {success}
        </p>
      )}
      {formOpen && (
        <section
          className="purchases-panel inventory-form-panel"
          aria-labelledby="opening-form-title"
        >
          <header className="inventory-form-heading">
            <h2 id="opening-form-title">Create Opening Stock</h2>
            <button
              className="purchase-cancel-button"
              type="button"
              onClick={() => setFormOpen(false)}
              disabled={isSaving}
            >
              Cancel
            </button>
          </header>
          {formError && (
            <p
              className="create-purchase-alert inventory-form-alert"
              role="alert"
            >
              {formError}
            </p>
          )}
          {optionsError && (
            <div className="purchase-options-error" role="alert">
              {optionsError}{" "}
              <button
                type="button"
                onClick={() => setOptionsRetry((value) => value + 1)}
              >
                Retry
              </button>
            </div>
          )}
          <form
            className="inventory-form"
            onSubmit={(event) => void submit(event)}
            noValidate
          >
            <label className="purchase-field">
              <span>
                Warehouse <i>*</i>
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
                <option value="">Select warehouse</option>
                {warehouses.map((warehouse) => (
                  <option value={warehouse.id} key={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
              {fields.warehouse_id && (
                <small className="purchase-field__error">
                  {fields.warehouse_id}
                </small>
              )}
            </label>
            <label className="purchase-field">
              <span>
                Opening Date <i>*</i>
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
                  {fields.opening_date}
                </small>
              )}
            </label>
            <label className="purchase-field">
              <span>Notes</span>
              <textarea
                rows={2}
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
              />
            </label>
            <div className="inventory-lines inventory-form-wide">
              <div className="inventory-lines__heading">
                <strong>Products</strong>
                <button
                  className="purchase-add-item"
                  type="button"
                  onClick={addLine}
                  disabled={optionsLoading}
                >
                  <Plus size={14} aria-hidden="true" /> Add Product
                </button>
              </div>
              {lines.map((line) => (
                <div className="inventory-line" key={line.key}>
                  <label className="purchase-field">
                    <span>Product</span>
                    <select
                      value={line.productId}
                      onChange={(event) =>
                        setLineField(line.key, "productId", event.target.value)
                      }
                      disabled={optionsLoading || Boolean(optionsError)}
                      aria-invalid={Boolean(
                        fields[`items.${line.key}.product_id`],
                      )}
                    >
                      <option value="">Select product</option>
                      {products.map((product) => (
                        <option value={product.id} key={product.id}>
                          {product.name}
                          {product.sku ? ` · ${product.sku}` : ""}
                        </option>
                      ))}
                    </select>
                    {fields[`items.${line.key}.product_id`] && (
                      <small className="purchase-field__error">
                        {fields[`items.${line.key}.product_id`]}
                      </small>
                    )}
                  </label>
                  <label className="purchase-field">
                    <span>Quantity</span>
                    <input
                      type="number"
                      min="0"
                      step="0.0001"
                      value={line.quantity}
                      onChange={(event) =>
                        setLineField(line.key, "quantity", event.target.value)
                      }
                      aria-invalid={Boolean(
                        fields[`items.${line.key}.quantity`],
                      )}
                    />
                    {fields[`items.${line.key}.quantity`] && (
                      <small className="purchase-field__error">
                        {fields[`items.${line.key}.quantity`]}
                      </small>
                    )}
                  </label>
                  <label className="purchase-field">
                    <span>Unit Cost AFN</span>
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
                        fields[`items.${line.key}.unit_cost_afn`],
                      )}
                    />
                    {fields[`items.${line.key}.unit_cost_afn`] && (
                      <small className="purchase-field__error">
                        {fields[`items.${line.key}.unit_cost_afn`]}
                      </small>
                    )}
                  </label>
                  <label className="purchase-field">
                    <span>Batch Number (optional)</span>
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
                    />
                  </label>
                  <label className="purchase-field">
                    <span>Expiry Date (optional)</span>
                    <input
                      type="date"
                      min={form.date || undefined}
                      value={line.expiryDate}
                      onChange={(event) =>
                        setLineField(line.key, "expiryDate", event.target.value)
                      }
                      aria-invalid={Boolean(
                        fields[`items.${line.key}.expiry_date`],
                      )}
                    />
                    {fields[`items.${line.key}.expiry_date`] && (
                      <small className="purchase-field__error">
                        {fields[`items.${line.key}.expiry_date`]}
                      </small>
                    )}
                  </label>
                  <button
                    className="purchase-modal__close inventory-line__remove"
                    type="button"
                    onClick={() =>
                      setLines((current) =>
                        current.filter((entry) => entry.key !== line.key),
                      )
                    }
                    disabled={lines.length <= 1}
                    aria-label="Remove opening stock product"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
            <p className="inventory-form-hint inventory-form-wide">
              Leave batch and expiry blank when the original lot details are
              unknown.
            </p>
            <div className="inventory-form-actions">
              <button
                className="purchase-cancel-button"
                type="button"
                onClick={() => setFormOpen(false)}
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                className="purchase-save-button"
                type="submit"
                disabled={isSaving || optionsLoading || Boolean(optionsError)}
              >
                {isSaving ? "Saving…" : "Record Opening Stock"}
              </button>
            </div>
          </form>
        </section>
      )}
      <section className="purchases-panel" aria-label="Opening stock records">
        {isLoading ? (
          <div className="purchases-state" role="status">
            <span className="loading-spinner" /> Loading opening stock...
          </div>
        ) : listError ? (
          <div className="purchases-state purchases-state--error" role="alert">
            <span>{listError}</span>
            <button
              className="purchases-retry"
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              Try again
            </button>
          </div>
        ) : records && records.data.length === 0 ? (
          <div className="purchases-state purchases-state--empty">
            <strong>No opening stock records</strong>
            <span>Opening entries will appear here.</span>
          </div>
        ) : records ? (
          <>
            <div className="purchases-table-scroll">
              <table className="purchases-table inventory-table">
                <thead>
                  <tr>
                    <th>Opening Number</th>
                    <th>Date</th>
                    <th>Warehouse</th>
                    <th>Products</th>
                    <th>Created By</th>
                    <th>Details</th>
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
                          onClick={() => setSelectedId(record.id)}
                        >
                          <Eye size={14} aria-hidden="true" /> Details
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
            />
          </>
        ) : null}
      </section>
      {selectedId !== null && (
        <div
          className="purchase-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedId(null);
          }}
        >
          <section
            className="purchase-modal inventory-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="opening-detail-title"
          >
            <header className="purchase-modal__header">
              <div>
                <p className="overview-eyebrow">OPENING STOCK DETAILS</p>
                <h2 id="opening-detail-title">
                  {detail?.number ?? "Opening Stock"}
                </h2>
                <p>{detail?.date ?? ""}</p>
              </div>
              <button
                className="purchase-modal__close"
                type="button"
                onClick={() => setSelectedId(null)}
                aria-label="Close details"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <div className="purchase-modal__body">
              {detailLoading ? (
                <div className="purchases-state" role="status">
                  <span className="loading-spinner" /> Loading opening stock...
                </div>
              ) : detailError ? (
                <div
                  className="purchases-state purchases-state--error"
                  role="alert"
                >
                  <span>{detailError}</span>
                  <button
                    className="purchases-retry"
                    type="button"
                    onClick={() => setDetailRetry((value) => value + 1)}
                  >
                    Try again
                  </button>
                </div>
              ) : detail ? (
                <>
                  <dl className="purchase-detail-grid inventory-detail-grid">
                    <div>
                      <dt>Warehouse</dt>
                      <dd>{detail.warehouse}</dd>
                    </div>
                    <div>
                      <dt>Created By</dt>
                      <dd>{detail.creator || "—"}</dd>
                    </div>
                    <div>
                      <dt>Notes</dt>
                      <dd>{detail.notes || "—"}</dd>
                    </div>
                  </dl>
                  <div className="purchases-table-scroll">
                    <table className="purchases-table inventory-detail-table">
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th>Quantity</th>
                          <th>Unit Cost</th>
                          <th>Total Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.items.map((item) => (
                          <tr key={item.id}>
                            <td>
                              {item.product}
                              {item.sku ? ` · ${item.sku}` : ""}
                            </td>
                            <td>
                              {formatQuantity(item.quantity)} {item.unit || ""}
                            </td>
                            <td>{formatCurrency(item.unitCostAfn)}</td>
                            <td>{formatCurrency(item.totalCostAfn)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function OpeningPagination({
  page,
  pageSize,
  total,
  lastPage,
  setPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  lastPage: number;
  setPage: (page: number) => void;
}) {
  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(page * pageSize, total);
  return (
    <footer className="purchases-pagination">
      <span>
        Showing {start}-{end} of {new Intl.NumberFormat().format(total)} opening
        records
      </span>
      <div className="purchases-pagination__controls">
        <button
          type="button"
          onClick={() => setPage(page - 1)}
          disabled={page <= 1}
        >
          <ChevronLeft size={16} aria-hidden="true" /> Previous
        </button>
        <span>
          Page <strong>{page}</strong> of <strong>{lastPage}</strong>
        </span>
        <button
          type="button"
          onClick={() => setPage(page + 1)}
          disabled={page >= lastPage}
        >
          Next <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </footer>
  );
}
