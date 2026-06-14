import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatUTCWithLocal } from "@/utils/time";
import Pager from "@/components/Pager";
import type { Page } from "@/api/client";

// Row shapes used by the tree. Both the global Order History page and the
// Session Detail page have richer types (with account_id / session_id); those
// extra fields are simply ignored here. Keeping the shapes minimal lets the
// component accept either fetcher source via structural subtyping.

export type TreeIntent = {
  time: string;
  intent_id: string;
  account_id?: number;
  session_id?: string;
  strategy_id?: number;
  symbol: string;
  side: string;
  requested_qty: number;
  requested_price: number;
  venue_id?: number;
  exchange?: number | string;
  exchange_label?: string;
  market?: number | string;
  market_label?: string;
  position_side?: string | number;
  post_only?: boolean;
  good_till_date?: string;
  reduce_only?: boolean;
};

export type TreeRiskReason = {
  code?: string;
  message?: string;
};

export type TreeAttempt = {
  time: string;
  attempt_id: string;
  status: string;
  mark_price: number;
  venue_id?: number;
  exchange?: number | string;
  exchange_label?: string;
  market?: number | string;
  market_label?: string;
  position_side?: string | number;
  error_message?: string;
  recovery_error?: string;
  post_only?: boolean;
  good_till_date?: string;
  reduce_only?: boolean;
  risk_status?: string;
  risk_reasons?: TreeRiskReason[];
};

export type TreeOrder = {
  time: string;
  order_id: string;
  status: string;
  executed_qty: number;
  orig_qty: number;
  avg_price: number;
  venue_id?: number;
  exchange?: number | string;
  exchange_label?: string;
  market?: number | string;
  market_label?: string;
  position_side?: string | number;
  error_message?: string;
  post_only?: boolean;
  good_till_date?: string;
  reduce_only?: boolean;
  recovery_status?: string;
  next_check_at?: string;
  recovery_deadline_at?: string;
  last_recovery_error?: string;
  force_closed_at?: string;
};

export type TreeFill = {
  time: string;
  fill_id: string;
  qty: number;
  fill_price: number;
  fee: number;
  status: string;
  venue_id?: number;
  exchange?: number | string;
  exchange_label?: string;
  market?: number | string;
  market_label?: string;
  position_side?: string | number;
};

// TreePage is just the canonical Page<T> shape from the API client — the
// tree fetchers ride on the standard `{ items, has_more, next_offset, total }`
// contract so the shared Pager has a uniform `total` to drive its First /
// Last / jump-to-page controls.
export type TreePage<T> = Page<T>;

export type IntentFetcher<I extends TreeIntent> = (
  offset: number,
  limit: number,
) => Promise<Page<I>>;

export type AttemptFetcher<A extends TreeAttempt> = (
  intentId: string,
  offset: number,
  limit: number,
) => Promise<Page<A>>;

export type OrderFetcher<O extends TreeOrder> = (
  attemptId: string,
  offset: number,
  limit: number,
) => Promise<Page<O>>;

export type FillFetcher<F extends TreeFill> = (
  orderId: string,
  offset: number,
  limit: number,
) => Promise<Page<F>>;

export type OrderTreeProps<
  I extends TreeIntent,
  A extends TreeAttempt,
  O extends TreeOrder,
  F extends TreeFill,
> = {
  fetchIntents: IntentFetcher<I>;
  fetchAttempts: AttemptFetcher<A>;
  fetchOrder: OrderFetcher<O>;
  fetchFills: FillFetcher<F>;
  /** Bumped by the parent (e.g. account/strategy filter changes) to reset the top-level pager. */
  resetKey?: string | number;
  /** Optional empty-state message override for the top-level intents list. */
  emptyMessage?: string;
};

const PAGE_SIZE = 20;
const TREE_INDENT_PX = 20;

export function orderBadgeClass(status: string): string {
  switch (String(status).toUpperCase()) {
    case "FAILED": return "status-badge status-badge--failed";
    case "UNKNOWN": return "status-badge status-badge--unknown";
    case "RECOVERING": return "status-badge status-badge--recovering";
    case "RECOVERED": return "status-badge status-badge--recovered";
    case "RECOVERY_FAILED": return "status-badge status-badge--recovery-failed";
    case "FEE_MISSING":
    case "FILL_PENDING":
      return "status-badge status-badge--recovering";
    case "FILLED": return "status-badge status-badge--completed";
    case "PARTIALLY_FILLED": return "status-badge status-badge--running";
    case "NEW": return "status-badge status-badge--idle";
    default: return "status-badge status-badge--idle";
  }
}

export function isFillPendingOrder(order: Pick<TreeOrder, "executed_qty" | "error_message">): boolean {
  return order.executed_qty > 0 && Boolean(order.error_message?.trim());
}

function riskBadgeClass(status: string): string {
  switch (String(status).toUpperCase()) {
    case "REJECT": return "status-badge status-badge--failed";
    case "ALLOW": return "status-badge status-badge--completed";
    default: return "status-badge status-badge--idle";
  }
}

type OrderSemantics = {
  post_only?: boolean;
  good_till_date?: string;
  reduce_only?: boolean;
};

function OrderSemanticBadges({ item }: { item: OrderSemantics }) {
  return (
    <>
      {item.post_only ? <span className="status-badge status-badge--idle">Post-only</span> : null}
      {item.reduce_only ? <span className="status-badge status-badge--idle">Reduce-only</span> : null}
      {item.good_till_date ? (
        <span className="status-badge status-badge--idle">GTD {formatUTCWithLocal(item.good_till_date)}</span>
      ) : null}
    </>
  );
}

function riskReasonText(reasons: TreeRiskReason[] | undefined): string | undefined {
  if (!reasons?.length) return undefined;
  return reasons
    .map((reason) => [reason.code, reason.message].filter(Boolean).join(": "))
    .filter(Boolean)
    .join("; ");
}

type RouteFacts = {
  venue_id?: number;
  exchange?: number | string;
  exchange_label?: string;
  market?: number | string;
  market_label?: string;
  position_side?: string | number;
};

function routeFactText(item: RouteFacts): string {
  const exchange = item.exchange_label || item.exchange || "-";
  const market = item.market_label || item.market || "-";
  const venue = item.venue_id || "-";
  const position = positionSideText(item.position_side);
  return `${exchange} / ${market} · venue ${venue} · position ${position}`;
}

function positionSideText(value?: string | number): string {
  if (value === 1) return "LONG";
  if (value === 2) return "SHORT";
  const raw = String(value || "").trim();
  return raw || "BOTH";
}

type PagedFetcher<T> = (offset: number, limit: number) => Promise<Page<T>>;

type PagedState<T> = {
  items: T[];
  offset: number;
  total: number;
  loading: boolean;
  error: string | null;
  jump: (newOffset: number) => void;
};

function usePagedList<T>(fetcher: PagedFetcher<T>, deps: unknown[]): PagedState<T> {
  const [items, setItems] = useState<T[]>([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setOffset(0); }, deps);

  const reload = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetcher(offset, PAGE_SIZE)
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setTotal(page.total);
      })
      .catch((e) => {
        if (cancelled) return;
        setItems([]);
        setTotal(0);
        setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, ...deps]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [offset, ...deps]);

  const jump = useCallback((newOffset: number) => {
    setOffset(Math.max(0, newOffset));
  }, []);

  return { items, offset, total, loading, error, jump };
}

export default function OrderTree<
  I extends TreeIntent,
  A extends TreeAttempt,
  O extends TreeOrder,
  F extends TreeFill,
>({
  fetchIntents,
  fetchAttempts,
  fetchOrder,
  fetchFills,
  resetKey,
  emptyMessage,
}: OrderTreeProps<I, A, O, F>) {
  const intentsState = usePagedList<I>(
    (offset, limit) => fetchIntents(offset, limit),
    [resetKey],
  );

  if (intentsState.error) return <p className="error">{intentsState.error}</p>;
  if (intentsState.loading && intentsState.items.length === 0) {
    return <p className="muted">Loading intents…</p>;
  }
  if (!intentsState.loading && intentsState.items.length === 0) {
    return <p className="muted">{emptyMessage ?? "No intents."}</p>;
  }

  return (
    <div>
      {intentsState.items.map((intent) => (
        <IntentRow
          key={intent.intent_id}
          intent={intent}
          fetchAttempts={fetchAttempts}
          fetchOrder={fetchOrder}
          fetchFills={fetchFills}
        />
      ))}
      <Pager
        offset={intentsState.offset}
        count={intentsState.items.length}
        total={intentsState.total}
        pageSize={PAGE_SIZE}
        loading={intentsState.loading}
        onJump={intentsState.jump}
      />
    </div>
  );
}

function IntentRow<
  I extends TreeIntent,
  A extends TreeAttempt,
  O extends TreeOrder,
  F extends TreeFill,
>({
  intent,
  fetchAttempts,
  fetchOrder,
  fetchFills,
}: {
  intent: I;
  fetchAttempts: AttemptFetcher<A>;
  fetchOrder: OrderFetcher<O>;
  fetchFills: FillFetcher<F>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: "1px solid #f1f5f9", padding: "0.4rem 0" }}>
      <div
        style={{
          display: "flex",
          gap: "0.6rem",
          alignItems: "center",
          flexWrap: "wrap",
          fontSize: "0.9rem",
          cursor: "pointer",
        }}
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <span style={{ width: "1rem", display: "inline-block", textAlign: "center" }}>
          {open ? "▼" : "▶"}
        </span>
        <span className="muted" style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>
          {intent.intent_id}
        </span>
        <span><strong>{intent.symbol}</strong> {intent.side}</span>
        <span className="muted">qty {intent.requested_qty}</span>
        <span className="muted">
          req px {intent.requested_price > 0 ? intent.requested_price.toFixed(2) : "—"}
        </span>
        <OrderSemanticBadges item={intent} />
        <span className="muted">{routeFactText(intent)}</span>
        {typeof intent.account_id === "number" && intent.account_id > 0 ? (
          <span className="muted">Account {intent.account_id}</span>
        ) : null}
        {intent.session_id ? (
          typeof intent.account_id === "number" && intent.account_id > 0 ? (
            <Link
              to={`/accounts/${intent.account_id}/sessions/${intent.session_id}`}
              onClick={(e) => e.stopPropagation()}
            >
              Session {intent.session_id.slice(0, 10)}…
            </Link>
          ) : (
            <span className="muted">Session {intent.session_id.slice(0, 10)}…</span>
          )
        ) : null}
        <span className="muted" style={{ marginLeft: "auto", fontSize: "0.85rem" }}>
          {formatUTCWithLocal(intent.time)}
        </span>
      </div>
      {open ? (
        <div style={{ marginLeft: TREE_INDENT_PX, marginTop: "0.4rem" }}>
          <IntentAttempts
            intentId={intent.intent_id}
            fetchAttempts={fetchAttempts}
            fetchOrder={fetchOrder}
            fetchFills={fetchFills}
          />
        </div>
      ) : null}
    </div>
  );
}

function IntentAttempts<
  A extends TreeAttempt,
  O extends TreeOrder,
  F extends TreeFill,
>({
  intentId,
  fetchAttempts,
  fetchOrder,
  fetchFills,
}: {
  intentId: string;
  fetchAttempts: AttemptFetcher<A>;
  fetchOrder: OrderFetcher<O>;
  fetchFills: FillFetcher<F>;
}) {
  const state = usePagedList<A>(
    (offset, limit) => fetchAttempts(intentId, offset, limit),
    [intentId],
  );
  return (
    <div>
      <div className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>Attempts</div>
      {state.error ? (
        <p className="error">{state.error}</p>
      ) : state.loading && state.items.length === 0 ? (
        <p className="muted">Loading attempts…</p>
      ) : state.items.length === 0 ? (
        <p className="muted">No attempts.</p>
      ) : (
        state.items.map((a) => (
          <AttemptRow
            key={a.attempt_id}
            attempt={a}
            fetchOrder={fetchOrder}
            fetchFills={fetchFills}
          />
        ))
      )}
      <Pager
        offset={state.offset}
        count={state.items.length}
        total={state.total}
        pageSize={PAGE_SIZE}
        loading={state.loading}
        onJump={state.jump}
      />
    </div>
  );
}

function AttemptRow<
  A extends TreeAttempt,
  O extends TreeOrder,
  F extends TreeFill,
>({
  attempt,
  fetchOrder,
  fetchFills,
}: {
  attempt: A;
  fetchOrder: OrderFetcher<O>;
  fetchFills: FillFetcher<F>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: "1px dashed #e2e8f0", padding: "0.3rem 0" }}>
      <div
        style={{
          display: "flex",
          gap: "0.6rem",
          alignItems: "center",
          flexWrap: "wrap",
          fontSize: "0.85rem",
          cursor: "pointer",
        }}
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <span style={{ width: "1rem", display: "inline-block", textAlign: "center" }}>
          {open ? "▼" : "▶"}
        </span>
        <span className="muted" style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>
          {attempt.attempt_id}
        </span>
        <span className={orderBadgeClass(attempt.status)}>{attempt.status}</span>
        <OrderSemanticBadges item={attempt} />
        {attempt.risk_status ? (
          <span
            className={riskBadgeClass(attempt.risk_status)}
            title={riskReasonText(attempt.risk_reasons)}
          >
            Risk {attempt.risk_status}
          </span>
        ) : null}
        <span className="muted">
          mark {attempt.mark_price > 0 ? attempt.mark_price.toFixed(2) : "—"}
        </span>
        <span className="muted">{routeFactText(attempt)}</span>
        {attempt.recovery_error || attempt.error_message ? (
          <span style={{ color: "#dc2626" }}>
            {attempt.recovery_error || attempt.error_message}
          </span>
        ) : null}
        <span className="muted" style={{ marginLeft: "auto", fontSize: "0.8rem" }}>
          {formatUTCWithLocal(attempt.time)}
        </span>
      </div>
      {open ? (
        <div style={{ marginLeft: TREE_INDENT_PX, marginTop: "0.3rem" }}>
          <AttemptOrder
            attemptId={attempt.attempt_id}
            fetchOrder={fetchOrder}
            fetchFills={fetchFills}
          />
        </div>
      ) : null}
    </div>
  );
}

function AttemptOrder<
  O extends TreeOrder,
  F extends TreeFill,
>({
  attemptId,
  fetchOrder,
  fetchFills,
}: {
  attemptId: string;
  fetchOrder: OrderFetcher<O>;
  fetchFills: FillFetcher<F>;
}) {
  // schema: orders.attempt_id is UNIQUE → at most one order per attempt.
  const state = usePagedList<O>(
    (offset, limit) => fetchOrder(attemptId, offset, limit),
    [attemptId],
  );
  return (
    <div>
      <div className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>Order</div>
      {state.error ? (
        <p className="error">{state.error}</p>
      ) : state.loading && state.items.length === 0 ? (
        <p className="muted">Loading order…</p>
      ) : state.items.length === 0 ? (
        <p className="muted">No order placed.</p>
      ) : (
        state.items.map((o) => (
          <OrderRow key={o.order_id} order={o} fetchFills={fetchFills} />
        ))
      )}
    </div>
  );
}

function OrderRow<
  O extends TreeOrder,
  F extends TreeFill,
>({
  order,
  fetchFills,
}: {
  order: O;
  fetchFills: FillFetcher<F>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ padding: "0.25rem 0" }}>
      <div
        style={{
          display: "flex",
          gap: "0.6rem",
          alignItems: "center",
          flexWrap: "wrap",
          fontSize: "0.85rem",
          cursor: "pointer",
        }}
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <span style={{ width: "1rem", display: "inline-block", textAlign: "center" }}>
          {open ? "▼" : "▶"}
        </span>
        <span className="muted" style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>
          {order.order_id}
        </span>
        <span className={orderBadgeClass(order.status)}>{order.status}</span>
        <OrderSemanticBadges item={order} />
        {order.recovery_status ? (
          <span className={orderBadgeClass(order.recovery_status)}>
            {order.recovery_status}
          </span>
        ) : null}
        {isFillPendingOrder(order) ? (
          <span className="status-badge status-badge--recovering" title={order.error_message}>
            Fill pending
          </span>
        ) : null}
        <span className="muted">
          {order.executed_qty} / {order.orig_qty}
        </span>
        <span className="muted">
          avg {order.avg_price > 0 ? order.avg_price.toFixed(2) : "—"}
        </span>
        <span className="muted">{routeFactText(order)}</span>
        <span className="muted" style={{ marginLeft: "auto", fontSize: "0.8rem" }}>
          {formatUTCWithLocal(order.time)}
        </span>
      </div>
      {open ? (
        <div style={{ marginLeft: TREE_INDENT_PX, marginTop: "0.3rem" }}>
          <OrderRecoveryMeta order={order} />
          {isFillPendingOrder(order) ? (
            <p className="muted" style={{ color: "#92400e" }}>
              Exchange order is filled, but trade fee/details are still pending recovery.
            </p>
          ) : null}
          <OrderFills orderId={order.order_id} fetchFills={fetchFills} />
        </div>
      ) : null}
    </div>
  );
}

function OrderRecoveryMeta({ order }: { order: TreeOrder }) {
  if (!order.next_check_at && !order.recovery_deadline_at && !order.force_closed_at && !order.last_recovery_error) {
    return null;
  }
  return (
    <p className="muted" style={{ fontSize: "0.8rem", margin: "0 0 0.3rem" }}>
      {order.next_check_at ? `next ${formatUTCWithLocal(order.next_check_at)}` : ""}
      {order.recovery_deadline_at ? `${order.next_check_at ? " · " : ""}deadline ${formatUTCWithLocal(order.recovery_deadline_at)}` : ""}
      {order.force_closed_at ? `${order.next_check_at || order.recovery_deadline_at ? " · " : ""}forced ${formatUTCWithLocal(order.force_closed_at)}` : ""}
      {order.last_recovery_error ? `${order.next_check_at || order.recovery_deadline_at || order.force_closed_at ? " · " : ""}${order.last_recovery_error}` : ""}
    </p>
  );
}

function OrderFills<F extends TreeFill>({
  orderId,
  fetchFills,
}: {
  orderId: string;
  fetchFills: FillFetcher<F>;
}) {
  const state = usePagedList<F>(
    (offset, limit) => fetchFills(orderId, offset, limit),
    [orderId],
  );
  return (
    <div>
      <div className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>Fills</div>
      {state.error ? (
        <p className="error">{state.error}</p>
      ) : state.loading && state.items.length === 0 ? (
        <p className="muted">Loading fills…</p>
      ) : state.items.length === 0 ? (
        <p className="muted">No fills.</p>
      ) : (
        <div className="table-scroll">
          <table className="compact" style={{ width: "100%", fontSize: "0.85rem", minWidth: "640px" }}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Fill</th>
                <th>Qty</th>
                <th>Fill Price</th>
                <th>Fee</th>
                <th>Route</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {state.items.map((f) => (
                <tr key={f.fill_id}>
                  <td style={{ whiteSpace: "nowrap" }}>{formatUTCWithLocal(f.time)}</td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{f.fill_id}</td>
                  <td>{f.qty}</td>
                  <td>{f.fill_price.toFixed(2)}</td>
                  <td>{f.fee.toFixed(4)}</td>
                  <td>{routeFactText(f)}</td>
                  <td><span className={orderBadgeClass(f.status)}>{f.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager
        offset={state.offset}
        count={state.items.length}
        total={state.total}
        pageSize={PAGE_SIZE}
        loading={state.loading}
        onJump={state.jump}
      />
    </div>
  );
}
