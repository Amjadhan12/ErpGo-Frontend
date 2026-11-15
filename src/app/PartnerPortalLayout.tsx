import { Navigate, Outlet } from "react-router-dom";
import { portalPaths, useAuth, type UserRole } from "@/auth/AuthContext";
import PartnerPortalPage from "@/app/PartnerPortal";

type PortalRole = Extract<UserRole, "Customer" | "Supplier">;

function PartnerPortalLayout({ role }: { role: PortalRole }) {
  const { user, isCheckingSession } = useAuth();

  if (isCheckingSession) {
    return <div className="partner-portal-route-state" role="status"><span className="loading-spinner" /> Checking your secure session…</div>;
  }
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== role) return <Navigate to={portalPaths[user.role]} replace />;

  return <div className="partner-portal-shell"><Outlet /></div>;
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
