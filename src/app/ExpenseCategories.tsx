import { useEffect, useState, type FormEvent } from "react";
import { Check, ChevronLeft, ChevronRight, LoaderCircle, Pencil, Plus, RefreshCw, Tag, X } from "lucide-react";
import { api } from "@/lib/api";
import { getErrorMessage, getValidationResult, isRecord, numberValue, optionalText, parseId, parseLaravelPage, type LaravelPage } from "@/app/InventoryShared";

interface ExpenseCategory {
  id: number;
  name: string;
  details: string | null;
  active: boolean;
  expensesCount: number;
}

function parseCategory(value: unknown): ExpenseCategory {
  if (!isRecord(value) || typeof value.name !== "string") throw new Error("The expense category response contains an incomplete record.");
  return {
    id: parseId(value.id, "expense category ID"),
    name: value.name,
    details: optionalText(value.details),
    active: value.is_active === true,
    expensesCount: numberValue(value.expenses_count ?? 0, "expense count"),
  };
}

export default function ExpenseCategories() {
  const [rows, setRows] = useState<LaravelPage<ExpenseCategory> | null>(null);
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [details, setDetails] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadError(null);
    void api.get<unknown>("/api/expense-categories", { params: { page, per_page: 20 }, signal: controller.signal })
      .then(({ data }) => setRows(parseLaravelPage(data, parseCategory)))
      .catch((error: unknown) => { if (!controller.signal.aborted) { setRows(null); setLoadError(getErrorMessage(error)); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, retry]);

  function resetForm() {
    setFormOpen(false); setEditingId(null); setName(""); setDetails(""); setFieldErrors({}); setFormError(null);
  }

  async function openEdit(id: number) {
    setFormError(null); setFieldErrors({}); setSuccess(null); setSaving(true);
    try {
      const { data } = await api.get<unknown>(`/api/expense-categories/${id}`);
      if (!isRecord(data) || !("data" in data)) throw new Error("The expense category details response is incomplete.");
      const category = parseCategory(data.data);
      setEditingId(category.id); setName(category.name); setDetails(category.details ?? ""); setFormOpen(true);
    } catch (error) { setLoadError(getErrorMessage(error)); }
    finally { setSaving(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return;
    setSaving(true); setFormError(null); setFieldErrors({}); setSuccess(null);
    const payload = { name: name.trim(), details: details.trim() || null };
    try {
      if (editingId === null) await api.post("/api/expense-categories", payload);
      else await api.put(`/api/expense-categories/${editingId}`, payload);
      setSuccess(editingId === null ? "Expense category created." : "Expense category updated.");
      resetForm(); setRetry((value) => value + 1);
    } catch (error) {
      const validation = getValidationResult(error);
      setFieldErrors(validation.fields);
      setFormError(validation.message);
    } finally { setSaving(false); }
  }

  async function toggleActive(category: ExpenseCategory) {
    const nextActive = !category.active;
    if (!nextActive && !window.confirm(`Deactivate “${category.name}”? Existing expenses will remain unchanged.`)) return;
    setStatusUpdating(category.id); setSuccess(null); setLoadError(null);
    try {
      await api.patch(`/api/expense-categories/${category.id}`, { is_active: nextActive });
      setSuccess(`Expense category ${nextActive ? "activated" : "deactivated"}.`);
      setRetry((value) => value + 1);
    } catch (error) { setLoadError(getErrorMessage(error)); }
    finally { setStatusUpdating(null); }
  }

  return (
    <main className="expense-categories-page">
      <header className="expense-categories-heading"><div><p className="overview-eyebrow">OPERATIONS / EXPENSES</p><h1>Expense Categories</h1><p>Organize expense records with active categories.</p></div><button className="expense-categories-primary" onClick={() => { resetForm(); setFormOpen(true); }}><Plus size={17} /> New Category</button></header>
      {success && <div className="expense-categories-notice" role="status">{success}<button aria-label="Dismiss message" onClick={() => setSuccess(null)}><X size={16} /></button></div>}
      {loadError && <div className="expense-categories-notice expense-categories-notice--error" role="alert">{loadError}<button onClick={() => { setLoadError(null); setRetry((value) => value + 1); }}>Retry</button></div>}

      {formOpen && <section className="expense-categories-panel expense-categories-compose"><div className="expense-categories-panel-heading"><div className="expense-categories-icon"><Tag size={18} /></div><div><h2>{editingId === null ? "Create category" : "Edit category"}</h2><p>{editingId === null ? "New categories are active by default." : "Update the category details or status."}</p></div><button className="expense-categories-icon-button" aria-label="Close form" onClick={resetForm}><X size={18} /></button></div>
        <form className="expense-categories-form" onSubmit={(event) => void submit(event)}>
          <label>Category name <b>*</b><input value={name} maxLength={190} required onChange={(event) => setName(event.target.value)} aria-invalid={Boolean(fieldErrors.name)} />{fieldErrors.name && <small>{fieldErrors.name}</small>}</label>
          <label>Details <span>Optional</span><textarea value={details} maxLength={5000} rows={3} onChange={(event) => setDetails(event.target.value)} aria-invalid={Boolean(fieldErrors.details)} />{fieldErrors.details && <small>{fieldErrors.details}</small>}</label>
          {formError && <p className="expense-categories-form-error" role="alert">{formError}</p>}
          <div className="expense-categories-form-actions"><button type="button" className="expense-categories-secondary" onClick={resetForm}>Cancel</button><button type="submit" className="expense-categories-primary" disabled={saving}>{saving && <LoaderCircle className="expense-categories-spin" size={16} />}{saving ? "Saving…" : editingId === null ? "Create Category" : "Save Changes"}</button></div>
        </form>
      </section>}

      <section className="expense-categories-panel"><div className="expense-categories-list-heading"><div className="expense-categories-icon"><Tag size={18} /></div><div><h2>Categories</h2><p>{rows ? `${rows.total} category${rows.total === 1 ? "" : "ies"}` : "Manage expense categories"}</p></div><button className="expense-categories-icon-button" aria-label="Refresh categories" disabled={loading} onClick={() => setRetry((value) => value + 1)}><RefreshCw size={16} /></button></div>
        {loading ? <div className="expense-categories-state"><LoaderCircle className="expense-categories-spin" size={19} /> Loading categories…</div>
          : loadError && !rows ? <div className="expense-categories-state expense-categories-state--error"><strong>Could not load categories</strong><span>{loadError}</span><button onClick={() => setRetry((value) => value + 1)}>Try again</button></div>
          : !rows?.data.length ? <div className="expense-categories-state expense-categories-state--empty"><Tag size={22} /><strong>No expense categories</strong><span>Create a category to use it when recording expenses.</span></div>
          : <><div className="expense-categories-table-wrap"><table className="expense-categories-table"><thead><tr><th>Category</th><th>Details</th><th>Expenses</th><th>Status</th><th>Actions</th></tr></thead><tbody>{rows.data.map((category) => <tr key={category.id}>
            <td><strong>{category.name}</strong></td><td className="expense-categories-details">{category.details || "—"}</td><td>{category.expensesCount}</td><td><span className={`expense-categories-status${category.active ? " is-active" : " is-inactive"}`}>{category.active ? "Active" : "Inactive"}</span></td>
            <td><div className="expense-categories-actions"><button className="expense-categories-edit" onClick={() => void openEdit(category.id)} disabled={saving || statusUpdating !== null}><Pencil size={15} /> Edit</button><button className={`expense-categories-toggle${category.active ? " is-deactivate" : " is-activate"}`} onClick={() => void toggleActive(category)} disabled={statusUpdating !== null || saving}>{statusUpdating === category.id ? <LoaderCircle className="expense-categories-spin" size={15} /> : category.active ? <X size={15} /> : <Check size={15} />}{category.active ? "Deactivate" : "Activate"}</button></div></td>
          </tr>)}</tbody></table></div><footer className="expense-categories-pagination"><span>Showing {Math.min((rows.currentPage - 1) * rows.perPage + 1, rows.total)}–{Math.min(rows.currentPage * rows.perPage, rows.total)} of {rows.total}</span><div><button disabled={rows.currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={15} /> Previous</button><span>Page {rows.currentPage} of {rows.lastPage}</span><button disabled={rows.currentPage >= rows.lastPage} onClick={() => setPage((value) => value + 1)}>Next <ChevronRight size={15} /></button></div></footer></>}
      </section>
    </main>
  );
}
