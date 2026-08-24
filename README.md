# quant-frontend

React 19 + Vite portal for Hushine. The application authenticates through quant-handler and exposes Quick Start, Portfolio, Venue, Strategy, Market Data, Runtime, Session, Order, Notification, and Profile workflows. Session charts are implemented with `lightweight-charts` under the current session-detail components.

## Configuration

Set at build time:

- `VITE_API_BASE_URL` — quant-handler origin. Use `auto` or leave unset to call `http(s)://<current frontend host>:8090`.
- `FRONTEND_API_BASE_URL` — Makefile wrapper for production builds. Defaults to `auto`, so a deployment served from `http://192.168.88.12:5173` calls `http://192.168.88.12:8090`.

## Scripts

```bash
npm install
npm run dev
```

Build:

```bash
make build
# or force a separate API origin:
FRONTEND_API_BASE_URL=http://api.example.com:8090 make build
```

## Local stack

1. TimescaleDB + backend services, including **core-service** and **control-panel-service**.
2. **quant-handler** with `AUTH_JWT_SECRET`, `DEPENDENCIES_CORE_SERVICE_GRPC`, `DEPENDENCIES_ORDER_SERVICE_GRPC`, `DEPENDENCIES_CONTROL_PANEL_SERVICE_GRPC`, and `AUTH_CORS_ORIGINS` allowing the Vite origin (`http://localhost:5173` by default).
3. This app: `npm run dev`, open the printed URL, sign up or log in with a user account, and manage Portfolio, Venue, runtime, and market-data flows.

## Manual UI check (Portfolio/Venue flow)

After logging in, create a backtest Portfolio, then create a backtest Venue and bind it to that Portfolio. Open Portfolio Detail and confirm the bound Venue and venue-backed wallet snapshot match the configured backtest balances.

## Responsive layout

The app uses three breakpoints everywhere:

| Range | Name | Behavior |
|-------|------|----------|
| `≥ 1025px` | desktop | Sidebar always visible (220px). 3-column `.detail-layout`. Content padding `1.5rem 2rem`. |
| `641–1024px` | tablet | Sidebar always visible. 2-column `.detail-layout`. Content padding `1.25rem 1.5rem`. |
| `≤ 640px` | mobile | Sidebar hidden off-canvas. Hamburger menu in header. 1-column `.detail-layout`. Content padding `1rem`. |

On mobile the sidebar becomes a **left drawer** that slides in over the content when the hamburger button is clicked. It closes on: overlay click, nav link click, Escape key, route change. Body scroll is locked while open (prevents iOS rubber-band).

When authoring new CSS **only use `640px` and `1024px`** as media query thresholds. Do not introduce 768 / 840 / 1200 breakpoints.

When authoring new pages, wrap any wide table in `.table-scroll` so it horizontal-scrolls on narrow widths, and use `min-width: 0` on grid children to avoid overflow.
