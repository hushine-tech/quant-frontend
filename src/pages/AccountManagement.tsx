import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { listAccountsPage, type Account } from "@/api/client";
import PageHeader from "@/components/PageHeader";
import PageTabs, { type PageTab } from "@/components/PageTabs";
import InfiniteTable from "@/components/InfiniteTable";
import AccountNew from "@/pages/AccountNew";
import { formatUTCWithLocal } from "@/utils/time";

type AccountTab = "accounts" | "create";

const tabs: Array<PageTab<AccountTab>> = [
  { id: "accounts", label: "Accounts" },
  { id: "create", label: "Create Account" },
];

function normalizeTab(value: string | null): AccountTab {
  return value === "create" ? "create" : "accounts";
}

function modeLabel(mode: number): string {
  switch (mode) {
    case 0:
      return "Backtest";
    case 1:
      return "Binance Live";
    case 2:
      return "Binance Testnet";
    default:
      return `Mode ${mode}`;
  }
}

export default function AccountManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<AccountTab>(() => normalizeTab(searchParams.get("tab")));
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setActiveTab(normalizeTab(searchParams.get("tab")));
  }, [searchParams]);

  function changeTab(tab: AccountTab) {
    setActiveTab(tab);
    setSearchParams(tab === "accounts" ? {} : { tab });
  }

  const description = useMemo(() => {
    return activeTab === "accounts"
      ? "Manage backtest, testnet, and live account contexts."
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
        {activeTab === "accounts" ? (
          <InfiniteTable<Account>
            columns={["Name", "ID", "Mode", "Created", "Description"]}
            refreshKey={refreshKey}
            emptyText="No accounts yet."
            loadPage={loadAccounts}
            rowKey={(account) => String(account.account_id)}
            renderRow={(account) => (
              <>
                <td><Link to={`/accounts/${account.account_id}`}>{account.name}</Link></td>
                <td><code>{account.account_id}</code></td>
                <td>{modeLabel(account.mode)}</td>
                <td>{account.created_at ? formatUTCWithLocal(account.created_at) : "-"}</td>
                <td>{account.description?.trim() || "-"}</td>
              </>
            )}
          />
        ) : (
          <AccountNew
            embedded
            onCreated={() => {
              setRefreshKey((v) => v + 1);
              changeTab("accounts");
            }}
          />
        )}
      </PageTabs>
    </div>
  );
}
