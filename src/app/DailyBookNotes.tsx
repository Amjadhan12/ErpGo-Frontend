import { useEffect, useState, type FormEvent } from "react";
import { BookOpen, CalendarDays, ChevronLeft, ChevronRight, Eye, LoaderCircle, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { getErrorMessage, getValidationResult, isRecord, optionalText, parseId, parseLaravelPage, todayValue, type LaravelPage } from "@/app/InventoryShared";
import { useLocale } from "@/lib/locale";

interface DailyBookNote {
  id: number;
  title: string | null;
  details: string;
  noteDate: string;
  creator: string | null;
}

function parseNote(value: unknown): DailyBookNote {
  if (!isRecord(value) || typeof value.details !== "string" || typeof value.note_date !== "string") {
    throw new Error("The daily book note response contains an incomplete record.");
  }
  return {
    id: parseId(value.id, "daily book note ID"),
    title: optionalText(value.title),
    details: value.details,
    noteDate: value.note_date.slice(0, 10),
    creator: isRecord(value.creator) ? optionalText(value.creator.name) : null,
  };
}

function displayDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(date);
}

export default function DailyBookNotes() {
  const { direction, t } = useLocale();
  const [rows, setRows] = useState<LaravelPage<DailyBookNote> | null>(null);
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selected, setSelected] = useState<DailyBookNote | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [noteDate, setNoteDate] = useState(todayValue);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const params: Record<string, string | number> = { page, per_page: 15 };
    if (search) params.search = search;
    if (fromDate) params.from_date = fromDate;
    if (toDate) params.to_date = toDate;
    setLoading(true);
    setLoadError(null);
    void api.get<unknown>("/api/daily-book-notes", { params, signal: controller.signal })
      .then(({ data }) => setRows(parseLaravelPage(data, parseNote)))
      .catch((error: unknown) => { if (!controller.signal.aborted) { setRows(null); setLoadError(getErrorMessage(error)); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, retry, search, fromDate, toDate]);

  function resetForm() {
    setFormOpen(false); setEditingId(null); setTitle(""); setDetails(""); setNoteDate(todayValue()); setFieldErrors({}); setFormError(null);
  }

  async function openNote(id: number, edit = false) {
    setSelected(null); setDetailError(null); setDetailLoading(true);
    try {
      const { data } = await api.get<unknown>(`/api/daily-book-notes/${id}`);
      if (!isRecord(data) || !("data" in data)) throw new Error("The note details response is incomplete.");
      const note = parseNote(data.data);
      if (edit) {
        setEditingId(note.id); setTitle(note.title ?? ""); setDetails(note.details); setNoteDate(note.noteDate); setFormError(null); setFieldErrors({}); setFormOpen(true);
      } else setSelected(note);
    } catch (error) { setDetailError(getErrorMessage(error)); }
    finally { setDetailLoading(false); }
  }

  async function saveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setFormError(null); setFieldErrors({}); setSuccess(null);
    const payload = { title: title.trim() || null, details: details.trim(), note_date: noteDate };
    try {
      if (editingId === null) await api.post("/api/daily-book-notes", payload);
      else await api.put(`/api/daily-book-notes/${editingId}`, payload);
      setSuccess(editingId === null ? "Daily book note created." : "Daily book note updated.");
      resetForm(); setSelected(null); setPage(1); setRetry((current) => current + 1);
    } catch (error) {
      const validation = getValidationResult(error); setFieldErrors(validation.fields); setFormError(validation.message);
    } finally { setSaving(false); }
  }

  async function deleteNote(note: DailyBookNote) {
    if (deletingId !== null) return;
    const title = note.title || t("Untitled note");
    if (!window.confirm(t("Delete daily book note “{title}”?").replace("{title}", title))) return;
    setDeletingId(note.id);
    setDeleteError(null);
    setSuccess(null);
    try {
      await api.delete(`/api/daily-book-notes/${note.id}`);
      setSuccess("Daily book note deleted successfully.");
      if (selected?.id === note.id) setSelected(null);
      setPage((current) => rows?.data.length === 1 ? Math.max(1, current - 1) : current);
      setRetry((current) => current + 1);
    } catch (error) {
      setDeleteError(getErrorMessage(error));
    } finally {
      setDeletingId(null);
    }
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPage(1); setSearch(query.trim()); setSuccess(null);
  }

  return (
    <main className="daily-notes-page" dir={direction}>
      <header className="daily-notes-heading">
        <div><p className="overview-eyebrow">{t("SECRETARY / RECORDS")}</p><h1>{t("Daily Book Notes")}</h1><p>{t("Keep a clear record of daily business notes.")}</p></div>
        <button className="daily-notes-primary" onClick={() => { resetForm(); setFormOpen(true); }}><Plus size={17} /> {t("New Note")}</button>
      </header>

      {success && <div className="daily-notes-notice" role="status">{t(success)}<button aria-label={t("Dismiss message")} onClick={() => setSuccess(null)}><X size={16} /></button></div>}
      {deleteError && <div className="daily-notes-form-error" role="alert">{t(deleteError)}<button type="button" onClick={() => setDeleteError(null)}>{t("Dismiss message")}</button></div>}

      {formOpen && <section className="daily-notes-panel daily-notes-compose">
        <div className="daily-notes-panel-heading"><div className="daily-notes-icon"><BookOpen size={18} /></div><div><h2>{t(editingId === null ? "Create note" : "Edit note")}</h2><p>{t("Enter the note details and applicable date.")}</p></div><button className="daily-notes-icon-button" aria-label={t("Close form")} onClick={resetForm}><X size={18} /></button></div>
        <form className="daily-notes-form" onSubmit={(event) => void saveNote(event)}>
          <label>{t("Title")} <span>{t("Optional")}</span><input value={title} maxLength={255} onChange={(event) => setTitle(event.target.value)} aria-invalid={Boolean(fieldErrors.title)} />{fieldErrors.title && <small>{t(fieldErrors.title)}</small>}</label>
          <label>{t("Note date")} <b>*</b><input type="date" value={noteDate} onChange={(event) => setNoteDate(event.target.value)} required aria-invalid={Boolean(fieldErrors.note_date)} />{fieldErrors.note_date && <small>{t(fieldErrors.note_date)}</small>}</label>
          <label className="daily-notes-wide">{t("Details")} <b>*</b><textarea value={details} onChange={(event) => setDetails(event.target.value)} rows={4} required aria-invalid={Boolean(fieldErrors.details)} />{fieldErrors.details && <small>{t(fieldErrors.details)}</small>}</label>
          {formError && <p className="daily-notes-form-error" role="alert">{t(formError)}</p>}
          <div className="daily-notes-form-actions"><button type="button" className="daily-notes-secondary" onClick={resetForm}>{t("Cancel")}</button><button type="submit" className="daily-notes-primary" disabled={saving}>{saving && <LoaderCircle size={16} className="daily-notes-spin" />}{t(saving ? "Saving…" : editingId === null ? "Create Note" : "Save Changes")}</button></div>
        </form>
      </section>}

      <section className="daily-notes-panel">
        <div className="daily-notes-list-heading"><div className="daily-notes-icon"><CalendarDays size={18} /></div><div><h2>{t("Notes")}</h2><p>{rows ? t(rows.total === 1 ? "One record" : "{count} records").replace("{count}", String(rows.total)) : t("Browse and manage daily notes")}</p></div><button className="daily-notes-icon-button" aria-label={t("Refresh notes")} onClick={() => setRetry((current) => current + 1)} disabled={loading}><RefreshCw size={16} /></button></div>
        <form className="daily-notes-filters" onSubmit={applyFilters}>
          <label className="daily-notes-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Search title or details")} aria-label={t("Search title or details")} /></label>
          <label>{t("From")}<input type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); setPage(1); }} /></label>
          <label>{t("To")}<input type="date" value={toDate} onChange={(event) => { setToDate(event.target.value); setPage(1); }} /></label>
          <button className="daily-notes-filter-button" type="submit">{t("Search")}</button>
        </form>
        {loading ? <div className="daily-notes-state"><LoaderCircle className="daily-notes-spin" size={19} /> {t("Loading notes…")}</div>
          : loadError ? <div className="daily-notes-state daily-notes-state-error"><strong>{t("Could not load notes")}</strong><span>{t(loadError)}</span><button onClick={() => setRetry((current) => current + 1)}>{t("Try again")}</button></div>
          : !rows?.data.length ? <div className="daily-notes-state daily-notes-state-empty"><BookOpen size={22} /><strong>{t("No notes found")}</strong><span>{t("Create a note or adjust the search and date filters.")}</span></div>
          : <>
            <div className="daily-notes-table-wrap"><table className="daily-notes-table"><thead><tr><th>{t("Title")}</th><th>{t("Date")}</th><th>{t("Details")}</th><th>{t("Created by")}</th><th>{t("Actions")}</th></tr></thead><tbody>{rows.data.map((note) => <tr key={note.id}>
              <td><strong>{note.title || t("Untitled note")}</strong></td><td>{displayDate(note.noteDate)}</td><td className="daily-notes-preview">{note.details}</td><td>{note.creator || "—"}</td>
              <td><div className="daily-notes-row-actions"><button aria-label={t("View note")} title={t("View note")} onClick={() => void openNote(note.id)}><Eye size={16} /></button><button aria-label={t("Edit note")} title={t("Edit note")} onClick={() => void openNote(note.id, true)}><Pencil size={16} /></button><button className="daily-notes-delete" aria-label={t("Delete note")} title={t("Delete note")} disabled={deletingId !== null} onClick={() => void deleteNote(note)}>{deletingId === note.id ? <LoaderCircle className="daily-notes-spin" size={16} /> : <Trash2 size={16} />}</button></div></td>
            </tr>)}</tbody></table></div>
            <footer className="daily-notes-pagination"><span>{t("Showing {start}–{end} of {total}").replace("{start}", String(Math.min((rows.currentPage - 1) * rows.perPage + 1, rows.total))).replace("{end}", String(Math.min(rows.currentPage * rows.perPage, rows.total))).replace("{total}", String(rows.total))}</span><div><button disabled={rows.currentPage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft size={15} /> {t("Previous")}</button><span>{t("Page")} {rows.currentPage} {t("of")} {rows.lastPage}</span><button disabled={rows.currentPage >= rows.lastPage} onClick={() => setPage((current) => current + 1)}>{t("Next")} <ChevronRight size={15} /></button></div></footer>
          </>}
      </section>

      {(selected || detailLoading || detailError) && <div className="daily-notes-backdrop" role="presentation"><section className="daily-notes-detail" role="dialog" aria-modal="true" aria-labelledby="daily-notes-detail-title"><header><div><p className="overview-eyebrow">{t("NOTE DETAILS")}</p><h2 id="daily-notes-detail-title">{selected?.title || t("Daily book note")}</h2></div><button className="daily-notes-icon-button" aria-label={t("Close details")} onClick={() => { setSelected(null); setDetailError(null); }}><X size={18} /></button></header>{detailLoading ? <div className="daily-notes-state"><LoaderCircle className="daily-notes-spin" size={19} /> {t("Loading note…")}</div> : detailError ? <div className="daily-notes-state daily-notes-state-error">{t(detailError)}</div> : selected && <><div className="daily-notes-meta"><div><small>{t("Note date")}</small><strong>{displayDate(selected.noteDate)}</strong></div><div><small>{t("Created by")}</small><strong>{selected.creator || "—"}</strong></div></div><p className="daily-notes-full-details">{selected.details}</p><footer><button className="daily-notes-secondary" onClick={() => { const note = selected; setSelected(null); setEditingId(note.id); setTitle(note.title ?? ""); setDetails(note.details); setNoteDate(note.noteDate); setFormOpen(true); }}>{t("Edit note")}</button></footer></>}</section></div>}
    </main>
  );
}
