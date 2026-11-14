import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowDownUp,
  Banknote,
  BarChart3,
  Boxes,
  BriefcaseBusiness,
  Building2,
  ChevronDown,
  CircleHelp,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Package,
  SlidersHorizontal,
  Settings,
  ShoppingCart,
  Truck,
  UsersRound,
  Warehouse,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/auth/AuthContext";

interface MenuItem {
  label: string;
  icon: LucideIcon;
}

interface MenuGroup {
  label: string;
  items: MenuItem[];
}

const menuGroups: MenuGroup[] = [
  {
    label: "Workspace",
    items: [{ label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Partners",
    items: [
      { label: "Customers", icon: UsersRound },
      { label: "Suppliers", icon: Truck },
    ],
  },
  {
    label: "Inventory",
    items: [
      { label: "Products", icon: Package },
      { label: "Warehouses", icon: Warehouse },
      { label: "Inventory", icon: Boxes },
      { label: "Opening Stocks", icon: Boxes },
      { label: "Stock Transfers", icon: ArrowDownUp },
      { label: "Stock Adjustments", icon: SlidersHorizontal },
      { label: "Stock Wastage", icon: BarChart3 },
      { label: "Batch & Expiry", icon: BarChart3 },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Purchases", icon: ShoppingCart },
      { label: "Sales", icon: BriefcaseBusiness },
      { label: "Expenses", icon: Wallet },
    ],
  },
  {
    label: "Finance & tools",
    items: [
      { label: "Financial Accounts", icon: Building2 },
      { label: "Supplier Payments", icon: Banknote },
      { label: "Cash Book", icon: Wallet },
      { label: "Reports", icon: BarChart3 },
      { label: "Chat", icon: MessageCircle },
      { label: "Documents", icon: FileText },
      { label: "Settings", icon: Settings },
    ],
  },
];

const routeByLabel: Record<string, string> = {
  Dashboard: "/secretary",
  Customers: "/secretary/customers",
  Suppliers: "/secretary/suppliers",
  Products: "/secretary/products",
  Warehouses: "/secretary/warehouses",
  Inventory: "/secretary/inventory",
  "Opening Stocks": "/secretary/opening-stocks",
  "Stock Transfers": "/secretary/stock-transfers",
  "Stock Adjustments": "/secretary/stock-adjustments",
  "Stock Wastage": "/secretary/stock-wastage",
  "Batch & Expiry": "/secretary/batch-expiry",
  Purchases: "/secretary/purchases",
  Sales: "/secretary/sales",
  Expenses: "/secretary/expenses",
  "Financial Accounts": "/secretary/financial-accounts",
  "Supplier Payments": "/secretary/supplier-payments",
};

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function SidebarBrand({
  title,
  imageUrl,
}: {
  title?: string;
  imageUrl?: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <div className="secretary-brand">
      <span className="secretary-brand__mark">
        {imageUrl && !imageFailed ? (
          <img src={imageUrl} alt="" onError={() => setImageFailed(true)} />
        ) : (
          <span aria-hidden="true">E</span>
        )}
      </span>
      <span className="secretary-brand__text">
        <strong>{title || "ERPGO"}</strong>
        <small>MANAGEMENT SYSTEM</small>
      </span>
    </div>
  );
}

function SecretarySidebar({
  collapsed,
  mobileOpen,
  onClose,
  title,
  logoUrl,
}: {
  collapsed: boolean;
  mobileOpen: boolean;
  onClose: () => void;
  title?: string;
  logoUrl?: string;
}) {
  const location = useLocation();

  return (
    <>
      {mobileOpen && (
        <button
          className="secretary-overlay"
          type="button"
          aria-label="Close navigation menu"
          onClick={onClose}
        />
      )}
      <aside
        className={`secretary-sidebar${collapsed ? " secretary-sidebar--collapsed" : ""}${mobileOpen ? " secretary-sidebar--mobile-open" : ""}`}
        id="secretary-sidebar"
        aria-label="Secretary navigation"
      >
        <div className="secretary-sidebar__brand">
          <SidebarBrand title={title} imageUrl={logoUrl} />
          <button
            className="icon-button secretary-sidebar__close"
            type="button"
            aria-label="Close navigation menu"
            onClick={onClose}
          >
            <X size={19} aria-hidden="true" />
          </button>
        </div>

        <nav className="secretary-navigation">
          {menuGroups.map((group) => (
            <div className="secretary-navigation__group" key={group.label}>
              <p className="secretary-navigation__heading">{group.label}</p>
              {group.items.map(({ label, icon: Icon }) => {
                const route = routeByLabel[label] ?? null;
                const isActive =
                  route === "/secretary"
                    ? location.pathname === route
                    : route !== null && location.pathname.startsWith(route);
                const className = `secretary-navigation__item${isActive ? " secretary-navigation__item--active" : ""}`;

                if (route) {
                  return (
                    <NavLink
                      className={className}
                      to={route}
                      end={label === "Dashboard"}
                      key={label}
                      aria-label={label}
                      title={collapsed ? label : undefined}
                      onClick={onClose}
                    >
                      <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                      <span>{label}</span>
                    </NavLink>
                  );
                }

                return (
                  <button
                    className={className}
                    type="button"
                    key={label}
                    disabled
                    aria-label={`${label} — not available yet`}
                    title={
                      collapsed ? `${label} — not available yet` : undefined
                    }
                  >
                    <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                    <span>{label}</span>
                    {!collapsed && (
                      <span className="secretary-navigation__later">Soon</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="secretary-sidebar__help">
          <span className="secretary-sidebar__help-icon">
            <CircleHelp size={17} aria-hidden="true" />
          </span>
          <span className="secretary-sidebar__help-copy">
            <strong>Need a hand?</strong>
            <small>Your workspace is ready to grow.</small>
          </span>
        </div>
      </aside>
    </>
  );
}

export default function SecretaryLayout() {
  const { user, companyBranding, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(
    () => window.matchMedia("(max-width: 760px)").matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 760px)");
    const updateViewport = (event: MediaQueryListEvent) =>
      setIsMobileViewport(event.matches);

    mediaQuery.addEventListener("change", updateViewport);
    return () => mediaQuery.removeEventListener("change", updateViewport);
  }, []);

  if (!user) return null;

  async function handleSignOut() {
    setIsSigningOut(true);

    try {
      await signOut();
      navigate("/", { replace: true, state: null });
    } catch {
      navigate("/", {
        replace: true,
        state: { logoutWarning: true },
      });
    } finally {
      setIsSigningOut(false);
    }
  }

  function toggleSidebar() {
    if (isMobileViewport) {
      setMobileOpen((open) => !open);
      return;
    }

    setCollapsed((isCollapsed) => !isCollapsed);
  }

  const companyTitle = companyBranding?.titleEn || "ERPGO";
  const pageTitle =
    location.pathname === "/secretary/purchases/create"
      ? "Create Purchase"
      : location.pathname === "/secretary/sales/create"
        ? "Create Sale"
        : location.pathname.startsWith("/secretary/sales")
          ? "Sales"
          : Object.entries(routeByLabel).find(([label, route]) =>
              label !== "Dashboard" && location.pathname.startsWith(route),
            )?.[0] ?? "Overview";

  return (
    <div
      className={`secretary-shell${collapsed ? " secretary-shell--collapsed" : ""}`}
    >
      <SecretarySidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        title={companyTitle}
        logoUrl={companyBranding?.logoUrl}
      />

      <div className="secretary-main">
        <header className="secretary-header">
          <div className="secretary-header__leading">
            <button
              className="icon-button secretary-header__menu"
              type="button"
              onClick={toggleSidebar}
              aria-label={
                isMobileViewport
                  ? mobileOpen
                    ? "Close navigation menu"
                    : "Open navigation menu"
                  : collapsed
                    ? "Expand navigation sidebar"
                    : "Collapse navigation sidebar"
              }
              aria-expanded={isMobileViewport ? mobileOpen : !collapsed}
              aria-controls="secretary-sidebar"
            >
              <Menu size={20} aria-hidden="true" />
            </button>
            <div className="secretary-breadcrumb">
              <span>Workspace</span>
              <ChevronDown size={14} aria-hidden="true" />
              <strong>{pageTitle}</strong>
            </div>
          </div>

          <div className="secretary-header__user">
            <div className="secretary-user">
              <span className="secretary-user__avatar" aria-hidden="true">
                {getInitials(user.name)}
              </span>
              <span className="secretary-user__info">
                <strong>{user.name}</strong>
                <small>Secretary</small>
              </span>
            </div>
            <span className="secretary-header__divider" aria-hidden="true" />
            <button
              className="secretary-logout"
              type="button"
              onClick={() => void handleSignOut()}
              disabled={isSigningOut}
              aria-label="Log out"
              title="Log out"
            >
              <LogOut size={17} aria-hidden="true" />
              <span>{isSigningOut ? "Signing out…" : "Log out"}</span>
            </button>
          </div>
        </header>
        <main className="secretary-content">
          <Outlet />
        </main>

        <footer className="secretary-footer">ERPGO Management System</footer>
      </div>
    </div>
  );
}
