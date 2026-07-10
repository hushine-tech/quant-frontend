import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { listPortfoliosPage, type Portfolio } from "@/api/client";
import PageHeader from "@/components/PageHeader";
import PageTabs, { type PageTab } from "@/components/PageTabs";
import InfiniteTable from "@/components/InfiniteTable";
import QuickStartActionButton from "@/components/QuickStartActionButton";
import PortfolioNew from "@/pages/PortfolioNew";
import { portfolioEnvironmentLabel } from "@/utils/portfolioEnvironment";
import { formatUTCWithLocal } from "@/utils/time";
import { appendReturnParam, isQuickStartReturnTo, safeInternalReturnTo } from "@/utils/returnTo";

type PortfolioTab = "portfolios" | "create";

const tabs: Array<PageTab<PortfolioTab>> = [
  { id: "portfolios", label: "Portfolios" },
  { id: "create", label: "Create Portfolio" },
];

function normalizeTab(value: string | null): PortfolioTab {
  return value === "create" ? "create" : "portfolios";
}

export default function PortfolioManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<PortfolioTab>(() => normalizeTab(searchParams.get("tab")));
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const returnTo = safeInternalReturnTo(searchParams.get("return_to"));
  const quickStartMode = isQuickStartReturnTo(returnTo);

  useEffect(() => {
    setActiveTab(normalizeTab(searchParams.get("tab")));
  }, [searchParams]);

  function changeTab(tab: PortfolioTab, options: { clearMessages?: boolean } = {}) {
    setActiveTab(tab);
    if (options.clearMessages ?? true) {
      setNotice(null);
    }
    const next: Record<string, string> = {};
    if (tab !== "portfolios") next.tab = tab;
    const rawReturnTo = searchParams.get("return_to");
    if (rawReturnTo) next.return_to = rawReturnTo;
    setSearchParams(next);
  }

  const description = useMemo(() => {
    return activeTab === "portfolios"
      ? "Manage backtest, demo, and live portfolio contexts."
      : "Create an portfolio context for backtests or exchange-backed sessions.";
  }, [activeTab]);

  const loadPortfolios = useCallback(async (offset: number, limit: number) => {
    setLoading(true);
    try {
      return await listPortfoliosPage({ offset, limit });
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div>
      <PageHeader
        title="Portfolio Management"
        description={description}
        loading={loading}
        onRefresh={activeTab === "portfolios" ? () => setRefreshKey((v) => v + 1) : undefined}
      />
      <PageTabs tabs={tabs} activeTab={activeTab} onChange={changeTab} ariaLabel="Portfolio sections">
        {notice ? <p className="notice notice--success">{notice}</p> : null}
        {activeTab === "portfolios" ? (
          <InfiniteTable<Portfolio>
            columns={returnTo ? ["Name", "ID", "Environment", "Created", "Description", "Action"] : ["Name", "ID", "Environment", "Created", "Description"]}
            refreshKey={refreshKey}
            emptyText="No portfolios yet."
            loadPage={loadPortfolios}
            rowKey={(portfolio) => String(portfolio.portfolio_id)}
            renderRow={(portfolio) => (
              <>
                <td><Link to={`/portfolios/${portfolio.portfolio_id}`}>{portfolio.name}</Link></td>
                <td><code>{portfolio.portfolio_id}</code></td>
                <td>{portfolioEnvironmentLabel(portfolio.environment)}</td>
                <td>{portfolio.created_at ? formatUTCWithLocal(portfolio.created_at) : "-"}</td>
                <td>{portfolio.description?.trim() || "-"}</td>
                {returnTo ? (
                  <td>
                    {quickStartMode ? (
                      <QuickStartActionButton onClick={() => navigate(appendReturnParam(returnTo, "portfolio_id", portfolio.portfolio_id), { replace: true })} />
                    ) : (
                      <button
                        type="button"
                        onClick={() => navigate(appendReturnParam(returnTo, "portfolio_id", portfolio.portfolio_id), { replace: true })}
                      >
                        Use
                      </button>
                    )}
                  </td>
                ) : null}
              </>
            )}
          />
        ) : (
          <PortfolioNew
            embedded
            onCreated={(portfolio) => {
              if (returnTo) {
                navigate(appendReturnParam(returnTo, "portfolio_id", portfolio.portfolio_id), { replace: true });
                return;
              }
              setNotice(`Portfolio ${portfolio.portfolio_id} created.`);
              setRefreshKey((v) => v + 1);
              changeTab("portfolios", { clearMessages: false });
            }}
          />
        )}
      </PageTabs>
    </div>
  );
}
