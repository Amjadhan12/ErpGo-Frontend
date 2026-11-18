import { useEffect, useRef, useState, type FormEvent } from "react";
import axios from "axios";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Eye,
  MapPin,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Search,
} from "lucide-react";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/locale";

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
type WarehouseFormMode = "create" | "edit";

interface WarehouseModalHistoryEntry {
  state: unknown;
  url: string;
}

const emptyForm: WarehouseForm = {
  name: "",
  location: "",
  description: "",
};

interface WarehouseEditorProps {
  form: WarehouseForm;
  fields: FieldErrors;
  mode: WarehouseFormMode;
  isSaving: boolean;
  translate: (text: string) => string;
  onChange: (field: keyof WarehouseForm, value: string) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function WarehouseEditor({
  form,
  fields,
  mode,
  isSaving,
  translate,
  onChange,
  onCancel,
  onSubmit,
}: WarehouseEditorProps) {
  return (
    <form className="warehouses-form" onSubmit={onSubmit} noValidate>
      <label className="purchase-field">
        <span>
          {translate("Name")} <i>*</i>
        </span>
        <input
          value={form.name}
          onChange={(event) => onChange("name", event.target.value)}
          placeholder={translate("Warehouse name")}
          maxLength={150}
          aria-invalid={Boolean(fields.name)}
        />
        {fields.name && (
          <small className="purchase-field__error">
            {translate(fields.name)}
          </small>
        )}
      </label>
      <label className="purchase-field">
        <span>{translate("Location")}</span>
        <input
          value={form.location}
          onChange={(event) => onChange("location", event.target.value)}
          placeholder={translate("Warehouse location")}
          maxLength={255}
          aria-invalid={Boolean(fields.location)}
        />
        {fields.location && (
          <small className="purchase-field__error">
            {translate(fields.location)}
          </small>
        )}
      </label>
      <label className="purchase-field warehouses-form-wide">
        <span>{translate("Description")}</span>
        <textarea
          rows={3}
          maxLength={2000}
          value={form.description}
          placeholder={translate("Optional warehouse description")}
          onChange={(event) => onChange("description", event.target.value)}
          aria-invalid={Boolean(fields.description)}
        />
        {fields.description && (
          <small className="purchase-field__error">
            {translate(fields.description)}
          </small>
        )}
      </label>
      <div className="warehouses-form-actions">
        <button
          type="button"
          className="purchase-cancel-button"
          onClick={onCancel}
          disabled={isSaving}
        >
          {translate("Cancel")}
        </button>
        <button
          type="submit"
          className="purchase-save-button"
          disabled={isSaving}
        >
          {isSaving
            ? translate("Saving…")
            : mode === "create"
              ? translate("Create Warehouse")
              : translate("Save Changes")}
        </button>
      </div>
    </form>
  );
}

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
  const { t } = useLocale();
  const [warehouses, setWarehouses] = useState<WarehousePage | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [listRetry, setListRetry] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [statusActionError, setStatusActionError] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<WarehouseFormMode | null>(null);
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
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const modalHistoryEntry = useRef<WarehouseModalHistoryEntry | null>(null);
  const isClosingModalHistoryEntry = useRef(false);

  useEffect(() => {
    function handlePopState(event: PopStateEvent) {
      if (isClosingModalHistoryEntry.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        isClosingModalHistoryEntry.current = false;
        modalHistoryEntry.current = null;
        setFormMode(null);
        setForm(emptyForm);
        setFormFields({});
        setFormError(null);
        setSelectedWarehouseId(null);
        return;
      }

      const entry = modalHistoryEntry.current;
      if (!entry) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      window.history.pushState(entry.state, "", entry.url);
    }

    window.addEventListener("popstate", handlePopState, true);
    return () => window.removeEventListener("popstate", handlePopState, true);
  }, []);

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
    setFormMode("edit");
  }

  function closeForm() {
    if (isSaving) return;
    setFormMode(null);
    setForm(emptyForm);
    setFormFields({});
    setFormError(null);
  }

  function closeDetails() {
    if (isSaving) return;
    if (modalHistoryEntry.current) {
      isClosingModalHistoryEntry.current = true;
      window.history.back();
      return;
    }
    finishClosingDetails();
  }

  function finishClosingDetails() {
    setFormMode(null);
    setForm(emptyForm);
    setFormFields({});
    setFormError(null);
    setSelectedWarehouseId(null);
  }

  function openDetails(warehouseId: number) {
    const url = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const state = window.history.state;
    window.history.pushState(state, "", url);
    modalHistoryEntry.current = { state, url };
    setSelectedWarehouseId(warehouseId);
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
        const { data } = await api.put<unknown>(
          `/api/warehouses/${warehouseDetails.id}`,
          payload,
        );
        if (!isRecord(data) || !("data" in data))
          throw new Error("The warehouse details response was incomplete.");
        const updatedWarehouse = parseWarehouse(data.data);
        setWarehouseDetails({
          ...updatedWarehouse,
          inventoryBalanceRecords:
            warehouseDetails.inventoryBalanceRecords,
        });
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

  async function changeWarehouseStatus(warehouse: Warehouse, activate: boolean) {
    if (
      warehouse.isActive === activate ||
      isChangingStatus
    )
      return;
    const confirmation = `${t(activate ? "Activate" : "Deactivate")} ${warehouse.name}?${activate ? "" : ` ${t("Warehouses with stock cannot be deactivated.")}`}`;
    if (!window.confirm(confirmation)) {
      return;
    }
    setIsChangingStatus(true);
    setDetailError(null);
    setStatusActionError(null);
    try {
      const { data } = activate
        ? await api.put<unknown>(
            `/api/warehouses/${warehouse.id}`,
            {
              name: warehouse.name,
              location: warehouse.location,
              description: warehouse.description,
              is_active: true,
            },
          )
        : await api.patch<unknown>(
            `/api/warehouses/${warehouse.id}/deactivate`,
          );
      if (!isRecord(data) || !("data" in data))
        throw new Error("The warehouse status response was incomplete.");
      const updatedWarehouse = parseWarehouse(data.data);
      if (updatedWarehouse.id !== warehouse.id || updatedWarehouse.isActive !== activate)
        throw new Error("The warehouse status response did not confirm the requested status.");
      setWarehouseDetails((current) => current?.id === updatedWarehouse.id
        ? { ...updatedWarehouse, inventoryBalanceRecords: current.inventoryBalanceRecords }
        : current);
      setWarehouses((current) => current && ({
        ...current,
        data: current.data.map((item) => item.id === updatedWarehouse.id
          ? { ...updatedWarehouse, inventoryBalanceRecords: item.inventoryBalanceRecords }
          : item),
      }));
      setSuccess(
        activate
          ? "Warehouse activated successfully."
          : "Warehouse deactivated successfully.",
      );
      setListRetry((current) => current + 1);
    } catch (error: unknown) {
      setDetailError(getErrorMessage(error));
      setStatusActionError(getErrorMessage(error));
    } finally {
      setIsChangingStatus(false);
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
          <p className="overview-eyebrow">{t("INVENTORY")}</p>
          <h1>{t("Warehouses")}</h1>
          <p className="overview-heading__description">
            {t("Manage warehouse locations and availability.")}
          </p>
        </div>
        <button
          className="purchase-create-button"
          type="button"
          onClick={openCreateForm}
          disabled={formMode !== null}
        >
          <Plus size={16} aria-hidden="true" />
          <span>{t("New Warehouse")}</span>
        </button>
      </header>

      {success && (
        <p
          className="purchase-success-message warehouses-success"
          role="status"
        >
          {t(success)}
        </p>
      )}
      {statusActionError && (
        <p className="form-alert form-alert--error" role="alert">
          {t(statusActionError)}
        </p>
      )}

      {formMode === "create" && (
        <section
          className="purchases-panel warehouses-form-panel"
          aria-labelledby="warehouse-form-title"
        >
          <header className="warehouses-form-heading">
            <h2 id="warehouse-form-title">
              {t("Create Warehouse")}
            </h2>
            <button
              type="button"
              className="purchase-cancel-button"
              onClick={closeForm}
              disabled={isSaving}
            >
              {t("Cancel")}
            </button>
          </header>
          {formError && (
            <p
              className="create-purchase-alert warehouses-form-alert"
              role="alert"
            >
              {t(formError)}
            </p>
          )}
          <WarehouseEditor
            form={form}
            fields={formFields}
            mode="create"
            isSaving={isSaving}
            translate={t}
            onChange={setField}
            onCancel={closeForm}
            onSubmit={(event) => void submitForm(event)}
          />
        </section>
      )}

      <section className="purchases-panel" aria-label={t("Warehouse list")}>
        <div className="warehouses-toolbar">
          <label className="warehouses-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => updateFilter(setSearch, event.target.value)}
              placeholder={t("Search name or location")}
              aria-label={t("Search warehouses by name or location")}
            />
          </label>
          <label className="warehouses-status-filter">
            <span>{t("Status")}</span>
            <select
              value={statusFilter}
              onChange={(event) =>
                updateFilter(setStatusFilter, event.target.value)
              }
              aria-label={t("Filter warehouses by status")}
            >
              <option value="all">{t("All statuses")}</option>
              <option value="true">{t("Active")}</option>
              <option value="false">{t("Inactive")}</option>
            </select>
          </label>
          <button
            className="overview-refresh"
            type="button"
            onClick={() => setListRetry((current) => current + 1)}
            disabled={isLoading}
            aria-label={t("Refresh warehouses")}
          >
            <RefreshCw
              size={16}
              className={isLoading ? "overview-refresh__spinning" : ""}
              aria-hidden="true"
            />
            <span>{t("Refresh")}</span>
          </button>
        </div>

        {isLoading ? (
          <div className="purchases-state" role="status">
            <span className="loading-spinner" /> {t("Loading warehouses…")}
          </div>
        ) : listError ? (
          <div className="purchases-state purchases-state--error" role="alert">
            <AlertCircle size={20} aria-hidden="true" />
            <span>{t(listError)}</span>
            <button
              type="button"
              className="purchases-retry"
              onClick={() => setListRetry((current) => current + 1)}
            >
              {t("Try again")}
            </button>
          </div>
        ) : warehouses && warehouses.data.length === 0 ? (
          <div className="purchases-state purchases-state--empty">
            <span className="purchases-empty-mark">
              <Eye size={21} aria-hidden="true" />
            </span>
            <strong>
              {debouncedSearch || statusFilter !== "all"
                ? t("No warehouses match these filters")
                : t("No warehouses yet")}
            </strong>
            <span>
              {debouncedSearch || statusFilter !== "all"
                ? t("Adjust the search or status filter and try again.")
                : t("Create a warehouse to see it listed here.")}
            </span>
          </div>
        ) : warehouses ? (
          <>
            <div className="purchases-table-scroll">
              <table className="purchases-table warehouses-table">
                <thead>
                  <tr>
                    <th>{t("Name")}</th>
                    <th>{t("Location")}</th>
                    <th>{t("Balance Records")}</th>
                    <th>{t("Status")}</th>
                    <th>{t("Actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {warehouses.data.map((warehouse) => (
                    <tr key={warehouse.id}>
                      <td data-label={t("Name")}>
                        <strong className="purchases-number">
                          {warehouse.name}
                        </strong>
                      </td>
                      <td data-label={t("Location")}>
                        {warehouse.location ? (
                          <span className="warehouse-location">
                            <MapPin size={14} aria-hidden="true" />
                            {warehouse.location}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td data-label={t("Balance Records")}>
                        {new Intl.NumberFormat().format(
                          warehouse.inventoryBalanceRecords,
                        )}
                      </td>
                      <td data-label={t("Status")}>
                        <span
                          className={`product-status ${warehouse.isActive ? "product-status--active" : "product-status--inactive"}`}
                        >
                          {t(warehouse.isActive ? "Active" : "Inactive")}
                        </span>
                      </td>
                      <td data-label={t("Actions")}>
                        <button
                          className="purchase-view-button"
                          type="button"
                          onClick={() => openDetails(warehouse.id)}
                          aria-label={`${t("Details")}: ${warehouse.name}`}
                        >
                          <Eye size={15} aria-hidden="true" />
                          <span>{t("Details")}</span>
                        </button>
                        <button
                          className={`warehouse-status-action ${warehouse.isActive ? "warehouse-status-action--deactivate" : "warehouse-status-action--activate"}`}
                          type="button"
                          onClick={() => void changeWarehouseStatus(warehouse, !warehouse.isActive)}
                          disabled={isChangingStatus}
                        >
                          {isChangingStatus
                            ? t(warehouse.isActive ? "Deactivating…" : "Activating…")
                            : t(warehouse.isActive ? "Deactivate" : "Activate")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="purchases-pagination">
              <span>
                {t("Showing")} {startRecord}–{endRecord} {t("of")}{" "}
                {new Intl.NumberFormat().format(warehouses.total)}{" "}
                {t("warehouses")}
              </span>
              <div className="purchases-pagination__controls">
                <button
                  type="button"
                  onClick={() => setPage(warehouses.currentPage - 1)}
                  disabled={isLoading || warehouses.currentPage <= 1}
                  aria-label={t("Previous page")}
                >
                  <ChevronLeft size={16} aria-hidden="true" /> {t("Previous")}
                </button>
                <span>
                  {t("Page")} <strong>{warehouses.currentPage}</strong>{" "}
                  {t("of")}{" "}
                  <strong>{warehouses.lastPage}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setPage(warehouses.currentPage + 1)}
                  disabled={
                    isLoading || warehouses.currentPage >= warehouses.lastPage
                  }
                  aria-label={t("Next page")}
                >
                  {t("Next")} <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            </footer>
          </>
        ) : null}
      </section>

      {selectedWarehouseId !== null && (
        <div className="purchase-modal-backdrop">
          <section
            className="purchase-modal warehouse-details-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="warehouse-detail-title"
          >
            <header className="purchase-modal__header">
              <div>
                <p className="overview-eyebrow">{t("WAREHOUSE DETAILS")}</p>
                <h2 id="warehouse-detail-title">
                  {warehouseDetails?.name ?? t("Warehouse")}
                </h2>
                {warehouseDetails && (
                  <p>
                    {t("Warehouse")} #{warehouseDetails.id}
                  </p>
                )}
              </div>
            </header>
            <div className="purchase-modal__body">
              {formMode === "edit" ? (
                <>
                  {formError && (
                    <p
                      className="create-purchase-alert warehouses-form-alert"
                      role="alert"
                    >
                      {t(formError)}
                    </p>
                  )}
                  <WarehouseEditor
                    form={form}
                    fields={formFields}
                    mode="edit"
                    isSaving={isSaving}
                    translate={t}
                    onChange={setField}
                    onCancel={closeDetails}
                    onSubmit={(event) => void submitForm(event)}
                  />
                </>
              ) : isDetailLoading ? (
                <div className="purchases-state" role="status">
                  <span className="loading-spinner" />{" "}
                  {t("Loading warehouse details…")}
                </div>
              ) : detailError && !warehouseDetails ? (
                <div
                  className="purchases-state purchases-state--error"
                  role="alert"
                >
                  <AlertCircle size={20} aria-hidden="true" />
                  <span>{t(detailError)}</span>
                  <button
                    type="button"
                    className="purchases-retry"
                    onClick={() => setDetailRetry((current) => current + 1)}
                  >
                    {t("Try again")}
                  </button>
                </div>
              ) : warehouseDetails ? (
                <>
                  {success && (
                    <p
                      className="purchase-success-message warehouses-success"
                      role="status"
                    >
                      {t(success)}
                    </p>
                  )}
                  {detailError && (
                    <p className="form-alert form-alert--error" role="alert">
                      {t(detailError)}
                    </p>
                  )}
                  <dl className="purchase-detail-grid warehouse-detail-grid">
                    <div>
                      <dt>{t("Name")}</dt>
                      <dd>{warehouseDetails.name}</dd>
                    </div>
                    <div>
                      <dt>{t("Location")}</dt>
                      <dd>
                        {warehouseDetails.location ? (
                          <span className="warehouse-location">
                            <MapPin size={14} aria-hidden="true" />
                            {warehouseDetails.location}
                          </span>
                        ) : (
                          "—"
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("Balance Records")}</dt>
                      <dd>
                        {new Intl.NumberFormat().format(
                          warehouseDetails.inventoryBalanceRecords,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("Status")}</dt>
                      <dd>
                        <span
                          className={`product-status ${warehouseDetails.isActive ? "product-status--active" : "product-status--inactive"}`}
                        >
                          {t(warehouseDetails.isActive ? "Active" : "Inactive")}
                        </span>
                      </dd>
                    </div>
                  </dl>
                  <div className="warehouse-detail-description">
                    <strong>{t("Description")}</strong>
                    <p>{warehouseDetails.description || "—"}</p>
                  </div>
                  <div className="warehouse-detail-actions">
                    <button
                      className="purchase-view-button"
                      type="button"
                      onClick={() => openEditForm(warehouseDetails)}
                    >
                      <Pencil size={15} aria-hidden="true" />{" "}
                      {t("Edit Warehouse")}
                    </button>
                    <button
                      className={`warehouse-status-action ${warehouseDetails.isActive ? "warehouse-status-action--deactivate" : "warehouse-status-action--activate"}`}
                      type="button"
                      onClick={() =>
                        void changeWarehouseStatus(warehouseDetails, !warehouseDetails.isActive)
                      }
                      disabled={isChangingStatus}
                    >
                      <Power size={15} aria-hidden="true" />
                      {isChangingStatus
                        ? t("Updating status…")
                        : t(
                            warehouseDetails.isActive
                              ? "Deactivate"
                              : "Activate",
                          )}
                    </button>
                  </div>
                </>
              ) : null}
            </div>
            {formMode !== "edit" && (
              <footer className="warehouse-modal-footer">
                <button
                  className="purchase-cancel-button"
                  type="button"
                  onClick={closeDetails}
                >
                  {t("Cancel")}
                </button>
              </footer>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
