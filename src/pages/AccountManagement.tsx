import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { listAccountsPage, type Account } from "@/api/client";
import PageHeader from "@/components/PageHeader";
import PageTabs, { type PageTab } from "@/components/PageTabs";
import InfiniteTable from "@/components/InfiniteTable";
import AccountNew from "@/pages/AccountNew";
import { accountEnvironmentLabel } from "@/utils/accountEnvironment";
import { formatUTCWithLocal } from "@/utils/time";
import { appendReturnParam, safeInternalReturnTo } from "@/utils/returnTo";

type AccountTab = "accounts" | "create";

const tabs: Array<PageTab<AccountTab>> = [
  { id: "accounts", label: "Accounts" },
  { id: "create", label: "Create Account" },
];

function normalizeTab(value: string | null): AccountTab {
  return value === "create" ? "create" : "accounts";
}

export default function AccountManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<AccountTab>(() => normalizeTab(searchParams.get("tab")));
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const returnTo = safeInternalReturnTo(searchParams.get("return_to"));

  useEffect(() => {
    setActiveTab(normalizeTab(searchParams.get("tab")));
  }, [searchParams]);

  function changeTab(tab: AccountTab, options: { clearMessages?: boolean } = {}) {
    setActiveTab(tab);
    if (options.clearMessages ?? true) {
      setNotice(null);
    }
    const next: Record<string, string> = {};
    if (tab !== "accounts") next.tab = tab;
    const rawReturnTo = searchParams.get("return_to");
    if (rawReturnTo) next.return_to = rawReturnTo;
    setSearchParams(next);
  }

  const description = useMemo(() => {
    return activeTab === "accounts"
      ? "Manage backtest, demo, and live account contexts."
      : "Create an account context for backtests or exchange-backed sessions.";
  }, [activeTab]);

  const loadAccounts = useCallback(async (offset: number, limit: number) => {
    setLoading(true);
    try {
      return await listAccountsPage({ offset, limit });
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div>
      <PageHeader
        title="Account Management"
        description={description}
        loading={loading}
        onRefresh={activeTab === "accounts" ? () => setRefreshKey((v) => v + 1) : undefined}
      />
      <PageTabs tabs={tabs} activeTab={activeTab} onChange={changeTab} ariaLabel="Account sections">
        {notice ? <p className="notice notice--success">{notice}</p> : null}
        {activeTab === "accounts" ? (
          <InfiniteTable<Account>
            columns={returnTo ? ["Name", "ID", "Environment", "Created", "Description", "Action"] : ["Name", "ID", "Environment", "Created", "Description"]}
            refreshKey={refreshKey}
            emptyText="No accounts yet."
            loadPage={loadAccounts}
            rowKey={(account) => String(account.account_id)}
            renderRow={(account) => (
              <>
                <td><Link to={`/accounts/${account.account_id}`}>{account.name}</Link></td>
                <td><code>{account.account_id}</code></td>
                <td>{accountEnvironmentLabel(account.environment)}</td>
                <td>{account.created_at ? formatUTCWithLocal(account.created_at) : "-"}</td>
                <td>{account.description?.trim() || "-"}</td>
                {returnTo ? (
                  <td>
                    <button
                      type="button"
                      onClick={() => navigate(appendReturnParam(returnTo, "account_id", account.account_id), { replace: true })}
                    >
                      Use
                    </button>
                  </td>
                ) : null}
              </>
            )}
          />
        ) : (
          <AccountNew
            embedded
            onCreated={(account) => {
              if (returnTo) {
                navigate(appendReturnParam(returnTo, "account_id", account.account_id), { replace: true });
                return;
              }
              setNotice(`Account ${account.account_id} created.`);
              setRefreshKey((v) => v + 1);
              changeTab("accounts", { clearMessages: false });
            }}
          />
        )}
      </PageTabs>
    </div>
  );
}
