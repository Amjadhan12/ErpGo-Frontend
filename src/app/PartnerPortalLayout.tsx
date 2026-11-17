import { useState } from "react";
import { Building2, LogOut, MessageCircle, UserRound } from "lucide-react";
import { Navigate, NavLink, Outlet } from "react-router-dom";
import { portalPaths, useAuth, type UserRole } from "@/auth/AuthContext";
import PartnerPortalPage from "@/app/PartnerPortal";
import SupplierChat from "@/app/SupplierChat";
import CustomerChat from "@/app/CustomerChat";
import { LanguageSwitcher, useLocale } from "@/lib/locale";
import ChatNotifications, { ChatNotificationsProvider, useChatNotifications } from "@/app/ChatNotifications";

type PortalRole = Extract<UserRole, "Customer" | "Supplier">;

function PartnerPortalLayoutContent({ role }: { role: PortalRole }) {
  const { direction, t } = useLocale();
  const { unreadCount } = useChatNotifications();
  const { user, isCheckingSession, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  if (isCheckingSession) {
    return <div className="partner-portal-route-state" role="status"><span className="loading-spinner" /> {t("Checking your secure session…")}</div>;
  }
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== role) return <Navigate to={portalPaths[user.role]} replace />;

  async function handleSignOut() {
    setSigningOut(true);
    try { await signOut(); } catch { /* The local session is cleared even if logout cannot reach the server. */ }
    finally { setSigningOut(false); }
  }

  return <div className="partner-portal-shell" dir={direction}>
    <header className="partner-portal-header"><div className="partner-portal-brand"><span className="partner-portal-brand-icon"><Building2 size={20} /></span><span><strong>ERPGO</strong><small>{t(role === "Customer" ? "Customer portal" : "Supplier portal")}</small></span></div><nav className="partner-portal-nav" aria-label={t(`${role} portal navigation`)}><NavLink to={role === "Customer" ? "/customer" : "/supplier"} end><UserRound size={15} /> {t("Account")}</NavLink><NavLink to={role === "Customer" ? "/customer/chat" : "/supplier/chat"}><MessageCircle size={15} /> {t("Chat")}{unreadCount !== null && unreadCount > 0 && <span className="partner-portal-chat-badge" aria-label={`${unreadCount} ${t("unread messages")}`}>{unreadCount > 99 ? "99+" : unreadCount}</span>}</NavLink></nav><div className="partner-portal-user"><ChatNotifications /><LanguageSwitcher /><span>{user.name}</span><button type="button" onClick={() => void handleSignOut()} disabled={signingOut}><LogOut size={15} />{t(signingOut ? "Signing out…" : "Sign out")}</button></div></header>
    <Outlet />
    <footer className="partner-portal-footer">{t(role === "Customer" ? "ERPGO · Customer account" : "ERPGO · Supplier account")}</footer>
  </div>;
}

function PartnerPortalLayout({ role }: { role: PortalRole }) {
  return <ChatNotificationsProvider><PartnerPortalLayoutContent role={role} /></ChatNotificationsProvider>;
}

export function CustomerPortalLayout() {
  return <PartnerPortalLayout role="Customer" />;
}

export function SupplierPortalLayout() {
  return <PartnerPortalLayout role="Supplier" />;
}

export function PortalIndex({ role }: { role: PortalRole }) {
  return <PartnerPortalPage role={role} />;
}

export function SupplierChatPage() {
  return <SupplierChat />;
}

export function CustomerChatPage() {
  return <CustomerChat />;
}
