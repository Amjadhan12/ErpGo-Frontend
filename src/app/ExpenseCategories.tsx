import { useEffect, useState, type FormEvent } from "react";
import { Check, ChevronLeft, ChevronRight, LoaderCircle, Pencil, Plus, RefreshCw, Tag, X } from "lucide-react";
import { api } from "@/lib/api";
import { getErrorMessage, getValidationResult, isRecord, numberValue, optionalText, parseId, parseLaravelPage, type LaravelPage } from "@/app/InventoryShared";
import { useLocale } from "@/lib/locale";

interface ExpenseCategory {
  id: number;
  name: string;
  details: string | null;
  active: boolean;
  expensesCount: number;
}

type Translate = (text: string) => string;

function localizeMessage(message: string, t: Translate, language: "en" | "ps"): string {
  const translated = t(message);
  return translated !== message || language === "en"
    ? translated
    : t("The expense category request could not be completed. Please try again.");
}

function localizeValidation(message: string, t: Translate, language: "en" | "ps"): string {
  const translated = t(message);
  if (translated !== message || language === "en") return translated;
  if (/required/i.test(message)) return t("This field is required.");
  if (/max.*characters|too long/i.test(message)) return t("The category name or details exceed the allowed length.");
  if (/already been taken|unique/i.test(message)) return t("A category with this name already exists.");
  return t("Please check this field and try again.");
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
  const { direction, language, t } = useLocale();
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
      .catch((error: unknown) => { if (!controller.signal.aborted) { setRows(null); setLoadError(localizeMessage(getErrorMessage(error), t, language)); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, retry, t, language]);

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
    } catch (error) { setLoadError(localizeMessage(getErrorMessage(error), t, language)); }
    finally { setSaving(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return;
    setSaving(true); setFormError(null); setFieldErrors({}); setSuccess(null);
    const payload = { name: name.trim(), details: details.trim() || null };
    try {
      if (editingId === null) await api.post("/api/expense-categories", payload);
      else await api.put(`/api/expense-categories/${editingId}`, payload);
      setSuccess(t(editingId === null ? "Expense category created." : "Expense category updated."));
      setRetry((value) => value + 1);
    } catch (error) {
      const validation = getValidationResult(error);
      const translatedFields: Record<string, string> = {};
      for (const [field, message] of Object.entries(validation.fields)) {
        translatedFields[field] = localizeValidation(message, t, language);
      }
      setFieldErrors(translatedFields);
      setFormError(Object.values(translatedFields)[0] || localizeMessage(validation.message, t, language));
    } finally { setSaving(false); }
  }

  async function toggleActive(category: ExpenseCategory) {
    const nextActive = !category.active;
    if (!nextActive && !window.confirm(t("Deactivate “{category}”? Existing expenses will remain unchanged.").replace("{category}", category.name))) return;
    setStatusUpdating(category.id); setSuccess(null); setLoadError(null);
    try {
      await api.patch(`/api/expense-categories/${category.id}`, { is_active: nextActive });
      setSuccess(t(nextActive ? "Expense category activated." : "Expense category deactivated."));
      setRetry((value) => value + 1);
    } catch (error) { setLoadError(localizeMessage(getErrorMessage(error), t, language)); }
    finally { setStatusUpdating(null); }
  }

  const numberFormat = new Intl.NumberFormat(language === "ps" ? "ps-AF" : "en-US");
  return (
    <main className="expense-categories-redesign__root" dir={direction} lang={language}>
      <style>{`
        .expense-categories-redesign__root{--ecr-ink:#182431;--ecr-muted:#687786;--ecr-line:#e1e8ed;--ecr-primary:#126c68;--ecr-soft:#f4f8f8;color:var(--ecr-ink);font-family:inherit}
        .expense-categories-redesign__root *{box-sizing:border-box}.expense-categories-redesign__heading{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin:0 0 24px}
        .expense-categories-redesign__eyebrow{margin:0 0 8px;color:var(--ecr-primary);font-size:11px;font-weight:800;letter-spacing:.11em;text-transform:uppercase}
        .expense-categories-redesign__heading h1{margin:0;font-size:clamp(25px,3vw,34px);line-height:1.2}.expense-categories-redesign__heading p:not(.expense-categories-redesign__eyebrow){margin:8px 0 0;color:var(--ecr-muted)}
        .expense-categories-redesign__button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:9px 14px;border:1px solid var(--ecr-line);border-radius:9px;background:#fff;color:var(--ecr-ink);font:inherit;font-weight:700;cursor:pointer}
        .expense-categories-redesign__button--primary{border-color:var(--ecr-primary);background:var(--ecr-primary);color:white}.expense-categories-redesign__button:disabled{opacity:.55;cursor:not-allowed}
        .expense-categories-redesign__notice,.expense-categories-redesign__panel{margin-bottom:18px;border:1px solid var(--ecr-line);border-radius:14px;background:white;box-shadow:0 5px 20px #18243108}
        .expense-categories-redesign__notice{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px}.expense-categories-redesign__notice--success{border-color:#b9ded5;background:#f0faf6;color:#175d4f}.expense-categories-redesign__notice--error,.expense-categories-redesign__error{color:#a53636}
        .expense-categories-redesign__panel-heading{display:flex;align-items:center;gap:13px;padding:18px 20px;border-bottom:1px solid var(--ecr-line)}
        .expense-categories-redesign__panel-heading>div:nth-child(2){flex:1}.expense-categories-redesign__panel-heading h2{margin:0;font-size:18px}.expense-categories-redesign__panel-heading p{margin:5px 0 0;color:var(--ecr-muted);font-size:13px}
        .expense-categories-redesign__icon{display:grid;width:38px;height:38px;flex:none;place-items:center;border-radius:10px;background:#eaf5f3;color:var(--ecr-primary)}
        .expense-categories-redesign__icon-button{display:grid;width:36px;height:36px;flex:none;place-items:center;border:1px solid var(--ecr-line);border-radius:8px;background:white;color:var(--ecr-ink);cursor:pointer}.expense-categories-redesign__icon-button:disabled{opacity:.5}
        .expense-categories-redesign__form{padding:20px}.expense-categories-redesign__form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
        .expense-categories-redesign__field{display:flex;min-width:0;flex-direction:column;gap:7px;font-size:13px;font-weight:700}.expense-categories-redesign__field--wide{grid-column:1/-1}
        .expense-categories-redesign__field input,.expense-categories-redesign__field textarea{width:100%;padding:10px 12px;border:1px solid #d6e0e5;border-radius:8px;background:white;color:var(--ecr-ink);font:inherit;font-weight:400}.expense-categories-redesign__field input{min-height:42px}.expense-categories-redesign__field textarea{resize:vertical}
        .expense-categories-redesign__field input:focus,.expense-categories-redesign__field textarea:focus{outline:2px solid #126c6833;border-color:var(--ecr-primary)}.expense-categories-redesign__field small,.expense-categories-redesign__form-error{color:#a53636;font-size:12px}
        .expense-categories-redesign__optional{color:var(--ecr-muted);font-weight:400}.expense-categories-redesign__form-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}
        .expense-categories-redesign__state{display:flex;align-items:center;gap:10px;padding:22px;color:var(--ecr-muted)}.expense-categories-redesign__state--error,.expense-categories-redesign__state--empty{align-items:flex-start;flex-direction:column}
        .expense-categories-redesign__state strong{color:var(--ecr-ink)}.expense-categories-redesign__spin{animation:ecr-spin 1s linear infinite}@keyframes ecr-spin{to{transform:rotate(360deg)}}
        .expense-categories-redesign__table-scroll{overflow:auto}.expense-categories-redesign__table{width:100%;border-collapse:collapse;text-align:start}.expense-categories-redesign__table th,.expense-categories-redesign__table td{padding:13px 15px;border-bottom:1px solid #edf1f3;text-align:start;vertical-align:middle}
        .expense-categories-redesign__table th{background:#f7f9fa;color:#657481;font-size:11px;letter-spacing:.05em;text-transform:uppercase}.expense-categories-redesign__table tbody tr:last-child td{border-bottom:0}
        .expense-categories-redesign__details{max-width:360px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--ecr-muted)}
        .expense-categories-redesign__status{display:inline-flex;padding:5px 9px;border-radius:99px;font-size:12px;font-weight:700}.expense-categories-redesign__status--active{background:#e8f6ef;color:#187044}.expense-categories-redesign__status--inactive{background:#f0f2f4;color:#687786}
        .expense-categories-redesign__actions{display:flex;flex-wrap:wrap;gap:7px}.expense-categories-redesign__actions button{display:inline-flex;align-items:center;gap:6px;padding:7px 9px;border:1px solid var(--ecr-line);border-radius:7px;background:white;color:var(--ecr-ink);font:inherit;font-size:12px;font-weight:700;cursor:pointer}.expense-categories-redesign__actions button:disabled{opacity:.55;cursor:not-allowed}
        .expense-categories-redesign__actions .expense-categories-redesign__activate{color:#187044}.expense-categories-redesign__actions .expense-categories-redesign__deactivate{color:#a53636}
        .expense-categories-redesign__pagination{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-top:1px solid var(--ecr-line);color:var(--ecr-muted);font-size:13px}
        .expense-categories-redesign__pagination-controls{display:flex;align-items:center;gap:10px}.expense-categories-redesign__pagination-controls button{display:inline-flex;align-items:center;gap:4px;padding:7px 9px;border:1px solid var(--ecr-line);border-radius:7px;background:white;color:var(--ecr-ink);font:inherit;cursor:pointer}.expense-categories-redesign__pagination button:disabled{opacity:.5;cursor:not-allowed}
        @media(max-width:720px){.expense-categories-redesign__heading{align-items:flex-start;flex-direction:column}.expense-categories-redesign__heading>.expense-categories-redesign__button{width:100%}.expense-categories-redesign__form-grid{grid-template-columns:1fr}.expense-categories-redesign__field--wide{grid-column:auto}.expense-categories-redesign__pagination{align-items:flex-start;flex-direction:column}}
      `}</style>
      <header className="expense-categories-redesign__heading">
        <div><p className="expense-categories-redesign__eyebrow">{t("Operations / Expenses")}</p><h1>{t("Expense Categories")}</h1><p>{t("Organize expense records with active categories.")}</p></div>
        <button className="expense-categories-redesign__button expense-categories-redesign__button--primary" type="button" onClick={() => { setEditingId(null); setName(""); setDetails(""); setFieldErrors({}); setFormError(null); setSuccess(null); setFormOpen(true); }} disabled={formOpen}><Plus size={17} aria-hidden="true" />{t("New Category")}</button>
      </header>
      {success && <div className="expense-categories-redesign__notice expense-categories-redesign__notice--success" role="status"><span>{success}</span><button className="expense-categories-redesign__icon-button" aria-label={t("Dismiss message")} type="button" onClick={() => setSuccess(null)}><X size={16} aria-hidden="true" /></button></div>}
      {loadError && <div className="expense-categories-redesign__notice expense-categories-redesign__notice--error" role="alert"><span>{loadError}</span><button className="expense-categories-redesign__button" type="button" onClick={() => { setLoadError(null); setRetry((value) => value + 1); }}>{t("Retry")}</button></div>}

      {formOpen && <section className="expense-categories-redesign__panel" aria-labelledby="expense-category-form-title">
        <header className="expense-categories-redesign__panel-heading"><span className="expense-categories-redesign__icon"><Tag size={18} aria-hidden="true" /></span><div><p className="expense-categories-redesign__eyebrow">{editingId === null ? t("New Category") : t("Edit Category")}</p><h2 id="expense-category-form-title">{editingId === null ? t("Create category") : t("Edit category")}</h2><p>{editingId === null ? t("New categories are active by default.") : t("Update the category details or status.")}</p></div><button className="expense-categories-redesign__icon-button" type="button" aria-label={t("Close form")} onClick={resetForm}><X size={18} aria-hidden="true" /></button></header>
        <form className="expense-categories-redesign__form" onSubmit={(event) => void submit(event)} noValidate>
          <div className="expense-categories-redesign__form-grid">
            <label className="expense-categories-redesign__field"><span>{t("Category name")} <b>*</b></span><input value={name} maxLength={190} required onChange={(event) => setName(event.target.value)} aria-invalid={Boolean(fieldErrors.name)} />{fieldErrors.name && <small>{fieldErrors.name}</small>}</label>
            <label className="expense-categories-redesign__field expense-categories-redesign__field--wide"><span>{t("Details")} <span className="expense-categories-redesign__optional">{t("Optional")}</span></span><textarea value={details} maxLength={5000} rows={4} onChange={(event) => setDetails(event.target.value)} aria-invalid={Boolean(fieldErrors.details)} />{fieldErrors.details && <small>{fieldErrors.details}</small>}</label>
          </div>
          {formError && <p className="expense-categories-redesign__form-error" role="alert">{formError}</p>}
          <div className="expense-categories-redesign__form-actions"><button type="button" className="expense-categories-redesign__button" onClick={resetForm}>{t("Cancel")}</button><button type="submit" className="expense-categories-redesign__button expense-categories-redesign__button--primary" disabled={saving}>{saving && <LoaderCircle className="expense-categories-redesign__spin" size={16} aria-hidden="true" />}{saving ? t("Saving…") : editingId === null ? t("Create Category") : t("Save Changes")}</button></div>
        </form>
      </section>}

      <section className="expense-categories-redesign__panel" aria-label={t("Expense categories")}>
        <header className="expense-categories-redesign__panel-heading"><span className="expense-categories-redesign__icon"><Tag size={18} aria-hidden="true" /></span><div><h2>{t("Categories")}</h2><p>{rows ? `${numberFormat.format(rows.total)} ${t(rows.total === 1 ? "category" : "categories")}` : t("Manage expense categories")}</p></div><button className="expense-categories-redesign__icon-button" type="button" aria-label={t("Refresh categories")} disabled={loading} onClick={() => setRetry((value) => value + 1)}><RefreshCw size={16} aria-hidden="true" /></button></header>
        {loading ? <div className="expense-categories-redesign__state" role="status"><LoaderCircle className="expense-categories-redesign__spin" size={19} aria-hidden="true" />{t("Loading categories…")}</div>
          : loadError && !rows ? <div className="expense-categories-redesign__state expense-categories-redesign__state--error"><strong>{t("Could not load categories")}</strong><span>{loadError}</span><button className="expense-categories-redesign__button" type="button" onClick={() => setRetry((value) => value + 1)}>{t("Try again")}</button></div>
            : !rows?.data.length ? <div className="expense-categories-redesign__state expense-categories-redesign__state--empty"><Tag size={22} aria-hidden="true" /><strong>{t("No expense categories")}</strong><span>{t("Create a category to use it when recording expenses.")}</span></div>
              : <><div className="expense-categories-redesign__table-scroll"><table className="expense-categories-redesign__table"><thead><tr><th>{t("Category")}</th><th>{t("Details")}</th><th>{t("Expenses")}</th><th>{t("Status")}</th><th>{t("Actions")}</th></tr></thead><tbody>{rows.data.map((category) => <tr key={category.id}>
                <td><strong>{category.name}</strong></td><td className="expense-categories-redesign__details">{category.details || "—"}</td><td>{numberFormat.format(category.expensesCount)}</td><td><span className={`expense-categories-redesign__status expense-categories-redesign__status--${category.active ? "active" : "inactive"}`}>{category.active ? t("Active") : t("Inactive")}</span></td>
                <td><div className="expense-categories-redesign__actions"><button type="button" onClick={() => void openEdit(category.id)} disabled={saving || statusUpdating !== null}><Pencil size={15} aria-hidden="true" />{t("Edit")}</button><button type="button" className={category.active ? "expense-categories-redesign__deactivate" : "expense-categories-redesign__activate"} onClick={() => void toggleActive(category)} disabled={statusUpdating !== null || saving}>{statusUpdating === category.id ? <LoaderCircle className="expense-categories-redesign__spin" size={15} aria-hidden="true" /> : category.active ? <X size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}{category.active ? t("Deactivate") : t("Activate")}</button></div></td>
              </tr>)}</tbody></table></div><footer className="expense-categories-redesign__pagination"><span>{t("Showing {from}–{to} of {total}").replace("{from}", numberFormat.format(Math.min((rows.currentPage - 1) * rows.perPage + 1, rows.total))).replace("{to}", numberFormat.format(Math.min(rows.currentPage * rows.perPage, rows.total))).replace("{total}", numberFormat.format(rows.total))}</span><div className="expense-categories-redesign__pagination-controls"><button type="button" disabled={rows.currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={15} aria-hidden="true" />{t("Previous")}</button><span>{t("Page {current} of {total}").replace("{current}", numberFormat.format(rows.currentPage)).replace("{total}", numberFormat.format(rows.lastPage))}</span><button type="button" disabled={rows.currentPage >= rows.lastPage} onClick={() => setPage((value) => value + 1)}>{t("Next")}<ChevronRight size={15} aria-hidden="true" /></button></div></footer></>}
      </section>
    </main>
  );
}
