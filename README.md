# quant-frontend

React (Vite + TypeScript) portal UI: sign in against **quant-handler**, then list / create / view trading accounts. Charting is isolated under `src/features/charts/` for a future **TradingView** embed.

## Configuration

Set at build time:

- `VITE_API_BASE_URL` — quant-handler origin (e.g. `http://localhost:8090`). If unset, the app defaults to `http://localhost:8090` for local dev.

## Scripts

```bash
npm install
npm run dev
```

Build:

```bash
VITE_API_BASE_URL=http://localhost:8090 npm run build
```

## Local stack

1. TimescaleDB + backend services, including **core-service** and **control-panel-service**.
2. **quant-handler** with `QUANT_HANDLER_JWT_SECRET`, `ACCOUNT_SERVICE_GRPC_ADDR`, `CONTROL_PANEL_SERVICE_GRPC_ADDR`, and CORS allowing the Vite origin (`http://localhost:5173` by default on handler).
3. This app: `npm run dev`, open the printed URL, sign up or log in with a user account, manage accounts/runtime/market-data flows.

## Manual UI check (wallet wizard)

After logging in: create a **backtest** account using spot free balance and/or symbol search (adds assets and futures legs). Open **View** and confirm the environment banner color, **total value**, and the two-column spot vs futures summary match expectations. Live/testnet accounts still use exchange-backed wallet reads; the create wizard for spot/futures is limited to backtest in the UI.

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
