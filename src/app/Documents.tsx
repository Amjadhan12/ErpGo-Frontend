import { useEffect, useState, type FormEvent } from "react";
import axios from "axios";
import { Download, Eye, FileText, LoaderCircle, RefreshCw, Search, Trash2, Upload, X } from "lucide-react";
import { api } from "@/lib/api";
import { getErrorMessage, getValidationResult, isRecord, optionalText, parseId, parseLaravelPage, type LaravelPage } from "@/app/InventoryShared";

interface DocumentRecord {
  id: number;
  title: string;
  description: string | null;
  category: string | null;
  originalName: string;
  mimeType: string;
  fileSize: number;
  uploader: string | null;
  createdAt: string;
}

const allowedExtensions = new Set(["pdf", "jpg", "jpeg", "png", "doc", "docx", "xlsx"]);
const maxFileSize = 10 * 1024 * 1024;

function parseDocument(value: unknown): DocumentRecord {
  if (!isRecord(value) || typeof value.title !== "string" || typeof value.original_name !== "string" || typeof value.created_at !== "string") {
    throw new Error("The document response contains an incomplete record.");
  }
  return {
    id: parseId(value.id, "document ID"),
    title: value.title,
    description: optionalText(value.description),
    category: optionalText(value.category),
    originalName: value.original_name,
    mimeType: typeof value.mime_type === "string" ? value.mime_type : "",
    fileSize: typeof value.file_size === "number" ? value.file_size : Number(value.file_size) || 0,
    uploader: isRecord(value.uploader) ? optionalText(value.uploader.name) : null,
    createdAt: value.created_at,
  };
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

async function getDownloadError(error: unknown): Promise<string> {
  if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
    try {
      const parsed: unknown = JSON.parse(await error.response.data.text());
      if (isRecord(parsed) && typeof parsed.message === "string") return parsed.message;
    } catch {
      // Use the normal API error below when the response is not JSON.
    }
  }
  return getErrorMessage(error);
}

function filenameFromHeader(header: unknown, fallback: string): string {
  if (typeof header !== "string") return fallback;
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded.replaceAll('"', "")); } catch { /* use basic filename */ }
  }
  return header.match(/filename="?([^";]+)"?/i)?.[1] ?? fallback;
}

export default function Documents() {
  const [page, setPage] = useState<LaravelPage<DocumentRecord> | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [searchDraft, setSearchDraft] = useState("");
  const [categoryDraft, setCategoryDraft] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [uploadCategory, setUploadCategory] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocumentRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setListError(null);
    void api.get<unknown>("/api/documents", {
      params: { page: pageNumber, per_page: 20, search: search || undefined, category: category || undefined },
      signal: controller.signal,
    }).then(({ data }) => setPage(parseLaravelPage(data, parseDocument)))
      .catch((error: unknown) => { if (!controller.signal.aborted) { setPage(null); setListError(getErrorMessage(error)); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [pageNumber, search, category, reload]);

  async function submitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploading) return;
    const errors: Record<string, string> = {};
    if (!title.trim()) errors.title = "Enter a document title.";
    if (!file) errors.file = "Choose a file to upload.";
    else {
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!allowedExtensions.has(extension)) errors.file = "Choose a PDF, JPG, JPEG, PNG, DOC, DOCX, or XLSX file.";
      else if (file.size > maxFileSize) errors.file = "The file must be 10MB or smaller.";
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length) { setFormError("Review the highlighted fields."); return; }

    const payload = new FormData();
    payload.append("title", title.trim());
    if (description.trim()) payload.append("description", description.trim());
    if (uploadCategory.trim()) payload.append("category", uploadCategory.trim());
    if (file) payload.append("file", file);
    setUploading(true); setFormError(null); setSuccess(null);
    try {
      await api.post("/api/documents", payload);
      setTitle(""); setDescription(""); setUploadCategory(""); setFile(null); setFieldErrors({});
      const fileInput = document.getElementById("document-file") as HTMLInputElement | null;
      if (fileInput) fileInput.value = "";
      setSuccess("Document uploaded successfully.");
      setPageNumber(1); setSearch(""); setSearchDraft(""); setCategory(""); setCategoryDraft("");
      setReload((value) => value + 1);
    } catch (error: unknown) {
      const result = getValidationResult(error);
      setFieldErrors(result.fields);
      setFormError(Object.values(result.fields)[0] || result.message);
    } finally { setUploading(false); }
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPageNumber(1); setSearch(searchDraft.trim()); setCategory(categoryDraft.trim());
  }

  async function viewDocument(id: number) {
    setDetail(null); setDetailError(null); setDetailLoading(true);
    try {
      const { data } = await api.get<unknown>(`/api/documents/${id}`);
      if (!isRecord(data) || !isRecord(data.data)) throw new Error("The document details response is incomplete.");
      setDetail(parseDocument(data.data));
    } catch (error: unknown) { setDetailError(getErrorMessage(error)); }
    finally { setDetailLoading(false); }
  }

  async function downloadDocument(document: DocumentRecord) {
    setBusyId(document.id); setActionError(null);
    try {
      const response = await api.get<Blob>(`/api/documents/${document.id}/download`, { responseType: "blob" });
      const blobUrl = URL.createObjectURL(response.data);
      const anchor = window.document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = filenameFromHeader(response.headers["content-disposition"], document.originalName);
      window.document.body.appendChild(anchor); anchor.click(); anchor.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (error: unknown) { setActionError(await getDownloadError(error)); }
    finally { setBusyId(null); }
  }

  async function deleteDocument(document: DocumentRecord) {
    if (!window.confirm(`Delete “${document.title}” and its uploaded file? This cannot be undone.`)) return;
    setBusyId(document.id); setActionError(null);
    try {
      await api.delete(`/api/documents/${document.id}`);
      setSuccess("Document deleted successfully.");
      if (detail?.id === document.id) setDetail(null);
      if (page?.data.length === 1 && pageNumber > 1) setPageNumber((value) => value - 1);
      else setReload((value) => value + 1);
    } catch (error: unknown) { setActionError(getErrorMessage(error)); }
    finally { setBusyId(null); }
  }

  return (
    <div className="documents-page">
      <header className="documents-heading">
        <div><p className="overview-eyebrow">WORKSPACE</p><h1>Documents</h1><p>Store and manage your business files securely.</p></div>
        <button className="overview-refresh" type="button" onClick={() => setReload((value) => value + 1)} disabled={loading}><RefreshCw size={16} />Refresh</button>
      </header>

      {success && <div className="documents-notice" role="status"><span>{success}</span><button type="button" aria-label="Dismiss message" onClick={() => setSuccess(null)}><X size={16} /></button></div>}
      {actionError && <div className="documents-notice documents-notice--error" role="alert"><span>{actionError}</span><button type="button" aria-label="Dismiss error" onClick={() => setActionError(null)}><X size={16} /></button></div>}

      <section className="documents-panel documents-upload-panel">
        <div className="documents-panel-heading"><span className="documents-icon"><Upload size={18} /></span><div><h2>Upload a document</h2><p>PDF, JPG, PNG, DOC, DOCX, or XLSX · Maximum 10MB</p></div></div>
        <form onSubmit={(event) => void submitUpload(event)} noValidate>
          {formError && <p className="documents-form-error" role="alert">{formError}</p>}
          <div className="documents-upload-grid">
            <label className="documents-field"><span>Title <b>*</b></span><input value={title} maxLength={255} onChange={(event) => setTitle(event.target.value)} aria-invalid={!!fieldErrors.title} />{fieldErrors.title && <small>{fieldErrors.title}</small>}</label>
            <label className="documents-field"><span>Category</span><input value={uploadCategory} maxLength={100} placeholder="e.g. Contracts" onChange={(event) => setUploadCategory(event.target.value)} aria-invalid={!!fieldErrors.category} />{fieldErrors.category && <small>{fieldErrors.category}</small>}</label>
            <label className="documents-field documents-field--wide"><span>Description</span><textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} aria-invalid={!!fieldErrors.description} />{fieldErrors.description && <small>{fieldErrors.description}</small>}</label>
            <label className="documents-field documents-field--wide"><span>File <b>*</b></span><input id="document-file" type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xlsx" onChange={(event) => setFile(event.target.files?.[0] ?? null)} aria-invalid={!!fieldErrors.file} />{file && <em>{file.name} · {formatSize(file.size)}</em>}{fieldErrors.file && <small>{fieldErrors.file}</small>}</label>
          </div>
          <div className="documents-form-actions"><button className="documents-primary-button" type="submit" disabled={uploading}>{uploading ? <LoaderCircle className="documents-spin" size={16} /> : <Upload size={16} />}{uploading ? "Uploading…" : "Upload document"}</button></div>
        </form>
      </section>

      <section className="documents-panel">
        <div className="documents-panel-heading documents-list-heading"><span className="documents-icon"><FileText size={18} /></span><div><h2>Document library</h2><p>{page ? `${page.total.toLocaleString()} document${page.total === 1 ? "" : "s"}` : "Browse uploaded files"}</p></div></div>
        <form className="documents-filters" onSubmit={applyFilters}>
          <label><span className="sr-only">Search documents</span><Search size={16} /><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search title, description, category, or filename" /></label>
          <label className="documents-category-filter"><span className="sr-only">Filter category</span><input value={categoryDraft} onChange={(event) => setCategoryDraft(event.target.value)} placeholder="Exact category" /></label>
          <button type="submit" className="documents-filter-button">Search</button>
        </form>
        {listError && <div className="documents-state documents-state--error" role="alert">{listError}<button type="button" onClick={() => setReload((value) => value + 1)}>Try again</button></div>}
        {loading && <div className="documents-state" role="status"><LoaderCircle className="documents-spin" size={18} />Loading documents…</div>}
        {!loading && !listError && page?.data.length === 0 && <div className="documents-state"><FileText size={24} /><strong>No documents found</strong><span>Upload a file or adjust your search filters.</span></div>}
        {!loading && !listError && page && page.data.length > 0 && <>
          <div className="documents-table-wrap"><table className="documents-table"><thead><tr><th>Document</th><th>Category</th><th>File size</th><th>Uploaded</th><th>Uploader</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{page.data.map((document) => <tr key={document.id}>
            <td><div className="documents-file-cell"><span className="documents-file-icon"><FileText size={17} /></span><span><strong>{document.title}</strong><small>{document.originalName}</small></span></div></td>
            <td>{document.category ? <span className="documents-category-chip">{document.category}</span> : <span className="documents-muted">—</span>}</td><td className="documents-nowrap">{formatSize(document.fileSize)}</td><td className="documents-nowrap">{formatDate(document.createdAt)}</td><td>{document.uploader ?? <span className="documents-muted">—</span>}</td>
            <td><div className="documents-row-actions"><button type="button" title="View metadata" aria-label={`View ${document.title}`} onClick={() => void viewDocument(document.id)}><Eye size={16} /></button><button type="button" title="Download file" aria-label={`Download ${document.title}`} disabled={busyId === document.id} onClick={() => void downloadDocument(document)}>{busyId === document.id ? <LoaderCircle className="documents-spin" size={16} /> : <Download size={16} />}</button><button type="button" className="documents-delete-action" title="Delete document" aria-label={`Delete ${document.title}`} disabled={busyId === document.id} onClick={() => void deleteDocument(document)}><Trash2 size={16} /></button></div></td>
          </tr>)}</tbody></table></div>
          <div className="documents-pagination"><span>Page {page.currentPage} of {page.lastPage} · {page.total.toLocaleString()} total</span><div><button type="button" disabled={pageNumber <= 1 || loading} onClick={() => setPageNumber((value) => value - 1)}>Previous</button><button type="button" disabled={pageNumber >= page.lastPage || loading} onClick={() => setPageNumber((value) => value + 1)}>Next</button></div></div>
        </>}
      </section>

      {(detailLoading || detailError || detail) && <div className="documents-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setDetail(null); setDetailError(null); } }}><section className="documents-modal" role="dialog" aria-modal="true" aria-labelledby="documents-detail-title"><header><div><p className="overview-eyebrow">DOCUMENT DETAILS</p><h2 id="documents-detail-title">{detail?.title ?? "Document details"}</h2></div><button type="button" aria-label="Close details" onClick={() => { setDetail(null); setDetailError(null); }}><X size={18} /></button></header>{detailLoading ? <div className="documents-state"><LoaderCircle className="documents-spin" size={18} />Loading details…</div> : detailError ? <div className="documents-state documents-state--error" role="alert">{detailError}</div> : detail && <div className="documents-detail-grid"><Detail label="Original filename" value={detail.originalName} /><Detail label="Category" value={detail.category ?? "—"} /><Detail label="File size" value={formatSize(detail.fileSize)} /><Detail label="File type" value={detail.mimeType || "—"} /><Detail label="Uploaded" value={formatDate(detail.createdAt)} /><Detail label="Uploader" value={detail.uploader ?? "—"} /><Detail label="Description" value={detail.description ?? "—"} wide /></div>}</section></div>}
    </div>
  );
}

function Detail({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return <div className={wide ? "documents-detail documents-detail--wide" : "documents-detail"}><span>{label}</span><strong>{value}</strong></div>;
}
