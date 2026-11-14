import { useEffect, useState, type FormEvent } from "react";
import axios from "axios";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Eye,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { api } from "@/lib/api";

interface Warehouse {
  id: number;
  name: string;
  location: string | null;
  description: string | null;
  isActive: boolean;
  inventoryBalanceRecords: number;
}

interface WarehousePage {
  data: Warehouse[];
  currentPage: number;
  lastPage: number;
  perPage: number;
  total: number;
}

interface WarehouseForm {
  name: string;
  location: string;
  description: string;
}

type FieldErrors = Record<string, string>;

const emptyForm: WarehouseForm = {
  name: "",
  location: "",
  description: "",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseId(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error("The server returned an invalid warehouse ID.");
  return parsed;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function parseWarehouse(value: unknown): Warehouse {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.is_active !== "boolean"
  ) {
    throw new Error("The warehouse response contains an incomplete record.");
  }
  const inventoryBalanceRecords = Number(value.inventory_balances_count ?? 0);
  if (
    !Number.isInteger(inventoryBalanceRecords) ||
    inventoryBalanceRecords < 0
  ) {
    throw new Error("The server returned an invalid balance record count.");
  }
  return {
    id: parseId(value.id),
    name: value.name,
    location: optionalText(value.location),
    description: optionalText(value.description),
    isActive: value.is_active,
    inventoryBalanceRecords,
  };
}

function parseWarehousePage(value: unknown): WarehousePage {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !Array.isArray(value.data.data) ||
    !Number.isInteger(value.data.current_page) ||
    !Number.isInteger(value.data.last_page) ||
    !Number.isInteger(value.data.per_page) ||
    !Number.isInteger(value.data.total)
  ) {
    throw new Error(
      "The warehouse list did not contain valid pagination data.",
    );
  }
  return {
    data: value.data.data.map(parseWarehouse),
    currentPage: value.data.current_page as number,
    lastPage: value.data.last_page as number,
    perPage: value.data.per_page as number,
    total: value.data.total as number,
  };
}

function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const body: unknown = error.response?.data;
    if (isRecord(body) && typeof body.message === "string") return body.message;
    if (!error.response)
      return "Could not connect to the server. Check your connection and try again.";
  }
  return error instanceof Error
    ? error.message
    : "The warehouse request could not be completed.";
}

function getValidationErrors(error: unknown): {
  fields: FieldErrors;
  message: string;
} {
  const message = getErrorMessage(error);
  if (!axios.isAxiosError(error) || !isRecord(error.response?.data)) {
    return { fields: {}, message };
  }
  const body = error.response.data;
  const fields: FieldErrors = {};
  if (isRecord(body.errors)) {
    for (const [field, messages] of Object.entries(body.errors)) {
      if (Array.isArray(messages) && typeof messages[0] === "string") {
        fields[field] = messages[0];
      }
    }
  }
  return { fields, message };
}

export default function Warehouses() {
  const [warehouses, setWarehouses] = useState<WarehousePage | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [listRetry, setListRetry] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [form, setForm] = useState<WarehouseForm>(emptyForm);
  const [formFields, setFormFields] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<number | null>(
    null,
  );
  const [warehouseDetails, setWarehouseDetails] = useState<Warehouse | null>(
    null,
  );
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRetry, setDetailRetry] = useState(0);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isDeactivating, setIsDeactivating] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSearch(search.trim()),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setListError(null);
    api
      .get<unknown>("/api/warehouses", {
        params: {
          search: debouncedSearch || undefined,
          is_active: statusFilter === "all" ? undefined : statusFilter,
          per_page: 10,
          page,
        },
        signal: controller.signal,
      })
      .then(({ data }) => setWarehouses(parseWarehousePage(data)))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setWarehouses(null);
          setListError(getErrorMessage(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [debouncedSearch, statusFilter, page, listRetry]);

  useEffect(() => {
    if (selectedWarehouseId === null) return;
    const controller = new AbortController();
    setIsDetailLoading(true);
    setDetailError(null);
    setWarehouseDetails(null);
    api
      .get<unknown>(`/api/warehouses/${selectedWarehouseId}`, {
        signal: controller.signal,
      })
      .then(({ data }) => {
        if (!isRecord(data) || !("data" in data))
          throw new Error("The warehouse details response was incomplete.");
        setWarehouseDetails(parseWarehouse(data.data));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setDetailError(getErrorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsDetailLoading(false);
      });
    return () => controller.abort();
  }, [selectedWarehouseId, detailRetry]);

  useEffect(() => {
    if (selectedWarehouseId === null) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedWarehouseId(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedWarehouseId]);

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(null), 6000);
    return () => window.clearTimeout(timer);
  }, [success]);

  function openCreateForm() {
    setForm(emptyForm);
    setFormFields({});
    setFormError(null);
    setFormMode("create");
  }

  function openEditForm(warehouse: Warehouse) {
    setForm({
      name: warehouse.name,
      location: warehouse.location ?? "",
      description: warehouse.description ?? "",
    });
    setFormFields({});
    setFormError(null);
    setSelectedWarehouseId(null);
    setFormMode("edit");
  }

  function closeForm() {
    if (isSaving) return;
    setFormMode(null);
    setForm(emptyForm);
    setFormFields({});
    setFormError(null);
  }

  function setField(field: keyof WarehouseForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setFormFields((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setFormError(null);
    setSuccess(null);
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving || !formMode) return;
    const fields: FieldErrors = {};
    if (!form.name.trim()) fields.name = "Enter a warehouse name.";
    if (form.name.trim().length > 150)
      fields.name = "Warehouse name cannot exceed 150 characters.";
    if (form.location.trim().length > 255)
      fields.location = "Location cannot exceed 255 characters.";
    if (form.description.length > 2000)
      fields.description = "Description cannot exceed 2000 characters.";
    setFormFields(fields);
    if (Object.keys(fields).length) {
      setFormError("Check the highlighted fields.");
      return;
    }

    setIsSaving(true);
    setFormError(null);
    try {
      const payload = {
        name: form.name.trim(),
        location: form.location.trim() || null,
        description: form.description.trim() || null,
      };
      if (formMode === "create") {
        await api.post("/api/warehouses", payload);
        setSuccess("Warehouse created successfully.");
      } else {
        if (!warehouseDetails)
          throw new Error("Warehouse details are not available for editing.");
        await api.put(`/api/warehouses/${warehouseDetails.id}`, payload);
        setSuccess("Warehouse updated successfully.");
      }
      setFormMode(null);
      setForm(emptyForm);
      setPage(1);
      setListRetry((current) => current + 1);
    } catch (error: unknown) {
      const result = getValidationErrors(error);
      setFormFields(result.fields);
      setFormError(result.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function deactivateWarehouse() {
    if (!warehouseDetails || !warehouseDetails.isActive || isDeactivating)
      return;
    if (
      !window.confirm(
        `Deactivate ${warehouseDetails.name}? Warehouses with stock cannot be deactivated.`,
      )
    ) {
      return;
    }
    setIsDeactivating(true);
    setDetailError(null);
    try {
      const { data } = await api.patch<unknown>(
        `/api/warehouses/${warehouseDetails.id}/deactivate`,
      );
      if (!isRecord(data) || !("data" in data))
        throw new Error("The warehouse deactivation response was incomplete.");
      setWarehouseDetails(parseWarehouse(data.data));
      setSuccess("Warehouse deactivated successfully.");
      setListRetry((current) => current + 1);
    } catch (error: unknown) {
      setDetailError(getErrorMessage(error));
    } finally {
      setIsDeactivating(false);
    }
  }

  function updateFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  const startRecord =
    warehouses && warehouses.total > 0
      ? (warehouses.currentPage - 1) * warehouses.perPage + 1
      : 0;
  const endRecord = warehouses
    ? Math.min(
        (warehouses.currentPage - 1) * warehouses.perPage +
          warehouses.data.length,
        warehouses.total,
      )
    : 0;

  return (
    <div className="purchases-page warehouses-page">
      <header className="purchases-heading">
        <div>
          <p className="overview-eyebrow">INVENTORY</p>
          <h1>Warehouses</h1>
          <p className="overview-heading__description">
            Manage warehouse locations and availability.
          </p>
        </div>
        <button
          className="purchase-create-button"
          type="button"
          onClick={openCreateForm}
          disabled={formMode !== null}
        >
          <Plus size={16} aria-hidden="true" />
          <span>New Warehouse</span>
        </button>
      </header>

      {success && (
        <p
          className="purchase-success-message warehouses-success"
          role="status"
        >
          {success}
        </p>
      )}

      {formMode && (
        <section
          className="purchases-panel warehouses-form-panel"
          aria-labelledby="warehouse-form-title"
        >
          <header className="warehouses-form-heading">
            <h2 id="warehouse-form-title">
              {formMode === "create" ? "Create Warehouse" : "Edit Warehouse"}
            </h2>
            <button
              type="button"
              className="purchase-cancel-button"
              onClick={closeForm}
              disabled={isSaving}
            >
              Cancel
            </button>
          </header>
          {formError && (
            <p
              className="create-purchase-alert warehouses-form-alert"
              role="alert"
            >
              {formError}
            </p>
          )}
          <form
            className="warehouses-form"
            onSubmit={(event) => void submitForm(event)}
            noValidate
          >
            <label className="purchase-field">
              <span>
                Name <i>*</i>
              </span>
              <input
                value={form.name}
                onChange={(event) => setField("name", event.target.value)}
                maxLength={150}
                aria-invalid={Boolean(formFields.name)}
              />
              {formFields.name && (
                <small className="purchase-field__error">
                  {formFields.name}
                </small>
              )}
            </label>
            <label className="purchase-field">
              <span>Location</span>
              <input
                value={form.location}
                onChange={(event) => setField("location", event.target.value)}
                maxLength={255}
                aria-invalid={Boolean(formFields.location)}
              />
              {formFields.location && (
                <small className="purchase-field__error">
                  {formFields.location}
                </small>
              )}
            </label>
            <label className="purchase-field warehouses-form-wide">
              <span>Description</span>
              <textarea
                rows={3}
                maxLength={2000}
                value={form.description}
                onChange={(event) =>
                  setField("description", event.target.value)
                }
                aria-invalid={Boolean(formFields.description)}
              />
              {formFields.description && (
                <small className="purchase-field__error">
                  {formFields.description}
                </small>
              )}
            </label>
            <div className="warehouses-form-actions">
              <button
                type="button"
                className="purchase-cancel-button"
                onClick={closeForm}
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="purchase-save-button"
                disabled={isSaving}
              >
                {isSaving
                  ? "Saving…"
                  : formMode === "create"
                    ? "Create Warehouse"
                    : "Save Changes"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="purchases-panel" aria-label="Warehouse list">
        <div className="warehouses-toolbar">
          <label className="warehouses-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => updateFilter(setSearch, event.target.value)}
              placeholder="Search name or location"
              aria-label="Search warehouses by name or location"
            />
          </label>
          <label className="warehouses-status-filter">
            <span>Status</span>
            <select
              value={statusFilter}
              onChange={(event) =>
                updateFilter(setStatusFilter, event.target.value)
              }
              aria-label="Filter warehouses by status"
            >
              <option value="all">All statuses</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </label>
          <button
            className="overview-refresh"
            type="button"
            onClick={() => setListRetry((current) => current + 1)}
            disabled={isLoading}
            aria-label="Refresh warehouses"
          >
            <RefreshCw
              size={16}
              className={isLoading ? "overview-refresh__spinning" : ""}
              aria-hidden="true"
            />
            <span>Refresh</span>
          </button>
        </div>

        {isLoading ? (
          <div className="purchases-state" role="status">
            <span className="loading-spinner" /> Loading warehouses…
          </div>
        ) : listError ? (
          <div className="purchases-state purchases-state--error" role="alert">
            <AlertCircle size={20} aria-hidden="true" />
            <span>{listError}</span>
            <button
              type="button"
              className="purchases-retry"
              onClick={() => setListRetry((current) => current + 1)}
            >
              Try again
            </button>
          </div>
        ) : warehouses && warehouses.data.length === 0 ? (
          <div className="purchases-state purchases-state--empty">
            <span className="purchases-empty-mark">
              <Eye size={21} aria-hidden="true" />
            </span>
            <strong>
              {debouncedSearch || statusFilter !== "all"
                ? "No warehouses match these filters"
                : "No warehouses yet"}
            </strong>
            <span>
              {debouncedSearch || statusFilter !== "all"
                ? "Adjust the search or status filter and try again."
                : "Create a warehouse to see it listed here."}
            </span>
          </div>
        ) : warehouses ? (
          <>
            <div className="purchases-table-scroll">
              <table className="purchases-table warehouses-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Location</th>
                    <th>Balance Records</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {warehouses.data.map((warehouse) => (
                    <tr key={warehouse.id}>
                      <td>
                        <strong className="purchases-number">
                          {warehouse.name}
                        </strong>
                      </td>
                      <td>{warehouse.location || "—"}</td>
                      <td>
                        {new Intl.NumberFormat().format(
                          warehouse.inventoryBalanceRecords,
                        )}
                      </td>
                      <td>
                        <span
                          className={`product-status ${warehouse.isActive ? "product-status--active" : "product-status--inactive"}`}
                        >
                          {warehouse.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td>
                        <button
                          className="purchase-view-button"
                          type="button"
                          onClick={() => setSelectedWarehouseId(warehouse.id)}
                          aria-label={`View ${warehouse.name}`}
                        >
                          <Eye size={15} aria-hidden="true" />
                          <span>Details</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="purchases-pagination">
              <span>
                Showing {startRecord}–{endRecord} of{" "}
                {new Intl.NumberFormat().format(warehouses.total)} warehouses
              </span>
              <div className="purchases-pagination__controls">
                <button
                  type="button"
                  onClick={() => setPage(warehouses.currentPage - 1)}
                  disabled={isLoading || warehouses.currentPage <= 1}
                  aria-label="Previous page"
                >
                  <ChevronLeft size={16} aria-hidden="true" /> Previous
                </button>
                <span>
                  Page <strong>{warehouses.currentPage}</strong> of{" "}
                  <strong>{warehouses.lastPage}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setPage(warehouses.currentPage + 1)}
                  disabled={
                    isLoading || warehouses.currentPage >= warehouses.lastPage
                  }
                  aria-label="Next page"
                >
                  Next <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            </footer>
          </>
        ) : null}
      </section>

      {selectedWarehouseId !== null && (
        <div
          className="purchase-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget)
              setSelectedWarehouseId(null);
          }}
        >
          <section
            className="purchase-modal warehouse-details-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="warehouse-detail-title"
          >
            <header className="purchase-modal__header">
              <div>
                <p className="overview-eyebrow">WAREHOUSE DETAILS</p>
                <h2 id="warehouse-detail-title">
                  {warehouseDetails?.name ?? "Warehouse"}
                </h2>
                {warehouseDetails && <p>Warehouse #{warehouseDetails.id}</p>}
              </div>
              <button
                type="button"
                className="purchase-modal__close"
                onClick={() => setSelectedWarehouseId(null)}
                aria-label="Close details"
              >
                <X size={19} aria-hidden="true" />
              </button>
            </header>
            <div className="purchase-modal__body">
              {isDetailLoading ? (
                <div className="purchases-state" role="status">
                  <span className="loading-spinner" /> Loading warehouse
                  details…
                </div>
              ) : detailError && !warehouseDetails ? (
                <div
                  className="purchases-state purchases-state--error"
                  role="alert"
                >
                  <AlertCircle size={20} aria-hidden="true" />
                  <span>{detailError}</span>
                  <button
                    type="button"
                    className="purchases-retry"
                    onClick={() => setDetailRetry((current) => current + 1)}
                  >
                    Try again
                  </button>
                </div>
              ) : warehouseDetails ? (
                <>
                  {detailError && (
                    <p className="form-alert form-alert--error" role="alert">
                      {detailError}
                    </p>
                  )}
                  <dl className="purchase-detail-grid warehouse-detail-grid">
                    <div>
                      <dt>Name</dt>
                      <dd>{warehouseDetails.name}</dd>
                    </div>
                    <div>
                      <dt>Location</dt>
                      <dd>{warehouseDetails.location || "—"}</dd>
                    </div>
                    <div>
                      <dt>Balance Records</dt>
                      <dd>
                        {new Intl.NumberFormat().format(
                          warehouseDetails.inventoryBalanceRecords,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>
                        {warehouseDetails.isActive ? "Active" : "Inactive"}
                      </dd>
                    </div>
                  </dl>
                  <div className="warehouse-detail-description">
                    <strong>Description</strong>
                    <p>{warehouseDetails.description || "—"}</p>
                  </div>
                  <div className="warehouse-detail-actions">
                    <button
                      className="purchase-view-button"
                      type="button"
                      onClick={() => openEditForm(warehouseDetails)}
                    >
                      <Pencil size={15} aria-hidden="true" /> Edit Warehouse
                    </button>
                    {warehouseDetails.isActive && (
                      <button
                        className="product-deactivate-button"
                        type="button"
                        onClick={() => void deactivateWarehouse()}
                        disabled={isDeactivating}
                      >
                        {isDeactivating ? "Deactivating..." : "Deactivate"}
                      </button>
                    )}
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
