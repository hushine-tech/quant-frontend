import { useCallback, useEffect, useRef, useState } from "react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  Bell,
  Building2,
  ChartCandlestick,
  ClipboardList,
  Database,
  History,
  LogIn,
  LogOut,
  MoreHorizontal,
  PanelLeftClose,
  Rocket,
  ScrollText,
  UserRound,
  UsersRound,
} from "lucide-react";
import { getAuthUser, getToken, setAuthUser, setToken } from "@/api/client";
import PortfolioManagement from "@/pages/PortfolioManagement";
import PortfolioDetail from "@/pages/PortfolioDetail";
import Login from "@/pages/Login";
import SessionDetailPage from "@/pages/SessionDetailPage";
import SessionManagement from "@/pages/SessionManagement";
import Signup from "@/pages/Signup";
import StrategyList from "@/pages/StrategyList";
import StrategyDetail from "@/pages/StrategyDetail";
import OrderHistory from "@/pages/OrderHistory";
import MarketDataPage from "@/pages/MarketData";
import NotificationManagement from "@/pages/NotificationManagement";
import RuntimeManagement, { RuntimeDetailPage } from "@/pages/RuntimeManagement";
import VenueManagement from "@/pages/VenueManagement";
import QuickStart from "@/pages/QuickStart";

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return children;
}

function PortfolioNewRedirect() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set("tab", "create");
  return <Navigate to={`/portfolios?${params.toString()}`} replace />;
}

const PRIMARY_NAV_ITEMS = [
  { to: "/portfolios", label: "Portfolio Management", icon: UsersRound },
  { to: "/venues", label: "Venue Management", icon: Building2 },
  { to: "/strategies", label: "Strategy Management", icon: ScrollText },
  { to: "/market-data", label: "Market Data", icon: ChartCandlestick },
  { to: "/runtimes", label: "Runtime Management", icon: Database },
  { to: "/sessions", label: "Session Management", icon: History },
  { to: "/orders", label: "Order History", icon: ClipboardList },
  { to: "/notifications", label: "Notification Management", icon: Bell },
];

const QUICK_START_NAV_ITEM = { to: "/quick-start", label: "Quick Start", icon: Rocket, featured: true };

function Profile() {
  const user = getAuthUser();
  const nav = useNavigate();
  const profileRef = useRef<HTMLDivElement>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  const handleLogout = useCallback(() => {
    setProfileOpen(false);
    setToken(null);
    setAuthUser(null);
    nav("/login", { replace: true });
  }, [nav]);

  useEffect(() => {
    if (!profileOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!profileRef.current?.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProfileOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [profileOpen]);

  if (!getToken()) return null;
  return (
    <div className="app-profile" ref={profileRef}>
      <button
        id="app-profile-trigger"
        type="button"
        className="app-profile__button"
        aria-haspopup="dialog"
        aria-expanded={profileOpen}
        aria-controls="app-profile-menu"
        onClick={() => setProfileOpen((open) => !open)}
      >
        <UserRound size={18} aria-hidden="true" />
        <span>Profile</span>
      </button>
      {profileOpen ? (
        <div
          id="app-profile-menu"
          className="app-profile__menu"
          role="dialog"
          aria-label="Profile details"
          aria-labelledby="app-profile-trigger"
        >
          <div className="app-profile__details" aria-label="Profile details">
            <div className="app-profile__row">
              <span className="app-profile__label">USER ID:</span>
              <span className="app-profile__value">{user?.user_id ?? "-"}</span>
            </div>
            <div className="app-profile__row">
              <span className="app-profile__label">USER:</span>
              <span className="app-profile__value">{user?.username || "User"}</span>
            </div>
          </div>
          <button type="button" className="app-profile__logout" onClick={handleLogout}>
            <LogOut size={16} aria-hidden="true" />
            <span>Log out</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

type SidebarProps = {
  drawerOpen: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onNavigate: () => void;
  firstLinkRef: React.RefObject<HTMLAnchorElement>;
};

function Sidebar({
  drawerOpen,
  collapsed,
  onToggleCollapsed,
  onNavigate,
  firstLinkRef,
}: SidebarProps) {
  const authed = !!getToken();
  const className = `sidebar${drawerOpen ? " sidebar--open" : ""}${collapsed ? " sidebar--collapsed" : ""}`;
  return (
    <aside id="primary-sidebar" className={className} aria-label="Primary navigation">
      <div className="sidebar-collapse-row">
        <button
          type="button"
          className="sidebar-icon-button"
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          onClick={onToggleCollapsed}
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {collapsed ? <MoreHorizontal size={20} aria-hidden="true" /> : <PanelLeftClose size={20} aria-hidden="true" />}
        </button>
      </div>
      <ul className="sidebar-nav">
        {[QUICK_START_NAV_ITEM, ...PRIMARY_NAV_ITEMS].map((item, index) => {
          const Icon = item.icon;
          const featured = "featured" in item && item.featured;
          return (
            <li key={item.to} className={featured ? "sidebar-nav__featured" : undefined}>
              <NavLink
                to={item.to}
                ref={index === 0 ? firstLinkRef : undefined}
                onClick={onNavigate}
                title={collapsed ? item.label : undefined}
              >
                <Icon size={18} aria-hidden="true" />
                <span className="sidebar-label">{item.label}</span>
                {collapsed ? <span className="sidebar-tooltip">{item.label}</span> : null}
              </NavLink>
            </li>
          );
        })}
      </ul>
      <div className="sidebar-bottom">
        {!authed ? (
          <NavLink to="/login" onClick={onNavigate}>
            <LogIn size={18} aria-hidden="true" />
            <span className="sidebar-label">Log in</span>
          </NavLink>
        ) : null}
      </div>
    </aside>
  );
}

function HamburgerIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  ) : (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return window.localStorage.getItem("hushine.sidebarCollapsed") === "1";
  });
  const location = useLocation();
  const isAuthRoute = location.pathname === "/login" || location.pathname === "/signup";
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null!);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Close on route change
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    window.localStorage.setItem("hushine.sidebarCollapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  // Esc to close
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  // Body scroll lock while drawer is open
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  // Focus management: on open → first link; on close → hamburger button
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (drawerOpen) {
      firstLinkRef.current?.focus();
      wasOpenRef.current = true;
    } else if (wasOpenRef.current) {
      hamburgerRef.current?.focus();
      wasOpenRef.current = false;
    }
  }, [drawerOpen]);

  if (isAuthRoute) {
    return (
      <div className="app-shell app-shell--auth">
        <header className="app-header app-header--auth">
          Quantitative Trading System
        </header>
        <main className="content-area content-area--auth">{children}</main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <button
          ref={hamburgerRef}
          type="button"
          className="hamburger-btn"
          aria-label={drawerOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={drawerOpen}
          aria-controls="primary-sidebar"
          onClick={() => setDrawerOpen((o) => !o)}
        >
          <HamburgerIcon open={drawerOpen} />
        </button>
        <span className="app-header__title">Quantitative Trading System</span>
        <Profile />
      </header>
      <div className={`app-body${sidebarCollapsed ? " app-body--sidebar-collapsed" : ""}`}>
        <Sidebar
          drawerOpen={drawerOpen}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
          onNavigate={closeDrawer}
          firstLinkRef={firstLinkRef}
        />
        <div
          className={`sidebar-overlay${drawerOpen ? " sidebar-overlay--visible" : ""}`}
          aria-hidden="true"
          onClick={closeDrawer}
        />
        <main className="content-area">{children}</main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route
          path="/quick-start"
          element={<RequireAuth><QuickStart /></RequireAuth>}
        />
        <Route
          path="/portfolios"
          element={<RequireAuth><PortfolioManagement /></RequireAuth>}
        />
        <Route path="/portfolios/new" element={<PortfolioNewRedirect />} />
        <Route
          path="/portfolios/:id"
          element={<RequireAuth><PortfolioDetail /></RequireAuth>}
        />
        <Route
          path="/portfolios/:id/sessions/:sessionId"
          element={<RequireAuth><SessionDetailPage /></RequireAuth>}
        />
        <Route
          path="/venues"
          element={<RequireAuth><VenueManagement /></RequireAuth>}
        />
        <Route
          path="/sessions"
          element={<RequireAuth><SessionManagement /></RequireAuth>}
        />
        <Route
          path="/strategies"
          element={<RequireAuth><StrategyList /></RequireAuth>}
        />
        <Route
          path="/strategies/:id"
          element={<RequireAuth><StrategyDetail /></RequireAuth>}
        />
        <Route
          path="/orders"
          element={<RequireAuth><OrderHistory /></RequireAuth>}
        />
        <Route
          path="/market-data"
          element={<RequireAuth><MarketDataPage /></RequireAuth>}
        />
        <Route
          path="/runtimes"
          element={<RequireAuth><RuntimeManagement /></RequireAuth>}
        />
        <Route path="/runtimes/credentials" element={<Navigate to="/runtimes?tab=credentials" replace />} />
        <Route
          path="/runtimes/:runtimeId"
          element={<RequireAuth><RuntimeDetailPage /></RequireAuth>}
        />
        <Route
          path="/notifications"
          element={<RequireAuth><NotificationManagement /></RequireAuth>}
        />
        <Route path="/settings/runtime-credentials" element={<Navigate to="/runtimes?tab=credentials" replace />} />
        <Route path="/" element={<Navigate to="/portfolios" replace />} />
        <Route path="*" element={<p>Not found</p>} />
      </Routes>
    </Layout>
  );
}
