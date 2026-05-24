import { useMemo, useState } from "react";
import {
  listAccountsPage,
  listStrategiesPage,
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
import AsyncSelect, { type AsyncSelectOption } from "@/components/AsyncSelect";

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
            <AsyncSelect<Account>
              value={accountId}
              placeholder="All accounts"
              onChange={setAccountId}
              loadPage={async (offset, limit, query) => {
                const page = await listAccountsPage({ offset, limit });
                return {
                  ...page,
                  items: page.items
                    .filter((a) => !query || a.name.toLowerCase().includes(query.toLowerCase()) || String(a.account_id).includes(query))
                    .map<AsyncSelectOption<Account>>((a) => ({
                      value: String(a.account_id),
                      label: `${a.account_id} (${a.name})`,
                      item: a,
                    })),
                };
              }}
            />
          </FilterField>

          <FilterField label="Strategy" wide>
            <AsyncSelect<Strategy>
              value={strategyId}
              placeholder="All strategies"
              onChange={setStrategyId}
              loadPage={async (offset, limit, query) => {
                const page = await listStrategiesPage({ offset, limit, namePrefix: query || undefined });
                return {
                  ...page,
                  items: page.items.map<AsyncSelectOption<Strategy>>((s) => ({
                    value: String(s.strategy_id),
                    label: `${s.strategy_id} - ${s.name} v${s.version}${s.archived ? " (archived)" : ""}`,
                    item: s,
                  })),
                };
              }}
            />
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
