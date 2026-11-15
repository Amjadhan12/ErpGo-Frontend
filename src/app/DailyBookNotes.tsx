import { useEffect, useState, type FormEvent } from "react";
import { BookOpen, CalendarDays, ChevronLeft, ChevronRight, Eye, LoaderCircle, Pencil, Plus, RefreshCw, Search, X } from "lucide-react";
import { api } from "@/lib/api";
import { getErrorMessage, getValidationResult, isRecord, optionalText, parseId, parseLaravelPage, todayValue, type LaravelPage } from "@/app/InventoryShared";

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

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPage(1); setSearch(query.trim()); setSuccess(null);
  }

  return (
    <main className="daily-notes-page">
      <header className="daily-notes-heading">
        <div><p className="overview-eyebrow">SECRETARY / RECORDS</p><h1>Daily Book Notes</h1><p>Keep a clear record of daily business notes.</p></div>
        <button className="daily-notes-primary" onClick={() => { resetForm(); setFormOpen(true); }}><Plus size={17} /> New Note</button>
      </header>

      {success && <div className="daily-notes-notice" role="status">{success}<button aria-label="Dismiss message" onClick={() => setSuccess(null)}><X size={16} /></button></div>}

      {formOpen && <section className="daily-notes-panel daily-notes-compose">
        <div className="daily-notes-panel-heading"><div className="daily-notes-icon"><BookOpen size={18} /></div><div><h2>{editingId === null ? "Create note" : "Edit note"}</h2><p>Enter the note details and applicable date.</p></div><button className="daily-notes-icon-button" aria-label="Close form" onClick={resetForm}><X size={18} /></button></div>
        <form className="daily-notes-form" onSubmit={(event) => void saveNote(event)}>
          <label>Title <span>Optional</span><input value={title} maxLength={255} onChange={(event) => setTitle(event.target.value)} aria-invalid={Boolean(fieldErrors.title)} />{fieldErrors.title && <small>{fieldErrors.title}</small>}</label>
          <label>Note date <b>*</b><input type="date" value={noteDate} onChange={(event) => setNoteDate(event.target.value)} required aria-invalid={Boolean(fieldErrors.note_date)} />{fieldErrors.note_date && <small>{fieldErrors.note_date}</small>}</label>
          <label className="daily-notes-wide">Details <b>*</b><textarea value={details} onChange={(event) => setDetails(event.target.value)} rows={4} required aria-invalid={Boolean(fieldErrors.details)} />{fieldErrors.details && <small>{fieldErrors.details}</small>}</label>
          {formError && <p className="daily-notes-form-error" role="alert">{formError}</p>}
          <div className="daily-notes-form-actions"><button type="button" className="daily-notes-secondary" onClick={resetForm}>Cancel</button><button type="submit" className="daily-notes-primary" disabled={saving}>{saving && <LoaderCircle size={16} className="daily-notes-spin" />}{saving ? "Saving…" : editingId === null ? "Create Note" : "Save Changes"}</button></div>
        </form>
      </section>}

      <section className="daily-notes-panel">
        <div className="daily-notes-list-heading"><div className="daily-notes-icon"><CalendarDays size={18} /></div><div><h2>Notes</h2><p>{rows ? `${rows.total} record${rows.total === 1 ? "" : "s"}` : "Browse and manage daily notes"}</p></div><button className="daily-notes-icon-button" aria-label="Refresh notes" onClick={() => setRetry((current) => current + 1)} disabled={loading}><RefreshCw size={16} /></button></div>
        <form className="daily-notes-filters" onSubmit={applyFilters}>
          <label className="daily-notes-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title or details" aria-label="Search title or details" /></label>
          <label>From<input type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); setPage(1); }} /></label>
          <label>To<input type="date" value={toDate} onChange={(event) => { setToDate(event.target.value); setPage(1); }} /></label>
          <button className="daily-notes-filter-button" type="submit">Search</button>
        </form>
        {loading ? <div className="daily-notes-state"><LoaderCircle className="daily-notes-spin" size={19} /> Loading notes…</div>
          : loadError ? <div className="daily-notes-state daily-notes-state-error"><strong>Could not load notes</strong><span>{loadError}</span><button onClick={() => setRetry((current) => current + 1)}>Try again</button></div>
          : !rows?.data.length ? <div className="daily-notes-state daily-notes-state-empty"><BookOpen size={22} /><strong>No notes found</strong><span>Create a note or adjust the search and date filters.</span></div>
          : <>
            <div className="daily-notes-table-wrap"><table className="daily-notes-table"><thead><tr><th>Title</th><th>Date</th><th>Details</th><th>Created by</th><th>Actions</th></tr></thead><tbody>{rows.data.map((note) => <tr key={note.id}>
              <td><strong>{note.title || "Untitled note"}</strong></td><td>{displayDate(note.noteDate)}</td><td className="daily-notes-preview">{note.details}</td><td>{note.creator || "—"}</td>
              <td><div className="daily-notes-row-actions"><button aria-label="View note" title="View note" onClick={() => void openNote(note.id)}><Eye size={16} /></button><button aria-label="Edit note" title="Edit note" onClick={() => void openNote(note.id, true)}><Pencil size={16} /></button></div></td>
            </tr>)}</tbody></table></div>
            <footer className="daily-notes-pagination"><span>Showing {Math.min((rows.currentPage - 1) * rows.perPage + 1, rows.total)}–{Math.min(rows.currentPage * rows.perPage, rows.total)} of {rows.total}</span><div><button disabled={rows.currentPage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft size={15} /> Previous</button><span>Page {rows.currentPage} of {rows.lastPage}</span><button disabled={rows.currentPage >= rows.lastPage} onClick={() => setPage((current) => current + 1)}>Next <ChevronRight size={15} /></button></div></footer>
          </>}
      </section>

      {(selected || detailLoading || detailError) && <div className="daily-notes-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setSelected(null); setDetailError(null); } }}><section className="daily-notes-detail" role="dialog" aria-modal="true" aria-labelledby="daily-notes-detail-title"><header><div><p className="overview-eyebrow">NOTE DETAILS</p><h2 id="daily-notes-detail-title">{selected?.title || "Daily book note"}</h2></div><button className="daily-notes-icon-button" aria-label="Close details" onClick={() => { setSelected(null); setDetailError(null); }}><X size={18} /></button></header>{detailLoading ? <div className="daily-notes-state"><LoaderCircle className="daily-notes-spin" size={19} /> Loading note…</div> : detailError ? <div className="daily-notes-state daily-notes-state-error">{detailError}</div> : selected && <><div className="daily-notes-meta"><div><small>Note date</small><strong>{displayDate(selected.noteDate)}</strong></div><div><small>Created by</small><strong>{selected.creator || "—"}</strong></div></div><p className="daily-notes-full-details">{selected.details}</p><footer><button className="daily-notes-secondary" onClick={() => { const note = selected; setSelected(null); setEditingId(note.id); setTitle(note.title ?? ""); setDetails(note.details); setNoteDate(note.noteDate); setFormOpen(true); }}>Edit note</button></footer></>}</section></div>}
    </main>
  );
}
