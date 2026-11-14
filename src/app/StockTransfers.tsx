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

function nextLineKey(lines: TransferLine[]): number {
  return lines.reduce((max, line) => Math.max(max, line.key), 0) + 1;
}

export default function StockTransfers() {
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
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<StockTransfer | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRetry, setDetailRetry] = useState(0);

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
      .get<unknown>(`/api/stock-transfers/${selectedId}`, {
        signal: controller.signal,
      })
      .then(({ data }) => {
        if (!isRecord(data) || !("data" in data))
          throw new Error("The transfer details response was incomplete.");
        setDetail(parseTransfer(data.data));
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
    setForm(emptyForm);
    setLines([{ key: 1, productId: "", quantity: "" }]);
    setFields({});
    setFormError(null);
    setFormOpen(true);
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
        if (line) mapped[`item.${line.key}.${match[2]}`] = message;
      } else {
        mapped[field] = message;
      }
    }
    setFields(mapped);
    setFormError(result.message);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    const nextFields: InventoryFieldErrors = {};
    if (!form.fromWarehouseId)
      nextFields.from_warehouse_id = "Select a source warehouse.";
    if (!form.toWarehouseId)
      nextFields.to_warehouse_id = "Select a destination warehouse.";
    if (form.fromWarehouseId && form.fromWarehouseId === form.toWarehouseId) {
      nextFields.to_warehouse_id = "Choose a different destination warehouse.";
    }
    if (!form.transferDate)
      nextFields.transfer_date = "Select a transfer date.";
    if (lines.length === 0) nextFields.items = "Add at least one product.";
    const selectedProductIds = lines
      .map((line) => line.productId)
      .filter(Boolean);
    if (new Set(selectedProductIds).size !== selectedProductIds.length) {
      nextFields.items = "A product may only appear once in a transfer.";
    }
    for (const [index, line] of lines.entries()) {
      if (!line.productId)
        nextFields[`items.${index}.product_id`] = "Select a product.";
      const quantity = Number(line.quantity);
      if (!line.quantity || !Number.isFinite(quantity) || quantity <= 0) {
        nextFields[`items.${index}.quantity`] =
          "Enter a quantity greater than zero.";
      }
    }
    setFields(nextFields);
    if (Object.keys(nextFields).length) {
      setFormError("Check the highlighted fields.");
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
      setSuccess("Stock transfer recorded successfully.");
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

  return (
    <div className="purchases-page inventory-operation-page">
      <header className="purchases-heading">
        <div>
          <p className="overview-eyebrow">INVENTORY</p>
          <h1>Stock Transfers</h1>
          <p className="overview-heading__description">
            Move stock between active warehouses.
          </p>
        </div>
        <button
          className="purchase-create-button"
          type="button"
          onClick={startCreate}
          disabled={formOpen}
        >
          <Plus size={16} aria-hidden="true" />
          <span>New Transfer</span>
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
          aria-labelledby="transfer-form-title"
        >
          <header className="inventory-form-heading">
            <h2 id="transfer-form-title">Create Stock Transfer</h2>
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
                From Warehouse <i>*</i>
              </span>
              <select
                value={form.fromWarehouseId}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    fromWarehouseId: event.target.value,
                  }))
                }
                disabled={optionsLoading || Boolean(optionsError)}
                aria-invalid={Boolean(fields.from_warehouse_id)}
              >
                <option value="">Select source</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
              {fields.from_warehouse_id && (
                <small className="purchase-field__error">
                  {fields.from_warehouse_id}
                </small>
              )}
            </label>
            <label className="purchase-field">
              <span>
                To Warehouse <i>*</i>
              </span>
              <select
                value={form.toWarehouseId}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    toWarehouseId: event.target.value,
                  }))
                }
                disabled={optionsLoading || Boolean(optionsError)}
                aria-invalid={Boolean(fields.to_warehouse_id)}
              >
                <option value="">Select destination</option>
                {warehouses.map((warehouse) => (
                  <option
                    key={warehouse.id}
                    value={warehouse.id}
                    disabled={String(warehouse.id) === form.fromWarehouseId}
                  >
                    {warehouse.name}
                  </option>
                ))}
              </select>
              {fields.to_warehouse_id && (
                <small className="purchase-field__error">
                  {fields.to_warehouse_id}
                </small>
              )}
            </label>
            <label className="purchase-field">
              <span>
                Transfer Date <i>*</i>
              </span>
              <input
                type="date"
                value={form.transferDate}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    transferDate: event.target.value,
                  }))
                }
                aria-invalid={Boolean(fields.transfer_date)}
              />
              {fields.transfer_date && (
                <small className="purchase-field__error">
                  {fields.transfer_date}
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
              {lines.map((line, index) => (
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
                        fields[`item.${line.key}.product_id`] ||
                        fields[`items.${index}.product_id`],
                      )}
                    >
                      <option value="">Select product</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name}
                          {product.sku ? ` · ${product.sku}` : ""}
                        </option>
                      ))}
                    </select>
                    {(fields[`item.${line.key}.product_id`] ||
                      fields[`items.${index}.product_id`]) && (
                      <small className="purchase-field__error">
                        {fields[`item.${line.key}.product_id`] ||
                          fields[`items.${index}.product_id`]}
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
                        fields[`item.${line.key}.quantity`] ||
                        fields[`items.${index}.quantity`],
                      )}
                    />
                    {(fields[`item.${line.key}.quantity`] ||
                      fields[`items.${index}.quantity`]) && (
                      <small className="purchase-field__error">
                        {fields[`item.${line.key}.quantity`] ||
                          fields[`items.${index}.quantity`]}
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
                    aria-label="Remove transfer product"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
            <p className="inventory-form-hint inventory-form-wide">
              The server allocates available batches in FEFO order.
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
                {isSaving ? "Saving…" : "Record Transfer"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="purchases-panel" aria-label="Stock transfers">
        {isLoading ? (
          <div className="purchases-state" role="status">
            <span className="loading-spinner" /> Loading transfers...
          </div>
        ) : listError ? (
          <div className="purchases-state purchases-state--error" role="alert">
            <AlertCircle size={20} aria-hidden="true" />
            <span>{listError}</span>
            <button
              className="purchases-retry"
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              Try again
            </button>
          </div>
        ) : transfers && transfers.data.length === 0 ? (
          <div className="purchases-state purchases-state--empty">
            <strong>No stock transfers yet</strong>
            <span>Posted transfers will appear here.</span>
          </div>
        ) : transfers ? (
          <>
            <div className="purchases-table-scroll">
              <table className="purchases-table inventory-table">
                <thead>
                  <tr>
                    <th>Transfer</th>
                    <th>Date</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Products</th>
                    <th>Created By</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {transfers.data.map((transfer) => (
                    <tr key={transfer.id}>
                      <td>
                        <strong className="purchases-number">
                          {transfer.transferNumber}
                        </strong>
                      </td>
                      <td>{transfer.transferDate}</td>
                      <td>{transfer.fromWarehouse}</td>
                      <td>{transfer.toWarehouse}</td>
                      <td>{transfer.items.length}</td>
                      <td>{transfer.creator || "—"}</td>
                      <td>
                        <button
                          className="purchase-view-button"
                          type="button"
                          onClick={() => setSelectedId(transfer.id)}
                        >
                          <Eye size={14} aria-hidden="true" /> Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <InventoryPagination
              page={page}
              pageSize={pageSize}
              total={transfers.total}
              lastPage={transfers.lastPage}
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
            aria-labelledby="transfer-detail-title"
          >
            <header className="purchase-modal__header">
              <div>
                <p className="overview-eyebrow">TRANSFER DETAILS</p>
                <h2 id="transfer-detail-title">
                  {detail?.transferNumber ?? "Stock Transfer"}
                </h2>
                <p>{detail?.transferDate ?? ""}</p>
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
                  <span className="loading-spinner" /> Loading transfer...
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
                      <dt>From</dt>
                      <dd>{detail.fromWarehouse}</dd>
                    </div>
                    <div>
                      <dt>To</dt>
                      <dd>{detail.toWarehouse}</dd>
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
                              {item.productName}
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

function InventoryPagination({
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
        Showing {start}-{end} of {new Intl.NumberFormat().format(total)}{" "}
        transfers
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
