import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, MessageCircle, RefreshCw, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { getErrorMessage, isRecord, parseId } from "@/app/InventoryShared";

type ChatNotification = {
  id: number;
  businessPartnerId: number;
  partnerName: string;
  partnerType: string;
  senderName: string;
  senderRole: string;
  message: string;
  createdAt: string;
};

type ChatNotificationState = {
  unreadCount: number | null;
  notifications: ChatNotification[];
  loading: boolean;
  error: string | null;
  refresh: (force?: boolean) => void;
};

const ChatNotificationContext = createContext<ChatNotificationState | null>(null);

function parseNotifications(value: unknown): { unreadCount: number; notifications: ChatNotification[] } {
  if (!isRecord(value) || !isRecord(value.data) || typeof value.data.unread_count !== "number" ||
    !Number.isSafeInteger(value.data.unread_count) || value.data.unread_count < 0 || !Array.isArray(value.data.notifications)) {
    throw new Error("The chat notification response is incomplete.");
  }
  const notifications = value.data.notifications.map((row): ChatNotification => {
    if (!isRecord(row) || typeof row.id !== "number" || typeof row.business_partner_id !== "number" ||
      typeof row.partner_name !== "string" || typeof row.partner_type !== "string" ||
      !isRecord(row.sender) || typeof row.sender.name !== "string" ||
      typeof row.sender.role !== "string" || typeof row.message !== "string" || typeof row.created_at !== "string") {
      throw new Error("The chat notification response contains an incomplete message.");
    }
    return {
      id: parseId(row.id, "message ID"),
      businessPartnerId: parseId(row.business_partner_id, "business partner ID"),
      partnerName: row.partner_name,
      partnerType: row.partner_type,
      senderName: row.sender.name,
      senderRole: row.sender.role,
      message: row.message,
      createdAt: row.created_at,
    };
  });
  return { unreadCount: value.data.unread_count, notifications };
}

export function ChatNotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [notifications, setNotifications] = useState<ChatNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestInFlight = useRef(false);
  const requestController = useRef<AbortController | null>(null);
  const refresh = useCallback((force = false) => {
    if (!user || document.visibilityState === "hidden") return;
    if (requestInFlight.current && !force) return;
    if (force) requestController.current?.abort();
    requestInFlight.current = true;
    const controller = new AbortController();
    requestController.current = controller;
    setLoading(true);
    setError(null);
    void api.get<unknown>("/api/chat/notifications", { signal: controller.signal })
      .then(({ data }) => {
        const result = parseNotifications(data);
        setUnreadCount(result.unreadCount);
        setNotifications(result.notifications);
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) setError(getErrorMessage(requestError));
      })
      .finally(() => {
        if (requestController.current === controller) {
          requestController.current = null;
          requestInFlight.current = false;
        }
        if (!controller.signal.aborted) setLoading(false);
      });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const onVisibilityChange = () => { if (document.visibilityState === "visible") refresh(); };
    const onFocus = () => refresh();
    const onChatChanged = () => refresh(true);
    refresh();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 60_000);
    window.addEventListener("focus", onFocus);
    window.addEventListener("erpgo:chat-read", onChatChanged);
    window.addEventListener("erpgo:chat-sent", onChatChanged);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("erpgo:chat-read", onChatChanged);
      window.removeEventListener("erpgo:chat-sent", onChatChanged);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      requestController.current?.abort();
      requestController.current = null;
      requestInFlight.current = false;
    };
  }, [refresh, user]);

  return <ChatNotificationContext.Provider value={{ unreadCount, notifications, loading, error, refresh }}>{children}</ChatNotificationContext.Provider>;
}

export function useChatNotifications(): ChatNotificationState {
  const context = useContext(ChatNotificationContext);
  if (!context) throw new Error("ChatNotificationsProvider is required.");
  return context;
}

function formatTime(value: string, language: "en" | "ps"): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(language === "ps" ? "ps-AF" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function ChatNotifications() {
  const { t, language } = useLocale();
  const { user } = useAuth();
  const { unreadCount, notifications, loading, error, refresh } = useChatNotifications();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  function openConversation(notification: ChatNotification) {
    setOpen(false);
    if (user?.role === "Secretary") {
      navigate(`/secretary/chat?business_partner_id=${notification.businessPartnerId}`);
    } else {
      navigate(user?.role === "Customer" ? "/customer/chat" : "/supplier/chat");
    }
  }

  return <div className="chat-notifications" ref={rootRef}>
    <button className="chat-notifications__trigger" type="button" aria-label={t("Chat notifications")} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((value) => { const next = !value; if (next) refresh(true); return next; })}>
      <Bell size={18} aria-hidden="true" />
      {unreadCount !== null && unreadCount > 0 && <span className="chat-notifications__badge">{unreadCount > 99 ? "99+" : unreadCount}</span>}
      {error && <span className="chat-notifications__error-indicator" aria-hidden="true">!</span>}
    </button>
    {open && <section className="chat-notifications__panel" role="dialog" aria-label={t("Chat notifications")}>
      <header className="chat-notifications__header">
        <div><h2>{t("Messages")}</h2><span>{unreadCount === null ? t("Unread count unavailable") : t("{count} unread").replace("{count}", String(unreadCount))}</span></div>
        <div>
          <button type="button" aria-label={t("Refresh notifications")} onClick={() => refresh()} disabled={loading}><RefreshCw size={16} className={loading ? "chat-notifications__spin" : ""} /></button>
          <button type="button" aria-label={t("Close")} onClick={() => setOpen(false)}><X size={17} /></button>
        </div>
      </header>
      {error ? <div className="chat-notifications__state chat-notifications__state--error" role="alert">{t(error)}<button type="button" onClick={() => refresh()}>{t("Try again")}</button></div>
        : loading && notifications.length === 0 ? <div className="chat-notifications__state" role="status">{t("Loading notifications…")}</div>
          : notifications.length === 0 ? <div className="chat-notifications__state"><MessageCircle size={21} /><strong>{t("No unread messages")}</strong><span>{t("New chat messages will appear here.")}</span></div>
            : <ul className="chat-notifications__list">{notifications.map((notification) => <li key={notification.id}>
              <button type="button" onClick={() => openConversation(notification)}>
                <span className="chat-notifications__avatar"><MessageCircle size={16} /></span>
                <span className="chat-notifications__copy">
                  <strong>{notification.senderName}</strong>
                  <small>{notification.partnerName}{notification.partnerType ? ` · ${t(notification.partnerType)}` : ""}</small>
                  <span>{notification.message}</span>
                  <time dateTime={notification.createdAt}>{formatTime(notification.createdAt, language)}</time>
                </span>
              </button>
            </li>)}</ul>}
      <footer className="chat-notifications__footer">
        <button type="button" onClick={() => { setOpen(false); navigate(user?.role === "Secretary" ? "/secretary/chat" : user?.role === "Customer" ? "/customer/chat" : "/supplier/chat"); }}>{t("Open Chat")}</button>
      </footer>
    </section>}
  </div>;
}
