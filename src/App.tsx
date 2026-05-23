import { useCallback, useEffect, useRef, useState } from "react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { getToken, setToken } from "@/api/client";
import AccountDetail from "@/pages/AccountDetail";
import AccountList from "@/pages/AccountList";
import AccountNew from "@/pages/AccountNew";
import Login from "@/pages/Login";
import SessionDetailPage from "@/pages/SessionDetailPage";
import Signup from "@/pages/Signup";
import StrategyList from "@/pages/StrategyList";
import StrategyDetail from "@/pages/StrategyDetail";
import OrderHistory from "@/pages/OrderHistory";
import MarketDataPage from "@/pages/MarketData";
import NotificationManagement from "@/pages/NotificationManagement";
import RuntimeCredentials from "@/pages/RuntimeCredentials";
import RuntimeManagement, { RuntimeDetailPage } from "@/pages/RuntimeManagement";

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return children;
}

type SidebarProps = {
  drawerOpen: boolean;
  onNavigate: () => void;
  firstLinkRef: React.RefObject<HTMLAnchorElement>;
};

function Sidebar({ drawerOpen, onNavigate, firstLinkRef }: SidebarProps) {
  const nav = useNavigate();
  const authed = !!getToken();
  const className = `sidebar${drawerOpen ? " sidebar--open" : ""}`;
  return (
    <aside id="primary-sidebar" className={className} aria-label="Primary navigation">
      <ul className="sidebar-nav">
        <li>
          <NavLink to="/accounts" ref={firstLinkRef} onClick={onNavigate}>
            Account Management
          </NavLink>
        </li>
        <li>
          <NavLink to="/strategies" onClick={onNavigate}>
            Strategy Management
          </NavLink>
        </li>
        <li>
          <NavLink to="/orders" onClick={onNavigate}>
            Order History
          </NavLink>
        </li>
        <li>
          <NavLink to="/market-data" onClick={onNavigate}>
            Market Data
          </NavLink>
        </li>
        <li>
          <NavLink to="/runtimes" onClick={onNavigate}>
            Runtime Management
          </NavLink>
        </li>
        <li>
          <NavLink to="/notifications" onClick={onNavigate}>
            Notification Management
          </NavLink>
        </li>
      </ul>
      <div className="sidebar-bottom">
        {authed ? (
          <button
            type="button"
            style={{ width: "100%", fontSize: "0.85rem" }}
            onClick={() => {
              setToken(null);
              onNavigate();
              nav("/login", { replace: true });
            }}
          >
            Log out
          </button>
        ) : (
          <NavLink to="/login" onClick={onNavigate}>
            Log in
          </NavLink>
        )}
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
  const location = useLocation();
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null!);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Close on route change
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

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
        Quantitative Trading System
      </header>
      <div className="app-body">
        <Sidebar
          drawerOpen={drawerOpen}
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
          path="/accounts"
          element={<RequireAuth><AccountList /></RequireAuth>}
        />
        <Route
          path="/accounts/new"
          element={<RequireAuth><AccountNew /></RequireAuth>}
        />
        <Route
          path="/accounts/:id"
          element={<RequireAuth><AccountDetail /></RequireAuth>}
        />
        <Route
          path="/accounts/:id/sessions/:sessionId"
          element={<RequireAuth><SessionDetailPage /></RequireAuth>}
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
        <Route
          path="/runtimes/credentials"
          element={<RequireAuth><RuntimeCredentials /></RequireAuth>}
        />
        <Route
          path="/runtimes/:runtimeId"
          element={<RequireAuth><RuntimeDetailPage /></RequireAuth>}
        />
        <Route
          path="/notifications"
          element={<RequireAuth><NotificationManagement /></RequireAuth>}
        />
        <Route path="/settings/runtime-credentials" element={<Navigate to="/runtimes/credentials" replace />} />
        <Route path="/" element={<Navigate to="/accounts" replace />} />
        <Route path="*" element={<p>Not found</p>} />
      </Routes>
    </Layout>
  );
}
