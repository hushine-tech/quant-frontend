import { useMemo, useState } from "react";
import {
  listPortfoliosPage,
  listStrategiesPage,
  queryOrderAttempts,
  queryOrderFills,
  queryOrderIntents,
  queryOrders,
  type Portfolio,
  type Page,
  type Strategy,
} from "@/api/client";
import PageHeader from "@/components/PageHeader";
import { FilterField, FilterPanel } from "@/components/FilterControls";
import OrderTree from "@/components/OrderTree";
import AsyncSelect, { type AsyncSelectOption } from "@/components/AsyncSelect";
import { collectFilteredPage } from "@/utils/asyncSelectPagination";

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
  const [portfolioId, setPortfolioId] = useState<string>("");
  const [strategyId, setStrategyId] = useState<string>("");
  const [refreshTick, setRefreshTick] = useState(0);

  // resetKey collapses any expanded child rows and reloads the top-level
  // intents list whenever the user changes a top filter.
  const resetKey = `${portfolioId}|${strategyId}|${refreshTick}`;

  // The strategy filter applies through the entire drill-down so child fetches
  // stay scoped to the same strategy as the parent intent.
  const baseScope = useMemo(
    () => ({
      portfolioId: portfolioId || undefined,
      strategyId: strategyId || undefined,
    }),
    [portfolioId, strategyId],
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
          <FilterField label="Portfolio" wide>
            <AsyncSelect<Portfolio>
              value={portfolioId}
              placeholder="All portfolios"
              onChange={setPortfolioId}
              loadPage={async (offset, limit, query) => {
                const normalizedQuery = query.trim().toLowerCase();
                return collectFilteredPage<Portfolio, AsyncSelectOption<Portfolio>>({
                  offset,
                  limit,
                  loadSourcePage: (sourceOffset, sourceLimit) => listPortfoliosPage({ offset: sourceOffset, limit: sourceLimit }),
                  matches: (a) => !normalizedQuery || a.name.toLowerCase().includes(normalizedQuery) || String(a.portfolio_id).includes(normalizedQuery),
                  map: (a) => ({
                    value: String(a.portfolio_id),
                    label: `${a.portfolio_id} (${a.name})`,
                    item: a,
                  }),
                });
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
