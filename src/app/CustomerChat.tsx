import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircle, LoaderCircle, MessageCircle, RefreshCw, Send } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { api } from "@/lib/api";
import { getErrorMessage, isRecord, optionalText, parseId } from "@/app/InventoryShared";

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

function timestamp(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function CustomerChat() {
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
    // Customer identity is derived by the API from the authenticated user; no partner ID is sent.
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
          if (marked.size && !controller.signal.aborted) setMessages((current) => current.map((message) => marked.has(message.id) ? { ...message, readAt: marked.get(message.id) ?? message.readAt } : message));
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
      // business_partner_id is prohibited for Customer role; the backend binds the message to this account.
      const { data } = await api.post<unknown>("/api/chat/messages", { message });
      if (!isRecord(data) || !isRecord(data.data)) throw new Error("The server returned incomplete sent message details.");
      const saved = parseMessage(data.data);
      setMessages((current) => [...new Map([...current, saved].map((item) => [item.id, item])).values()].sort((a, b) => a.id - b.id));
      setDraft(""); setPage(1); setRetry((value) => value + 1);
    } catch (requestError: unknown) { setSendError(getErrorMessage(requestError)); }
    finally { setSending(false); }
  }

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages]);

  return <main className="supplier-chat-page">
    <header className="supplier-chat-heading"><div><p className="overview-eyebrow">CUSTOMER PORTAL</p><h1>Chat with Secretary</h1><p>Messages between your account and the ERPGO Secretary.</p></div><button type="button" className="partner-portal-refresh" onClick={() => { setMessages([]); setPage(1); setRetry((value) => value + 1); }} disabled={loading}><RefreshCw size={15} /> Refresh</button></header>
    <section className="supplier-chat-card" aria-label="Conversation with Secretary">
      <header className="supplier-chat-contact"><span><MessageCircle size={19} /></span><div><strong>Secretary</strong><small>ERPGO support</small></div></header>
      <div className="supplier-chat-messages" aria-live="polite">
        {lastPage > page && <button className="supplier-chat-older" type="button" disabled={loading} onClick={() => setPage((value) => value + 1)}>Load older messages</button>}
        {loading && messages.length === 0 ? <div className="supplier-chat-state" role="status"><LoaderCircle className="partner-portal-spin" size={18} /> Loading messages…</div>
          : error && messages.length === 0 ? <div className="supplier-chat-state supplier-chat-state--error" role="alert"><AlertCircle size={17} />{error}<button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div>
            : messages.length === 0 ? <div className="supplier-chat-state supplier-chat-state--empty"><MessageCircle size={26} /><strong>No messages yet</strong><span>Send a message to start your conversation.</span></div>
              : messages.map((message) => {
                const sent = message.senderId === String(user?.id);
                return <article key={message.id} className={`supplier-chat-message${sent ? " supplier-chat-message--sent" : " supplier-chat-message--received"}`}>
                  <div className="supplier-chat-message-meta"><strong>{sent ? "You" : message.senderName}</strong>{!sent && message.senderRole && <span>{message.senderRole}</span>}</div>
                  <div className="supplier-chat-bubble"><p>{message.message}</p><time dateTime={message.createdAt}>{timestamp(message.createdAt)}</time></div>
                </article>;
              })}
        {error && messages.length > 0 && <div className="supplier-chat-inline-error" role="alert">{error}<button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}
        <div ref={endRef} />
      </div>
      <form className="supplier-chat-composer" onSubmit={(event) => void sendMessage(event)}><textarea value={draft} rows={2} maxLength={10000} aria-label="Message to Secretary" placeholder="Write a message…" disabled={sending} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />{sendError && <p role="alert">{sendError}</p>}<footer><span>Enter to send · Shift + Enter for a new line</span><button type="submit" disabled={sending || !draft.trim()}><Send size={15} />{sending ? "Sending…" : "Send"}</button></footer></form>
    </section>
  </main>;
}

