import { useEffect, useState, type FormEvent } from "react";
import axios from "axios";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Eye,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import PartnerStatement from "./PartnerStatement";

interface Customer {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  businessName: string | null;
  taxNumber: string | null;
  notes: string | null;
  isActive: boolean;
}

interface CustomerPage {
  data: Customer[];
  currentPage: number;
  lastPage: number;
  perPage: number;
  total: number;
}

interface CustomerForm {
  name: string;
  email: string;
  password: string;
  passwordConfirmation: string;
  phone: string;
  address: string;
  businessName: string;
  taxNumber: string;
  notes: string;
}

type FieldErrors = Record<string, string>;

const emptyForm: CustomerForm = {
  name: "",
  email: "",
  password: "",
  passwordConfirmation: "",
  phone: "",
  address: "",
  businessName: "",
  taxNumber: "",
  notes: "",
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
    throw new Error("The server returned an invalid customer ID.");
  return parsed;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function parseCustomer(value: unknown): Customer {
  if (
    !isRecord(value) ||
    value.partner_type !== "Customer" ||
    typeof value.name !== "string" ||
    typeof value.is_active !== "boolean"
  ) {
    throw new Error("The server returned an incomplete customer record.");
  }

  return {
    id: parseId(value.id),
    name: value.name,
    phone: optionalText(value.phone),
    email: optionalText(value.email),
    address: optionalText(value.address),
    businessName: optionalText(value.business_name),
    taxNumber: optionalText(value.tax_number),
    notes: optionalText(value.notes),
    isActive: value.is_active,
  };
}

function parseCustomerPage(value: unknown): CustomerPage {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !Array.isArray(value.data.data) ||
    !Number.isInteger(value.data.current_page) ||
    !Number.isInteger(value.data.last_page) ||
    !Number.isInteger(value.data.per_page) ||
    !Number.isInteger(value.data.total)
  ) {
    throw new Error("The customer list did not contain valid pagination data.");
  }

  return {
    data: value.data.data.map(parseCustomer),
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
    : "The customer request could not be completed.";
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
  const fieldMap: Record<string, string> = {
    business_name: "businessName",
    password_confirmation: "passwordConfirmation",
    tax_number: "taxNumber",
  };
  const fields: FieldErrors = {};
  if (isRecord(body.errors)) {
    for (const [field, messages] of Object.entries(body.errors)) {
      if (Array.isArray(messages) && typeof messages[0] === "string") {
        fields[fieldMap[field] ?? field] = messages[0];
      }
    }
  }
  return { fields, message };
}

export default function Customers() {
  const { t } = useLocale();
  const [customers, setCustomers] = useState<CustomerPage | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [listRetry, setListRetry] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [form, setForm] = useState<CustomerForm>(emptyForm);
  const [formFields, setFormFields] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(
    null,
  );
  const [customerDetails, setCustomerDetails] = useState<Customer | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRetry, setDetailRetry] = useState(0);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isPartnerActionProcessing, setIsPartnerActionProcessing] = useState(false);
  const [partnerActionError, setPartnerActionError] = useState<string | null>(null);

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
      .get<unknown>("/api/business-partners", {
        params: {
          partner_type: "Customer",
          search: debouncedSearch || undefined,
          page,
        },
        signal: controller.signal,
      })
      .then(({ data }) => {
        setCustomers(parseCustomerPage(data));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setCustomers(null);
          setListError(getErrorMessage(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [debouncedSearch, page, listRetry]);

  useEffect(() => {
    if (selectedCustomerId === null) return;
    const controller = new AbortController();
    setIsDetailLoading(true);
    setDetailError(null);
    setCustomerDetails(null);
    api
      .get<unknown>(`/api/business-partners/${selectedCustomerId}`, {
        signal: controller.signal,
      })
      .then(({ data }) => {
        if (!isRecord(data) || !("data" in data))
          throw new Error("The customer details response was incomplete.");
        setCustomerDetails(parseCustomer(data.data));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setDetailError(getErrorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsDetailLoading(false);
      });
    return () => controller.abort();
  }, [selectedCustomerId, detailRetry]);

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

  function openEditForm(customer: Customer) {
    setForm({
      ...emptyForm,
      name: customer.name,
      email: customer.email ?? "",
      phone: customer.phone ?? "",
      address: customer.address ?? "",
      businessName: customer.businessName ?? "",
      taxNumber: customer.taxNumber ?? "",
      notes: customer.notes ?? "",
    });
    setFormFields({});
    setFormError(null);
    setSelectedCustomerId(null);
    setFormMode("edit");
  }

  function closeForm() {
    if (isSaving) return;
    setFormMode(null);
    setForm(emptyForm);
    setFormFields({});
    setFormError(null);
  }

  function setField(field: keyof CustomerForm, value: string) {
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
    if (!form.name.trim()) fields.name = "Enter a customer name.";
    if (formMode === "create" && !form.email.trim())
      fields.email = "Enter an email address.";
    if (formMode === "create" && form.password.length < 8)
      fields.password = "Password must be at least 8 characters.";
    if (formMode === "create" && form.password !== form.passwordConfirmation) {
      fields.passwordConfirmation = "Password confirmation must match.";
    }
    setFormFields(fields);
    if (Object.keys(fields).length) {
      setFormError("Check the highlighted fields.");
      return;
    }

    setIsSaving(true);
    setFormError(null);
    try {
      if (formMode === "create") {
        await api.post("/api/business-partners", {
          partner_type: "Customer",
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
          password_confirmation: form.passwordConfirmation,
          phone: form.phone.trim() || null,
          address: form.address.trim() || null,
          business_name: form.businessName.trim() || null,
          tax_number: form.taxNumber.trim() || null,
          notes: form.notes.trim() || null,
        });
        setSuccess("Customer created successfully.");
      } else {
        const customer = customerDetailsForEdit();
        await api.patch(`/api/business-partners/${customer.id}`, {
          name: form.name.trim(),
          phone: form.phone.trim() || null,
          address: form.address.trim() || null,
          business_name: form.businessName.trim() || null,
          tax_number: form.taxNumber.trim() || null,
          notes: form.notes.trim() || null,
        });
        setSuccess("Customer updated successfully.");
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

  function customerDetailsForEdit(): Customer {
    if (!customerDetails)
      throw new Error("Customer details are not available for editing.");
    return customerDetails;
  }

  async function toggleCustomerStatus(customer: Customer) {
    if (isPartnerActionProcessing) return;
    setIsPartnerActionProcessing(true);
    setPartnerActionError(null);
    try {
      await api.patch(`/api/business-partners/${customer.id}`, {
        is_active: !customer.isActive,
      });
      setSuccess(
        customer.isActive
          ? "Customer deactivated successfully."
          : "Customer activated successfully.",
      );
      setDetailRetry((current) => current + 1);
      setListRetry((current) => current + 1);
    } catch (error: unknown) {
      setPartnerActionError(getErrorMessage(error));
    } finally {
      setIsPartnerActionProcessing(false);
    }
  }

  async function deleteCustomer(customer: Customer) {
    if (isPartnerActionProcessing) return;
    const confirmed = window.confirm(
      `${t("Delete customer")} "${customer.name}"?\n\n${t("This partner will be archived from the active list. Historical financial records will be preserved.")}`,
    );
    if (!confirmed) return;

    setIsPartnerActionProcessing(true);
    setPartnerActionError(null);
    try {
      await api.delete(`/api/business-partners/${customer.id}`);
      setSuccess("Customer deleted successfully.");
      setSelectedCustomerId(null);
      setPage(1);
      setListRetry((current) => current + 1);
    } catch (error: unknown) {
      setPartnerActionError(getErrorMessage(error));
    } finally {
      setIsPartnerActionProcessing(false);
    }
  }

  const startRecord =
    customers && customers.total > 0
      ? (customers.currentPage - 1) * customers.perPage + 1
      : 0;
  const endRecord = customers
    ? Math.min(
        (customers.currentPage - 1) * customers.perPage + customers.data.length,
        customers.total,
      )
    : 0;

  return (
    <div className="purchases-page customers-page">
      <header className="purchases-heading">
        <div>
          <p className="overview-eyebrow">{t("PARTNERS")}</p>
          <h1>{t("Customers")}</h1>
          <p className="overview-heading__description">
            {t("Manage customer contact details and accounts.")}
          </p>
        </div>
        <button
          className="purchase-create-button"
          type="button"
          onClick={openCreateForm}
          disabled={formMode !== null}
        >
          <Plus size={16} aria-hidden="true" />
          <span>{t("New Customer")}</span>
        </button>
      </header>

      {success && (
        <p className="purchase-success-message customers-success" role="status">
          {t(success)}
        </p>
      )}

      {formMode && (
        <section
          className="purchases-panel customers-form-panel"
          aria-labelledby="customer-form-title"
        >
          <header className="customers-form-heading">
            <h2 id="customer-form-title">
              {formMode === "create" ? t("Create Customer") : t("Edit Customer")}
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
              className="create-purchase-alert customers-form-alert"
              role="alert"
            >
              {t(formError)}
            </p>
          )}
          <form
            className="customers-form"
            onSubmit={(event) => void submitForm(event)}
            noValidate
          >
            <label className="purchase-field">
              <span>
                {t("Name")} <i>*</i>
              </span>
              <input
                value={form.name}
                onChange={(event) => setField("name", event.target.value)}
                maxLength={255}
                aria-invalid={Boolean(formFields.name)}
              />
              {formFields.name && (
                <small className="purchase-field__error">
                  {t(formFields.name)}
                </small>
              )}
            </label>

            {formMode === "create" ? (
              <label className="purchase-field">
                <span>
                  {t("Email")} <i>*</i>
                </span>
                <input
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(event) => setField("email", event.target.value)}
                  maxLength={255}
                  aria-invalid={Boolean(formFields.email)}
                />
                {formFields.email && (
                  <small className="purchase-field__error">
                    {t(formFields.email)}
                  </small>
                )}
              </label>
            ) : (
              <label className="purchase-field">
                <span>{t("Email")}</span>
                <input
                  type="email"
                  value={form.email}
                  disabled
                  aria-label={t("Customer login email, read only")}
                />
              </label>
            )}

            {formMode === "create" && (
              <>
                <label className="purchase-field">
                  <span>
                    {t("Password")} <i>*</i>
                  </span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={form.password}
                    onChange={(event) =>
                      setField("password", event.target.value)
                    }
                    minLength={8}
                    aria-invalid={Boolean(formFields.password)}
                  />
                  {formFields.password && (
                    <small className="purchase-field__error">
                      {t(formFields.password)}
                    </small>
                  )}
                </label>
                <label className="purchase-field">
                  <span>
                    {t("Confirm Password")} <i>*</i>
                  </span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={form.passwordConfirmation}
                    onChange={(event) =>
                      setField("passwordConfirmation", event.target.value)
                    }
                    aria-invalid={Boolean(formFields.passwordConfirmation)}
                  />
                  {formFields.passwordConfirmation && (
                    <small className="purchase-field__error">
                      {t(formFields.passwordConfirmation)}
                    </small>
                  )}
                </label>
              </>
            )}

            <label className="purchase-field">
              <span>{t("Phone")}</span>
              <input
                value={form.phone}
                onChange={(event) => setField("phone", event.target.value)}
                maxLength={30}
                aria-invalid={Boolean(formFields.phone)}
              />
              {formFields.phone && (
                <small className="purchase-field__error">
                  {t(formFields.phone)}
                </small>
              )}
            </label>
            <label className="purchase-field">
              <span>{t("Business Name")}</span>
              <input
                value={form.businessName}
                onChange={(event) =>
                  setField("businessName", event.target.value)
                }
                maxLength={255}
                aria-invalid={Boolean(formFields.businessName)}
              />
              {formFields.businessName && (
                <small className="purchase-field__error">
                  {t(formFields.businessName)}
                </small>
              )}
            </label>
            <label className="purchase-field">
              <span>{t("Address")}</span>
              <input
                value={form.address}
                onChange={(event) => setField("address", event.target.value)}
                maxLength={255}
                aria-invalid={Boolean(formFields.address)}
              />
              {formFields.address && (
                <small className="purchase-field__error">
                  {t(formFields.address)}
                </small>
              )}
            </label>
            <label className="purchase-field">
              <span>{t("Tax Number")}</span>
              <input
                value={form.taxNumber}
                onChange={(event) => setField("taxNumber", event.target.value)}
                maxLength={255}
                aria-invalid={Boolean(formFields.taxNumber)}
              />
              {formFields.taxNumber && (
                <small className="purchase-field__error">
                  {t(formFields.taxNumber)}
                </small>
              )}
            </label>
            <label className="purchase-field customers-form-wide">
              <span>{t("Notes")}</span>
              <textarea
                rows={3}
                maxLength={5000}
                value={form.notes}
                onChange={(event) => setField("notes", event.target.value)}
                aria-invalid={Boolean(formFields.notes)}
              />
              {formFields.notes && (
                <small className="purchase-field__error">
                  {t(formFields.notes)}
                </small>
              )}
            </label>
            <div className="customers-form-actions">
              <button
                type="button"
                className="purchase-cancel-button"
                onClick={closeForm}
                disabled={isSaving}
              >
                {t("Cancel")}
              </button>
              <button
                type="submit"
                className="purchase-save-button"
                disabled={isSaving}
              >
                {isSaving
                  ? t("Saving…")
                  : formMode === "create"
                    ? t("Create Customer")
                    : t("Save Changes")}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="purchases-panel" aria-label={t("Customer list")}>
        <div className="customers-toolbar">
          <label className="customers-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder={t("Search name, phone, or business")}
              aria-label={t("Search customers by name, phone, or business name")}
            />
          </label>
          <button
            className="overview-refresh"
            type="button"
            onClick={() => setListRetry((current) => current + 1)}
            disabled={isLoading}
            aria-label={t("Refresh customers")}
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
            <span className="loading-spinner" /> {t("Loading customers…")}
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
        ) : customers && customers.data.length === 0 ? (
          <div className="purchases-state purchases-state--empty">
            <span className="purchases-empty-mark">
              <Eye size={21} aria-hidden="true" />
            </span>
            <strong>
              {debouncedSearch
                ? t("No customers match your search")
                : t("No customers yet")}
            </strong>
            <span>
              {debouncedSearch
                ? t("Try another name, phone number, or business name.")
                : t("Create a customer to see it listed here.")}
            </span>
          </div>
        ) : customers ? (
          <>
            <div className="purchases-table-scroll">
              <table className="purchases-table customers-table">
                <thead>
                  <tr>
                    <th>{t("Name")}</th>
                    <th>{t("Business Name")}</th>
                    <th>{t("Phone")}</th>
                    <th>{t("Email")}</th>
                    <th>{t("Account Status")}</th>
                    <th>{t("Actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.data.map((customer) => (
                    <tr key={customer.id}>
                      <td data-label={t("Name")}>
                        <strong className="purchases-number">
                          {customer.name}
                        </strong>
                      </td>
                      <td data-label={t("Business Name")}>{customer.businessName || "—"}</td>
                      <td data-label={t("Phone")}>{customer.phone || "—"}</td>
                      <td data-label={t("Email")} dir="ltr">{customer.email || "—"}</td>
                      <td data-label={t("Account Status")}>
                        <span className={`partner-status-badge ${customer.isActive ? "is-active" : "is-inactive"}`}>
                          {t(customer.isActive ? "Active" : "Inactive")}
                        </span>
                      </td>
                      <td data-label={t("Actions")}>
                        <button
                          className="purchase-view-button"
                          type="button"
                          onClick={() => setSelectedCustomerId(customer.id)}
                          aria-label={`${t("View customer")} ${customer.name}`}
                        >
                          <Eye size={15} aria-hidden="true" />
                          <span>{t("Details")}</span>
                        </button>
                        <button
                          className="partner-table-edit"
                          type="button"
                          onClick={() => openEditForm(customer)}
                          aria-label={`${t("Edit Customer")} ${customer.name}`}
                        >
                          <Pencil size={15} aria-hidden="true" />
                          <span>{t("Edit")}</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="purchases-pagination">
              <span className="partner-pagination-count">
                {t("Showing")} {startRecord}–{endRecord} {t("of")}{" "}
                {new Intl.NumberFormat().format(customers.total)} {t("customers")}
              </span>
              <div className="purchases-pagination__controls">
                <button
                  type="button"
                  onClick={() => setPage(customers.currentPage - 1)}
                  disabled={isLoading || customers.currentPage <= 1}
                  aria-label={t("Previous page")}
                >
                  <ChevronLeft size={16} aria-hidden="true" /> {t("Previous")}
                </button>
                <span>
                  {t("Page")} <strong>{customers.currentPage}</strong> {t("of")}{" "}
                  <strong>{customers.lastPage}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setPage(customers.currentPage + 1)}
                  disabled={
                    isLoading || customers.currentPage >= customers.lastPage
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

      {selectedCustomerId !== null && (
        <div
          className="purchase-modal-backdrop partner-detail-backdrop"
        >
          <section
            className="purchase-modal customer-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-detail-title"
          >
            <header className="purchase-modal__header">
              <div>
                <p className="overview-eyebrow">{t("CUSTOMER DETAILS")}</p>
                <h2 id="customer-detail-title">
                  {customerDetails?.name ?? t("Customer")}
                </h2>
                {customerDetails && (
                  <p className="partner-detail-id" dir="ltr">
                    {t("Customer")} #{customerDetails.id}
                    <span className={`partner-status-badge ${customerDetails.isActive ? "is-active" : "is-inactive"}`}>
                      {t(customerDetails.isActive ? "Active" : "Inactive")}
                    </span>
                  </p>
                )}
              </div>
              <button
                type="button"
                className="purchase-modal__close"
                onClick={() => setSelectedCustomerId(null)}
                aria-label={t("Close details")}
              >
                <X size={19} aria-hidden="true" />
              </button>
            </header>
            <div className="purchase-modal__body">
              {isDetailLoading ? (
                <div className="purchases-state" role="status">
                  <span className="loading-spinner" /> {t("Loading customer details…")}
                </div>
              ) : detailError ? (
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
              ) : customerDetails ? (
                <>
                  <PartnerStatement partnerId={customerDetails.id} partnerType="Customer">
                  <div className="partner-detail-contact">
                    <span><strong>{t("Phone")}</strong> {customerDetails.phone || "—"}</span>
                    <span dir="ltr"><strong>{t("Email")}</strong> {customerDetails.email || "—"}</span>
                    <span><strong>{t("Address")}</strong> {customerDetails.address || "—"}</span>
                  </div>
                  {partnerActionError && (
                    <p className="partner-action-feedback is-error" role="alert">
                      {t(partnerActionError)}
                    </p>
                  )}
                  {success && (
                    <p className="partner-action-feedback is-success" role="status">
                      {t(success)}
                    </p>
                  )}
                  <div className="partner-profile-sections">
                    <section className="partner-profile-section">
                      <h3>{t("Personal / Partner Information")}</h3>
                      <dl className="purchase-detail-grid customer-detail-grid">
                        <div><dt>{t("Name")}</dt><dd>{customerDetails.name}</dd></div>
                        <div><dt>{t("Partner ID")}</dt><dd dir="ltr">#{customerDetails.id}</dd></div>
                        <div><dt>{t("Account Status")}</dt><dd>{t(customerDetails.isActive ? "Active" : "Inactive")}</dd></div>
                      </dl>
                    </section>
                    <section className="partner-profile-section">
                      <h3>{t("Business Information")}</h3>
                      <dl className="purchase-detail-grid customer-detail-grid">
                        <div><dt>{t("Business Name")}</dt><dd>{customerDetails.businessName || "—"}</dd></div>
                      </dl>
                    </section>
                    <section className="partner-profile-section">
                      <h3>{t("Contact Information")}</h3>
                      <dl className="purchase-detail-grid customer-detail-grid">
                        <div><dt>{t("Phone")}</dt><dd dir="ltr">{customerDetails.phone || "—"}</dd></div>
                        <div><dt>{t("Email")}</dt><dd dir="ltr">{customerDetails.email || "—"}</dd></div>
                        <div><dt>{t("Address")}</dt><dd>{customerDetails.address || "—"}</dd></div>
                      </dl>
                    </section>
                    <section className="partner-profile-section">
                      <h3>{t("Tax Information")}</h3>
                      <dl className="purchase-detail-grid customer-detail-grid">
                        <div><dt>{t("Tax Number")}</dt><dd dir="ltr">{customerDetails.taxNumber || "—"}</dd></div>
                      </dl>
                    </section>
                    <section className="partner-profile-section">
                      <h3>{t("Notes")}</h3>
                      <p className="partner-detail-notes">{customerDetails.notes || "—"}</p>
                    </section>
                  </div>
                  </PartnerStatement>
                  <div className="customer-detail-actions partner-detail-actions">
                    <button
                      className="purchase-save-button"
                      type="button"
                      onClick={() => openEditForm(customerDetails)}
                      disabled={isPartnerActionProcessing}
                    >
                      <Pencil size={15} aria-hidden="true" /> {t("Edit Customer")}
                    </button>
                    <button
                      className="partner-toggle-button"
                      type="button"
                      onClick={() => void toggleCustomerStatus(customerDetails)}
                      disabled={isPartnerActionProcessing}
                    >
                      <Power size={15} aria-hidden="true" />
                      {t(customerDetails.isActive ? "Deactivate" : "Activate")}
                    </button>
                    <button
                      className="partner-delete-button"
                      type="button"
                      onClick={() => void deleteCustomer(customerDetails)}
                      disabled={isPartnerActionProcessing}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                      {t("Delete")}
                    </button>
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
