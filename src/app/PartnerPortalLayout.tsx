import { useState } from "react";
import { Building2, LogOut, MessageCircle, UserRound } from "lucide-react";
import { Navigate, NavLink, Outlet } from "react-router-dom";
import { portalPaths, useAuth, type UserRole } from "@/auth/AuthContext";
import PartnerPortalPage from "@/app/PartnerPortal";
import SupplierChat from "@/app/SupplierChat";
import CustomerChat from "@/app/CustomerChat";
import { LanguageSwitcher, useLocale } from "@/lib/locale";

type PortalRole = Extract<UserRole, "Customer" | "Supplier">;

function PartnerPortalLayout({ role }: { role: PortalRole }) {
  const { t } = useLocale();
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

  return <div className="partner-portal-shell">
    <header className="partner-portal-header"><div className="partner-portal-brand"><span className="partner-portal-brand-icon"><Building2 size={20} /></span><span><strong>ERPGO</strong><small>{t(role === "Customer" ? "Customer portal" : "Supplier portal")}</small></span></div><nav className="partner-portal-nav" aria-label={t(`${role} portal navigation`)}><NavLink to={role === "Customer" ? "/customer" : "/supplier"} end><UserRound size={15} /> {t("Account")}</NavLink>{role === "Customer" && <NavLink to="/customer/chat"><MessageCircle size={15} /> {t("Chat")}</NavLink>}{role === "Supplier" && <NavLink to="/supplier/chat"><MessageCircle size={15} /> {t("Chat")}</NavLink>}</nav><div className="partner-portal-user"><LanguageSwitcher /><span>{user.name}</span><button type="button" onClick={() => void handleSignOut()} disabled={signingOut}><LogOut size={15} />{t(signingOut ? "Signing out…" : "Sign out")}</button></div></header>
    <Outlet />
    <footer className="partner-portal-footer">{t(role === "Customer" ? "ERPGO · Customer account" : "ERPGO · Supplier account")}</footer>
  </div>;
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
