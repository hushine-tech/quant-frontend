import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Building2 } from "lucide-react";
import {
  archiveVenue,
  createVenue,
  listVenues,
  releaseVenue,
  type CreateVenuePayload,
  type Venue,
} from "@/api/client";
import InfiniteTable from "@/components/InfiniteTable";
import PageHeader from "@/components/PageHeader";
import PageTabs, { type PageTab } from "@/components/PageTabs";
import { formatUTCWithLocal } from "@/utils/time";

type VenueTab = "venues" | "create";

const tabs: Array<PageTab<VenueTab>> = [
  { id: "venues", label: "Venues" },
  { id: "create", label: "Create Venue" },
];

function normalizeVenueTab(value: string | null): VenueTab {
  return value === "create" ? "create" : "venues";
}

function label(value?: string, fallback?: number): string {
  return value || (fallback == null ? "-" : String(fallback));
}

function maskAPIKey(value?: string): string {
  if (!value) return "-";
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export default function VenueManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<VenueTab>(() => normalizeVenueTab(searchParams.get("tab")));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  function changeTab(tab: VenueTab) {
    setActiveTab(tab);
    const next: Record<string, string> = {};
    if (tab !== "venues") next.tab = tab;
    const accountID = searchParams.get("account_id");
    if (accountID) next.account_id = accountID;
    setSearchParams(next);
  }

  const accountFilter = searchParams.get("account_id") || undefined;

  const loadVenues = useCallback(async (offset: number, limit: number) => {
    setLoading(true);
    setError(null);
    try {
      return await listVenues({
        offset,
        limit,
        include_inactive: true,
        include_unbound: true,
        account_id: accountFilter,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load venues failed");
      throw e;
    } finally {
      setLoading(false);
    }
  }, [accountFilter]);

  async function handleRelease(venue: Venue) {
    setError(null);
    setNotice(null);
    try {
      await releaseVenue(venue.venue_id, "released from venue management");
      setNotice("Venue released.");
      setRefreshKey((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Release venue failed");
    }
  }

  async function handleArchive(venue: Venue) {
    setError(null);
    setNotice(null);
    try {
      await archiveVenue(venue.venue_id, "archived from venue management");
      setNotice("Venue archived.");
      setRefreshKey((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Archive venue failed");
    }
  }

  const description = useMemo(() => {
    return activeTab === "venues"
      ? "Manage exchange venues, credentials, and account bindings."
      : "Create a concrete exchange venue and bind it to an account.";
  }, [activeTab]);

  return (
    <div>
      <PageHeader
        title="Venue Management"
        description={description}
        loading={loading}
        onRefresh={activeTab === "venues" ? () => setRefreshKey((v) => v + 1) : undefined}
      />
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="success">{notice}</p> : null}
      <PageTabs tabs={tabs} activeTab={activeTab} onChange={changeTab} ariaLabel="Venue sections">
        {activeTab === "venues" ? (
          <InfiniteTable<Venue>
            columns={["Name", "Account", "Exchange", "Market", "Environment", "Status", "API Key", "Created", "Action"]}
            refreshKey={`${refreshKey}:${accountFilter || ""}`}
            emptyText="No venues yet."
            loadPage={loadVenues}
            rowKey={(venue) => String(venue.venue_id)}
            renderRow={(venue) => (
              <>
                <td>
                  <strong>{venue.display_name || `venue-${venue.venue_id}`}</strong>
                  <div className="muted"><code>{venue.venue_id}</code></div>
                </td>
                <td>{venue.account_id || "-"}</td>
                <td>{label(venue.exchange_label, venue.exchange)}</td>
                <td>{label(venue.market_label, venue.market)}</td>
                <td>{label(venue.environment_label, venue.environment)}</td>
                <td>
                  <span className={venue.status_label === "active" ? "status-badge status-badge--completed" : "status-badge status-badge--stopped"}>
                    {label(venue.status_label, venue.status)}
                  </span>
                </td>
                <td><code>{maskAPIKey(venue.api_key)}</code></td>
                <td>{venue.created_at ? formatUTCWithLocal(venue.created_at) : "-"}</td>
                <td>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    {venue.account_id ? (
                      <button type="button" onClick={() => void handleRelease(venue)}>Release</button>
                    ) : null}
                    {!venue.archived_at ? (
                      <button type="button" onClick={() => void handleArchive(venue)}>Archive</button>
                    ) : null}
                  </div>
                </td>
              </>
            )}
          />
        ) : (
          <CreateVenueForm
            defaultAccountID={accountFilter || ""}
            onCreated={() => {
              setNotice("Venue created.");
              setRefreshKey((v) => v + 1);
              changeTab("venues");
            }}
          />
        )}
      </PageTabs>
    </div>
  );
}

function CreateVenueForm({
  defaultAccountID,
  onCreated,
}: {
  defaultAccountID: string;
  onCreated: () => void;
}) {
  const [accountID, setAccountID] = useState(defaultAccountID);
  const [exchange, setExchange] = useState<CreateVenuePayload["exchange"]>("binance");
  const [market, setMarket] = useState<CreateVenuePayload["market"]>("perpetual_futures");
  const [environment, setEnvironment] = useState<CreateVenuePayload["environment"]>("demo");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [apiKey, setAPIKey] = useState("");
  const [apiSecret, setAPISecret] = useState("");
  const [marginMode, setMarginMode] = useState<NonNullable<CreateVenuePayload["margin_mode"]>>("cross");
  const [positionMode, setPositionMode] = useState<NonNullable<CreateVenuePayload["position_mode"]>>("one_way");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSpot = market === "spot";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey.trim() || !apiSecret.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createVenue({
        account_id: accountID ? Number(accountID) : undefined,
        exchange,
        market,
        environment,
        display_name: displayName.trim() || `${exchange}-${environment}-${market}`,
        description: description.trim(),
        api_key: apiKey.trim(),
        credential_info: { api_key: apiKey.trim(), api_secret: apiSecret.trim() },
        margin_mode: isSpot ? "none" : marginMode,
        position_mode: isSpot ? "none" : positionMode,
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create venue failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem" }}>
        <Building2 size={18} aria-hidden="true" />
        <p style={{ fontWeight: 600, margin: 0 }}>Create Venue</p>
      </div>
      <form className="strategy-new-form" onSubmit={handleSubmit}>
        <div className="strategy-new-form__row-2">
          <label className="field">
            <span>Account ID</span>
            <input
              type="number"
              min="1"
              value={accountID}
              onChange={(e) => setAccountID(e.target.value)}
              placeholder="Optional account ID"
            />
          </label>
          <label className="field">
            <span>Display name</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="binance demo perp"
            />
          </label>
        </div>
        <div className="strategy-new-form__row-2">
          <label className="field">
            <span>Exchange</span>
            <select value={exchange} onChange={(e) => setExchange(e.target.value as CreateVenuePayload["exchange"])}>
              <option value="binance">Binance</option>
              <option value="okx">OKX</option>
            </select>
          </label>
          <label className="field">
            <span>Environment</span>
            <select value={environment} onChange={(e) => setEnvironment(e.target.value as CreateVenuePayload["environment"])}>
              <option value="demo">Demo</option>
              <option value="live">Live</option>
            </select>
          </label>
        </div>
        <div className="strategy-new-form__row-2">
          <label className="field">
            <span>Market</span>
            <select value={market} onChange={(e) => setMarket(e.target.value as CreateVenuePayload["market"])}>
              <option value="spot">Spot</option>
              <option value="perpetual_futures">Perpetual futures</option>
              <option value="delivery_futures">Delivery futures</option>
            </select>
          </label>
          <label className="field">
            <span>Description</span>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional note"
            />
          </label>
        </div>
        {!isSpot ? (
          <div className="strategy-new-form__row-2">
            <label className="field">
              <span>Margin mode</span>
              <select value={marginMode} onChange={(e) => setMarginMode(e.target.value as NonNullable<CreateVenuePayload["margin_mode"]>)}>
                <option value="cross">Cross</option>
                <option value="isolated">Isolated</option>
              </select>
            </label>
            <label className="field">
              <span>Position mode</span>
              <select value={positionMode} onChange={(e) => setPositionMode(e.target.value as NonNullable<CreateVenuePayload["position_mode"]>)}>
                <option value="one_way">One-way</option>
                <option value="hedge">Hedge</option>
              </select>
            </label>
          </div>
        ) : null}
        <div className="strategy-new-form__row-2">
          <label className="field">
            <span>API key</span>
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setAPIKey(e.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>API secret</span>
            <input
              type="password"
              value={apiSecret}
              onChange={(e) => setAPISecret(e.target.value)}
              required
            />
          </label>
        </div>
        {error ? <p className="error">{error}</p> : null}
        <p style={{ marginTop: "0.75rem" }}>
          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? "Creating…" : "Create Venue"}
          </button>
        </p>
      </form>
    </div>
  );
}
