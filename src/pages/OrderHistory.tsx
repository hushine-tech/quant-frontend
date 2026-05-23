import { useEffect, useMemo, useState } from "react";
import {
  listAccounts,
  listStrategies,
  queryOrderAttempts,
  queryOrderFills,
  queryOrderIntents,
  queryOrders,
  type Account,
  type Page,
  type Strategy,
} from "@/api/client";
import PageHeader from "@/components/PageHeader";
import { FilterField, FilterPanel } from "@/components/FilterControls";
import OrderTree from "@/components/OrderTree";

// Order-history flat queries return ``{ items, total }``; OrderTree's fetchers
// expect the canonical Page<T> shape ``{ items, has_more, next_offset, total }``.
// Adapt at the boundary so the tree sees the unified contract.
function toTreePage<T>(
  result: { items: T[]; total: number },
  offset: number,
): Page<T> {
  const consumed = offset + result.items.length;
  return {
    items: result.items,
    has_more: consumed < result.total,
    next_offset: consumed,
    total: result.total,
  };
}

export default function OrderHistory() {
  const [accountId, setAccountId] = useState<string>("");
  const [strategyId, setStrategyId] = useState<string>("");
  const [refreshTick, setRefreshTick] = useState(0);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsErr, setAccountsErr] = useState<string | null>(null);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [strategiesErr, setStrategiesErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAccounts()
      .then((list) => { if (!cancelled) setAccounts(list); })
      .catch((e) => { if (!cancelled) setAccountsErr(e instanceof Error ? e.message : "Load accounts failed"); });
    listStrategies()
      .then((list) => { if (!cancelled) setStrategies(list); })
      .catch((e) => { if (!cancelled) setStrategiesErr(e instanceof Error ? e.message : "Load strategies failed"); });
    return () => { cancelled = true; };
  }, []);

  // resetKey collapses any expanded child rows and reloads the top-level
  // intents list whenever the user changes a top filter.
  const resetKey = `${accountId}|${strategyId}|${refreshTick}`;

  // The strategy filter applies through the entire drill-down so child fetches
  // stay scoped to the same strategy as the parent intent.
  const baseScope = useMemo(
    () => ({
      accountId: accountId || undefined,
      strategyId: strategyId || undefined,
    }),
    [accountId, strategyId],
  );

  const fetchIntents = async (offset: number, limit: number) =>
    toTreePage(
      await queryOrderIntents({ ...baseScope, limit, offset }),
      offset,
    );

  const fetchAttempts = async (intentId: string, offset: number, limit: number) =>
    toTreePage(
      await queryOrderAttempts({ ...baseScope, intentId, limit, offset }),
      offset,
    );

  const fetchOrder = async (attemptId: string, offset: number, limit: number) =>
    toTreePage(
      await queryOrders({ ...baseScope, attemptId, limit, offset }),
      offset,
    );

  const fetchFills = async (orderId: string, offset: number, limit: number) =>
    toTreePage(
      await queryOrderFills({ ...baseScope, orderId, limit, offset }),
      offset,
    );

  return (
    <div>
      <PageHeader
        title="Order History"
        description="Inspect order intents, attempts, exchange orders, and fills."
        onRefresh={() => setRefreshTick((value) => value + 1)}
      />

      <div className="card">
        <FilterPanel>
          <FilterField label="Account" wide>
            <select
              id="order-history-account"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.account_id} value={String(a.account_id)}>
                  {a.account_id} ({a.name})
                </option>
              ))}
            </select>
            {accountsErr ? (
              <div className="error" style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>{accountsErr}</div>
            ) : null}
          </FilterField>

          <FilterField label="Strategy" wide>
            <select
              id="order-history-strategy"
              value={strategyId}
              onChange={(e) => setStrategyId(e.target.value)}
            >
              <option value="">All strategies</option>
              {strategies.map((s) => (
                <option key={s.strategy_id} value={String(s.strategy_id)}>
                  {s.strategy_id} - {s.name} v{s.version}{s.archived ? " (archived)" : ""}
                </option>
              ))}
            </select>
            {strategiesErr ? (
              <div className="error" style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>{strategiesErr}</div>
            ) : null}
          </FilterField>
        </FilterPanel>
      </div>

      <div className="card">
        <OrderTree
          fetchIntents={fetchIntents}
          fetchAttempts={fetchAttempts}
          fetchOrder={fetchOrder}
          fetchFills={fetchFills}
          resetKey={resetKey}
          emptyMessage="No intents found for the current filters."
        />
      </div>
    </div>
  );
}
