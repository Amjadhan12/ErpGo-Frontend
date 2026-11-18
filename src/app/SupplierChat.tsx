import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircle, LoaderCircle, MessageCircle, RefreshCw, Send } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { api } from "@/lib/api";
import { getErrorMessage, isRecord, optionalText, parseId } from "@/app/InventoryShared";
import { useLocale } from "@/lib/locale";

type ChatMessage = { id: number; senderId: string; recipientId: string; senderName: string; senderRole: string; message: string; createdAt: string; readAt: string | null };
type PagedMessages = { messages: ChatMessage[]; page: number; lastPage: number };

function parseMessage(value: unknown): ChatMessage {
  if (!isRecord(value) || typeof value.message !== "string" || !isRecord(value.sender)) throw new Error("The chat message response is incomplete.");
  const senderId = value.sender_id ?? value.sender.id;
  const recipientId = value.recipient_id ?? (isRecord(value.recipient) ? value.recipient.id : undefined);
  if ((typeof senderId !== "number" && typeof senderId !== "string") || (typeof recipientId !== "number" && typeof recipientId !== "string")) throw new Error("The chat message is missing sender or recipient details.");
  return { id: parseId(value.id, "message ID"), senderId: String(senderId), recipientId: String(recipientId), senderName: typeof value.sender.name === "string" ? value.sender.name : "User", senderRole: typeof value.sender.role === "string" ? value.sender.role : "", message: value.message, createdAt: typeof value.created_at === "string" ? value.created_at : "", readAt: optionalText(value.read_at) };
}

function parseMessages(value: unknown): PagedMessages {
  if (!isRecord(value) || !isRecord(value.data) || !Array.isArray(value.data.data)) throw new Error("The chat messages response is incomplete.");
  const pagination = value.data;
  return { messages: (pagination.data as unknown[]).map(parseMessage), page: typeof pagination.current_page === "number" ? pagination.current_page : 1, lastPage: typeof pagination.last_page === "number" ? pagination.last_page : 1 };
}

function timestamp(value: string, language: "en" | "ps"): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(language === "ps" ? "ps-AF" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function SupplierChat() {
  const { t, language } = useLocale();
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    // Supplier identity is derived by the API from the authenticated user; no partner ID is sent.
    void api.get<unknown>("/api/chat/messages", { params: { per_page: 30, page }, signal: controller.signal })
      .then(async ({ data }) => {
        const result = parseMessages(data);
        const pageRows = result.messages.reverse();
        setMessages((previous) => {
          const merged = page === 1 ? pageRows : [...pageRows, ...previous];
          return [...new Map(merged.map((message) => [message.id, message])).values()].sort((a, b) => a.id - b.id);
        });
        setLastPage(result.lastPage);
        const unread = pageRows.filter((message) => message.recipientId === String(user?.id) && !message.readAt);
        if (unread.length) {
          const results = await Promise.allSettled(unread.map((message) => api.patch<unknown>(`/api/chat/messages/${message.id}/read`, undefined, { signal: controller.signal })));
          const marked = new Map<number, string>();
          results.forEach((result, index) => {
            if (result.status === "fulfilled" && isRecord(result.value.data) && isRecord(result.value.data.data) && typeof result.value.data.data.read_at === "string") marked.set(unread[index].id, result.value.data.data.read_at);
          });
          if (marked.size && !controller.signal.aborted) {
            setMessages((current) => current.map((message) => marked.has(message.id) ? { ...message, readAt: marked.get(message.id) ?? message.readAt } : message));
            window.dispatchEvent(new Event("erpgo:chat-read"));
          }
        }
      })
      .catch((requestError: unknown) => { if (!controller.signal.aborted) setError(getErrorMessage(requestError)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, retry, user?.id]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true); setSendError(null);
    try {
      // business_partner_id is prohibited for Supplier role; the backend binds this to the session's partner.
      const { data } = await api.post<unknown>("/api/chat/messages", { message });
      if (!isRecord(data) || !isRecord(data.data)) throw new Error("The server returned incomplete sent message details.");
      const saved = parseMessage(data.data);
      setMessages((current) => [...new Map([...current, saved].map((item) => [item.id, item])).values()].sort((a, b) => a.id - b.id));
      setDraft(""); setPage(1); setRetry((value) => value + 1);
      window.dispatchEvent(new Event("erpgo:chat-sent"));
    } catch (requestError: unknown) { setSendError(getErrorMessage(requestError)); }
    finally { setSending(false); }
  }

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages]);
  const ownMessageCount = messages.filter((message) => message.senderId === String(user?.id)).length;
  const secretaryMessageCount = messages.filter((message) => message.senderId !== String(user?.id)).length;

  return <main className="supplier-chat-page">
    <header className="supplier-chat-heading"><div><p className="overview-eyebrow">{t("SUPPLIER PORTAL")}</p><h1>{t("Chat with Secretary")}</h1><p>{t("Messages between your account and the ERPGO Secretary.")}</p></div><button type="button" className="partner-portal-refresh" onClick={() => { setMessages([]); setPage(1); setRetry((value) => value + 1); }} disabled={loading}><RefreshCw size={15} /> {t("Refresh")}</button></header>
    <section className="supplier-chat-card" aria-label={t("Conversation with Secretary")}>
      <header className="supplier-chat-contact"><span><MessageCircle size={19} /></span><div><strong>{t("Secretary")}</strong><small>{t("ERPGO support")}</small></div></header>
      <div className="supplier-chat-counts" aria-label={t("Message counts")}><span>{t("You")}: <strong>{ownMessageCount}</strong></span><span>{t("Secretary")}: <strong>{secretaryMessageCount}</strong></span></div>
      <div className="supplier-chat-messages" aria-live="polite">
        {lastPage > page && <button className="supplier-chat-older" type="button" disabled={loading} onClick={() => setPage((value) => value + 1)}>{t("Load older messages")}</button>}
        {loading && messages.length === 0 ? <div className="supplier-chat-state" role="status"><LoaderCircle className="partner-portal-spin" size={18} /> {t("Loading messages…")}</div>
          : error && messages.length === 0 ? <div className="supplier-chat-state supplier-chat-state--error" role="alert"><AlertCircle size={17} />{t(error)}<button type="button" onClick={() => setRetry((value) => value + 1)}>{t("Try again")}</button></div>
            : messages.length === 0 ? <div className="supplier-chat-state supplier-chat-state--empty"><MessageCircle size={26} /><strong>{t("No messages yet")}</strong><span>{t("Send a message to start your conversation.")}</span></div>
              : messages.map((message) => {
                const sent = message.senderId === String(user?.id);
                return <article key={message.id} className={`supplier-chat-message${sent ? " supplier-chat-message--sent" : " supplier-chat-message--received"}`}>
                  <div className="supplier-chat-message-meta"><strong>{sent ? t("You") : message.senderName}</strong>{!sent && message.senderRole && <span>{message.senderRole}</span>}</div>
                  <div className="supplier-chat-bubble"><p>{message.message}</p><time dateTime={message.createdAt}>{timestamp(message.createdAt, language)}</time></div>
                </article>;
              })}
        {error && messages.length > 0 && <div className="supplier-chat-inline-error" role="alert">{t(error)}<button type="button" onClick={() => setRetry((value) => value + 1)}>{t("Retry")}</button></div>}
        <div ref={endRef} />
      </div>
      <form className="supplier-chat-composer" onSubmit={(event) => void sendMessage(event)}><textarea value={draft} rows={2} maxLength={10000} aria-label={t("Message to Secretary")} placeholder={t("Write a message…")} disabled={sending} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />{sendError && <p role="alert">{t(sendError)}</p>}<footer><span>{t("Enter to send · Shift + Enter for a new line")}</span><button type="submit" disabled={sending || !draft.trim()}><Send size={15} /> {t(sending ? "Sending…" : "Send")}</button></footer></form>
    </section>
  </main>;
}
