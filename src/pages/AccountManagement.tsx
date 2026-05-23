import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { listAccounts, type Account } from "@/api/client";
import PageHeader from "@/components/PageHeader";
import PageTabs, { type PageTab } from "@/components/PageTabs";
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

export default function AccountManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<AccountTab>(() => normalizeTab(searchParams.get("tab")));
  const [rows, setRows] = useState<Account[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      setRows(await listAccounts());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

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

  return (
    <div>
      <PageHeader
        title="Account Management"
        description={description}
        loading={loading}
        onRefresh={activeTab === "accounts" ? load : undefined}
      />
      {err ? <p className="error">{err}</p> : null}
      <PageTabs tabs={tabs} activeTab={activeTab} onChange={changeTab} ariaLabel="Account sections">
        {activeTab === "accounts" ? (
          <>
            {loading ? <p className="muted">Loading accounts...</p> : null}
            {!loading && rows.length === 0 ? <p className="muted">No accounts yet.</p> : null}
            {rows.length > 0 ? (
              <div className="table-scroll">
                <table className="compact full-width-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>ID</th>
                      <th>Mode</th>
                      <th>Created</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((account) => (
                      <tr key={account.account_id}>
                        <td>{account.name}</td>
                        <td><code>{account.account_id}</code></td>
                        <td>{account.mode}</td>
                        <td>{account.created_at ? formatUTCWithLocal(account.created_at) : "-"}</td>
                        <td><Link to={`/accounts/${account.account_id}`}>View</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : (
          <AccountNew
            embedded
            onCreated={() => {
              void load();
              changeTab("accounts");
            }}
          />
        )}
      </PageTabs>
    </div>
  );
}
