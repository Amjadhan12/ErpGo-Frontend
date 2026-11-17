import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Check, MessageCircle, RefreshCw, Send, Users } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { api } from "@/lib/api";
import { fetchAllPages, getErrorMessage, isRecord, optionalText, parseId } from "@/app/InventoryShared";
import { useLocale } from "@/lib/locale";
import { useSearchParams } from "react-router-dom";
import { useChatNotifications } from "@/app/ChatNotifications";

type Partner = { id: number; name: string; businessName: string | null; email: string | null; phone: string | null; type: "Customer" | "Supplier"; active: boolean };
type ChatMessage = { id: number; businessPartnerId: number; senderId: string; recipientId: string; senderName: string; senderRole: string; message: string; createdAt: string; readAt: string | null };
type PagedMessages = { messages: ChatMessage[]; page: number; lastPage: number };

function parsePartner(value: unknown): Partner {
  if (!isRecord(value) || (value.partner_type !== "Customer" && value.partner_type !== "Supplier") || typeof value.name !== "string") throw new Error("The conversation list contains an incomplete partner.");
  return { id: parseId(value.id, "partner ID"), name: value.name, businessName: optionalText(value.business_name), email: optionalText(value.email), phone: optionalText(value.phone), type: value.partner_type, active: value.is_active === true };
}
function parseMessage(value: unknown): ChatMessage {
  if (!isRecord(value) || typeof value.message !== "string" || !isRecord(value.sender)) throw new Error("The chat message response is incomplete.");
  const senderId = value.sender_id ?? value.sender.id;
  const recipientId = value.recipient_id ?? (isRecord(value.recipient) ? value.recipient.id : undefined);
  if (typeof senderId !== "number" && typeof senderId !== "string") throw new Error("The chat message has no sender ID.");
  if (typeof recipientId !== "number" && typeof recipientId !== "string") throw new Error("The chat message has no recipient ID.");
  return {
    id: parseId(value.id, "message ID"),
    businessPartnerId: parseId(value.business_partner_id, "business partner ID"),
    senderId: String(senderId),
    recipientId: String(recipientId),
    senderName: typeof value.sender.name === "string" ? value.sender.name : "User",
    senderRole: typeof value.sender.role === "string" ? value.sender.role : "",
    message: value.message,
    createdAt: typeof value.created_at === "string" ? value.created_at : "",
    readAt: optionalText(value.read_at),
  };
}
function parseMessages(value: unknown): PagedMessages {
  if (!isRecord(value) || !isRecord(value.data) || !Array.isArray(value.data.data)) throw new Error("The chat messages response is incomplete.");
  const page = value.data;
  const rows = page.data as unknown[];
  return {
    messages: rows.map(parseMessage),
    page: typeof page.current_page === "number" ? page.current_page : 1,
    lastPage: typeof page.last_page === "number" ? page.last_page : 1,
  };
}
function formatMessageDate(value: string, language: "en" | "ps"): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(language === "ps" ? "ps-AF" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

export default function Chat() {
  const { t, language, direction } = useLocale();
  const { user } = useAuth();
  const { unreadCount, error: unreadError, notifications, refresh } = useChatNotifications();
  const [searchParams] = useSearchParams();
  const appliedPartnerQuery = useRef<string | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [notificationPartners, setNotificationPartners] = useState<Partner[]>([]);
  const [partnersLoading, setPartnersLoading] = useState(true);
  const [partnersError, setPartnersError] = useState<string | null>(null);
  const [partnersRetry, setPartnersRetry] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const chatPartners = useMemo(() => {
    const activeIds = new Set(partners.map((partner) => partner.id));
    return [...partners, ...notificationPartners.filter((partner) => !activeIds.has(partner.id))];
  }, [partners, notificationPartners]);
  const selectedPartner = chatPartners.find((partner) => partner.id === selectedId) ?? null;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [threadRetry, setThreadRetry] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const endOfMessagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController(); const signal = controller.signal;
    setPartnersLoading(true); setPartnersError(null);
    void Promise.all([
      fetchAllPages("/api/business-partners", { partner_type: "Customer", per_page: 100 }, parsePartner, signal),
      fetchAllPages("/api/business-partners", { partner_type: "Supplier", per_page: 100 }, parsePartner, signal),
    ]).then(([customers, suppliers]) => setPartners([...customers, ...suppliers].filter((partner) => partner.active).sort((a, b) => a.name.localeCompare(b.name))))
      .catch((error: unknown) => { if (!signal.aborted) setPartnersError(getErrorMessage(error)); })
      .finally(() => { if (!signal.aborted) setPartnersLoading(false); });
    return () => controller.abort();
  }, [partnersRetry]);

  useEffect(() => {
    setNotificationPartners((current) => {
      const byId = new Map(current.map((partner) => [partner.id, partner]));
      for (const notification of notifications) {
        if (notification.partnerType !== "Customer" && notification.partnerType !== "Supplier") continue;
        if (partners.some((partner) => partner.id === notification.businessPartnerId)) continue;
        byId.set(notification.businessPartnerId, {
          id: notification.businessPartnerId,
          name: notification.partnerName,
          businessName: null,
          email: null,
          phone: null,
          type: notification.partnerType,
          active: false,
        });
      }
      return [...byId.values()];
    });
  }, [notifications, partners]);

  useEffect(() => {
    const requestedId = searchParams.get("business_partner_id");
    if (partnersLoading || !requestedId || appliedPartnerQuery.current === requestedId) return;
    const partner = chatPartners.find((item) => item.id === Number(requestedId));
    if (!partner) return;
    appliedPartnerQuery.current = requestedId;
    setSelectedId(partner.id);
    setPage(1);
    setMessages([]);
    setMobileThreadOpen(true);
    setDraft("");
    setSendError(null);
  }, [chatPartners, partnersLoading, searchParams]);

  useEffect(() => {
    if (selectedId === null) { setMessages([]); setLastPage(1); return; }
    const controller = new AbortController(); const signal = controller.signal;
    setMessagesLoading(true); setMessagesError(null); setSendError(null);
    void api.get<unknown>("/api/chat/messages", { params: { business_partner_id: selectedId, per_page: 30, page }, signal })
      .then(async ({ data }) => {
        const result = parseMessages(data);
        const pageRows = result.messages.reverse();
        setMessages((previous) => {
          const merged = page === 1 ? pageRows : [...pageRows, ...previous];
          return [...new Map(merged.map((item) => [item.id, item])).values()].sort((a, b) => a.id - b.id);
        });
        setLastPage(result.lastPage);
        const unreadReceived = pageRows.filter((message) => message.recipientId === String(user?.id) && !message.readAt);
        if (unreadReceived.length > 0) {
          const marked = await Promise.allSettled(unreadReceived.map((message) => api.patch<unknown>(`/api/chat/messages/${message.id}/read`)));
          const markedAt = new Map<number, string>();
          marked.forEach((item, index) => {
            if (item.status === "fulfilled" && isRecord(item.value.data) && isRecord(item.value.data.data) && typeof item.value.data.data.read_at === "string") markedAt.set(unreadReceived[index].id, item.value.data.data.read_at);
          });
          if (markedAt.size) setMessages((current) => current.map((message) => markedAt.has(message.id) ? { ...message, readAt: markedAt.get(message.id) ?? message.readAt } : message));
          window.dispatchEvent(new Event("erpgo:chat-read"));
        }
      })
      .catch((error: unknown) => { if (!signal.aborted) setMessagesError(getErrorMessage(error)); })
      .finally(() => { if (!signal.aborted) setMessagesLoading(false); });
    return () => controller.abort();
  }, [selectedId, page, threadRetry, user?.id]);

  const ownId = String(user?.id ?? "");
  const participantSubtitle = useMemo(() => selectedPartner?.businessName || selectedPartner?.email || selectedPartner?.phone || selectedPartner?.type || "", [selectedPartner]);

  function selectPartner(partner: Partner) {
    setSelectedId(partner.id); setPage(1); setMessages([]); setMobileThreadOpen(true); setDraft(""); setSendError(null);
    if (selectedId === partner.id) setThreadRetry((value) => value + 1);
  }
  function refreshThread() {
    setRefreshing(true); setPage(1); setMessages([]); setThreadRetry((value) => value + 1); setPartnersRetry((value) => value + 1);
    window.setTimeout(() => setRefreshing(false), 400);
  }
  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || !selectedPartner || sending) return;
    setSending(true); setSendError(null);
    try {
      const { data } = await api.post<unknown>("/api/chat/messages", { message, business_partner_id: selectedPartner.id });
      if (!isRecord(data) || !isRecord(data.data)) throw new Error("The server accepted the message but returned incomplete details.");
      const saved = parseMessage(data.data);
      setMessages((current) => [...new Map([...current, saved].map((item) => [item.id, item])).values()].sort((a, b) => a.id - b.id));
      setDraft("");
      setPage(1); setThreadRetry((value) => value + 1);
      window.dispatchEvent(new Event("erpgo:chat-sent"));
    } catch (error) {
      setSendError(getErrorMessage(error));
    } finally { setSending(false); }
  }

  useEffect(() => { endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages]);

  return <div className={`chat-page${mobileThreadOpen ? " chat-page--thread-open" : ""}`} dir={direction}>
    <header className="chat-page-heading"><div><p className="chat-eyebrow">{t("COMMUNICATION")}</p><h1>{t("Chat")}</h1><p>{t("Conversations with customers and suppliers.")}</p></div><button className="chat-refresh-button" type="button" onClick={refreshThread} disabled={refreshing}><RefreshCw size={15} /> {t("Refresh")}</button></header>
    <section className="chat-workspace">
      <aside className="chat-conversations" aria-label={t("Conversations")}><div className="chat-list-header"><div><h2>{t("Conversations")}</h2><span>{partners.length} {t("partners")}</span></div><Users size={18} aria-hidden="true" /></div>
        {partnersLoading ? <div className="chat-list-state" role="status">{t("Loading conversations…")}</div> : partnersError ? <div className="chat-list-state chat-list-state--error" role="alert">{t(partnersError)}<button type="button" onClick={() => setPartnersRetry((value) => value + 1)}>{t("Try again")}</button></div> : partners.length ? <div className="chat-partner-list">{partners.map((partner) => <button type="button" key={partner.id} className={`chat-partner${selectedId === partner.id ? " chat-partner--selected" : ""}`} onClick={() => selectPartner(partner)}><span className={`chat-avatar chat-avatar--${partner.type.toLowerCase()}`}>{initials(partner.name)}</span><span className="chat-partner-copy"><strong>{partner.name}</strong><small>{t(partner.type)}{partner.businessName ? ` · ${partner.businessName}` : ""}</small></span></button>)}</div> : <div className="chat-list-state">{t("No active customer or supplier accounts.")}</div>}
      </aside>
      <section className="chat-thread" aria-label={selectedPartner ? `${t("Conversation with")} ${selectedPartner.name}` : t("Conversation")}>
        {selectedPartner ? <><header className="chat-thread-header"><button className="chat-back-button" type="button" aria-label={t("Back to conversations")} onClick={() => setMobileThreadOpen(false)}><ArrowLeft size={18} /></button><span className={`chat-avatar chat-avatar--${selectedPartner.type.toLowerCase()}`}>{initials(selectedPartner.name)}</span><div className="chat-thread-contact"><strong>{selectedPartner.name}</strong><small>{participantSubtitle}</small></div><div className="chat-thread-status">{unreadError ? <span title={t("Unread message count unavailable")}>{t("Unread unavailable")}</span> : unreadCount !== null ? <span>{unreadCount} {t("unread")}</span> : <span>{t("Loading unread…")}</span>}<button type="button"         aria-label={t("Refresh unread count")} onClick={() => refresh(true)}><RefreshCw size={14} /></button></div></header>
          <div className="chat-messages-area" aria-live="polite">{lastPage > page && <button className="chat-older-button" type="button" disabled={messagesLoading} onClick={() => setPage((value) => value + 1)}>{t("Load older messages")}</button>}{messagesLoading && messages.length === 0 ? <div className="chat-thread-state" role="status">{t("Loading messages…")}</div> : messagesError && messages.length === 0 ? <div className="chat-thread-state chat-thread-state--error" role="alert">{t(messagesError)}<button type="button" onClick={() => setThreadRetry((value) => value + 1)}>{t("Try again")}</button></div> : messages.length ? messages.map((message) => { const sent = message.senderId === ownId; return <article className={`chat-message${sent ? " chat-message--sent" : " chat-message--received"}`} key={message.id}><div className="chat-message-bubble"><p>{message.message}</p><footer><time dateTime={message.createdAt}>{formatMessageDate(message.createdAt, language)}</time>{sent && message.readAt && <span title={t("Read")}><Check size={12} /> {t("Read")}</span>}</footer></div></article>; }) : !messagesLoading && !messagesError ? <div className="chat-thread-state chat-thread-state--empty"><MessageCircle size={28} /><strong>{t("Start the conversation")}</strong><span>{t("Send a message to")} {selectedPartner.name}.</span></div> : null}{messagesError && messages.length > 0 && <div className="chat-load-error" role="alert">{t(messagesError)}<button type="button" onClick={() => setThreadRetry((value) => value + 1)}>{t("Retry")}</button></div>}<div ref={endOfMessagesRef} /></div>
          <form className="chat-composer" onSubmit={submitMessage}><div className="chat-compose-field"><textarea value={draft} maxLength={10000} rows={2} placeholder={t("Write a message…")} aria-label={t("Message text")} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} disabled={sending} /></div>{sendError && <div className="chat-send-error" role="alert">{t(sendError)}</div>}<div className="chat-composer-footer"><span>{t("Enter to send · Shift + Enter for a new line")}</span><button type="submit" disabled={sending || !draft.trim()}><Send size={15} /> {t(sending ? "Sending…" : "Send")}</button></div></form>
        </> : <div className="chat-no-selection"><span><MessageCircle size={28} /></span><strong>{t("Select a conversation")}</strong><p>{t("Choose a customer or supplier to view messages.")}</p></div>}
      </section>
    </section>
  </div>;
}
