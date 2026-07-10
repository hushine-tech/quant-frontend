import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import PageTabs, { type PageTab } from "@/components/PageTabs";
import {
  confirmNotificationBinding,
  createNotificationBindCode,
  getNotificationSettings,
  sendTestNotification,
  unbindNotificationTelegram,
  updateNotificationPreferences,
  type NotificationBindCode,
  type NotificationPreferences,
  type NotificationSettings,
} from "@/api/client";
import { formatUTCWithLocal } from "@/utils/time";

type NotificationTab = "overview" | "telegram" | "preferences" | "delivery";

const tabs: Array<PageTab<NotificationTab>> = [
  { id: "overview", label: "Overview" },
  { id: "telegram", label: "Telegram Binding" },
  { id: "preferences", label: "Preferences" },
  { id: "delivery", label: "Delivery Status" },
];

function fmtTime(value?: string): string {
  return value ? formatUTCWithLocal(value) : "-";
}

function channelLabel(status?: string): string {
  switch ((status || "").toLowerCase()) {
    case "bound":
      return "Bound";
    case "pending":
      return "Pending";
    case "revoked":
      return "Revoked";
    case "unbound":
      return "Unbound";
    default:
      return status || "Unknown";
  }
}

function badgeClass(status?: string): string {
  return (status || "").toLowerCase() === "bound"
    ? "status-badge status-badge--completed"
    : "status-badge status-badge--stopped";
}

function boolText(value: boolean): string {
  return value ? "Yes" : "No";
}

export default function NotificationManagement() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [bindCode, setBindCode] = useState<NotificationBindCode | null>(null);
  const [activeTab, setActiveTab] = useState<NotificationTab>("overview");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setSettings(await getNotificationSettings());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load notification settings failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function savePreferences(next: NotificationPreferences) {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      setSettings(await updateNotificationPreferences(next));
      setNotice("Notification preferences saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save notification preferences failed");
    } finally {
      setSaving(false);
    }
  }

  async function createBind() {
    setBusy("bind");
    setError(null);
    setNotice(null);
    try {
      const code = await createNotificationBindCode();
      setBindCode(code);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create bind code failed");
    } finally {
      setBusy(null);
    }
  }

  async function confirmBind() {
    setBusy("confirm");
    setError(null);
    setNotice(null);
    try {
      const confirmed = await confirmNotificationBinding();
      setSettings(confirmed);
      if ((confirmed.telegram?.status || "").toLowerCase() !== "bound") {
        throw new Error("Telegram binding is still pending. Send the latest bind code to the bot, then try again.");
      }
      setBindCode(null);
      setNotice("Telegram binding confirmed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Confirm binding failed");
    } finally {
      setBusy(null);
    }
  }

  async function unbind() {
    if (!window.confirm("Unbind Telegram notifications?")) return;
    setBusy("unbind");
    setError(null);
    setNotice(null);
    try {
      setSettings(await unbindNotificationTelegram());
      setBindCode(null);
      setNotice("Telegram notifications unbound.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbind failed");
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    setBusy("test");
    setError(null);
    setNotice(null);
    try {
      const result = await sendTestNotification();
      setSettings(result.settings);
      setNotice(result.accepted ? "Test notification accepted." : "Test notification was not accepted.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send test notification failed");
    } finally {
      setBusy(null);
    }
  }

  const preferences = settings?.preferences;
  const plan = settings?.plan;
  const telegram = settings?.telegram;
  const notificationEnabled = !!plan?.notification_enabled;
  const userNotificationsEnabled = preferences?.enabled !== false;
  const telegramStatus = (telegram?.status || "").toLowerCase();
  const channelBound = telegramStatus === "bound";
  const botUsername = bindCode?.bot_username || settings?.bot_username || "";
  const botHref = botUsername ? `https://t.me/${botUsername.replace(/^@/, "")}` : "";
  const deliveryBlockedReason = useMemo(() => {
    if (!settings) {
      return "";
    }
    if (!notificationEnabled) {
      return "Notification delivery is disabled by the current plan.";
    }
    if (!userNotificationsEnabled) {
      return "Notification delivery is disabled by the user switch.";
    }
    if (!plan?.allow_strategy) {
      return "Order and strategy Telegram delivery is blocked by the current plan.";
    }
    if (!preferences?.strategy_enabled) {
      return "Order and strategy Telegram delivery is disabled in preferences.";
    }
    if (!channelBound) {
      const bot = botUsername ? `@${botUsername.replace(/^@/, "")}` : "the Telegram bot";
      if (telegramStatus === "pending") {
        return `Order and strategy Telegram delivery is blocked until the Telegram channel is bound. Send the latest bind code to ${bot}, then confirm binding.`;
      }
      return "Order and strategy Telegram delivery is blocked until the Telegram channel is bound. Generate a bind code before expecting order alerts.";
    }
    return "";
  }, [botUsername, channelBound, notificationEnabled, plan, preferences, settings, telegramStatus, userNotificationsEnabled]);
  const availability = useMemo(() => {
    return [
      {
        key: "system_enabled" as const,
        label: "System",
        description: "Runtime, platform, and account status notifications.",
        planAllowed: notificationEnabled && !!plan?.allow_system,
        userEnabled: userNotificationsEnabled && !!preferences?.system_enabled,
        channelBound,
      },
      {
        key: "strategy_enabled" as const,
        label: "Strategy",
        description: "Strategy session, order, and execution result notifications.",
        planAllowed: notificationEnabled && !!plan?.allow_strategy,
        userEnabled: userNotificationsEnabled && !!preferences?.strategy_enabled,
        channelBound,
      },
      {
        key: "custom_enabled" as const,
        label: "Custom",
        description: "Messages sent by strategy code through self.notify.",
        planAllowed: notificationEnabled && !!plan?.allow_custom,
        userEnabled: userNotificationsEnabled && !!preferences?.custom_enabled,
        channelBound,
      },
    ];
  }, [channelBound, notificationEnabled, plan, preferences, userNotificationsEnabled]);

  return (
    <div>
      <PageHeader
        title="Notification Management"
        description="Telegram delivery for runtime, strategy, order, and custom strategy messages."
        loading={loading}
        onRefresh={load}
      />

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="env-banner env-banner--backtest">{notice}</p> : null}
      {deliveryBlockedReason ? <p className="env-banner env-banner--demo">{deliveryBlockedReason}</p> : null}
      {loading ? <p className="muted">Loading notification settings...</p> : null}

      {settings ? (
        <PageTabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} ariaLabel="Notification sections">
          {activeTab === "overview" ? (
            <section className="card">
              <h2 className="section-title" style={{ marginTop: 0 }}>Overview</h2>
              <div className="runtime-detail-grid">
                <div>
                  <p className="muted">Plan</p>
                  <p>{plan?.plan_code || "-"}</p>
                </div>
                <div>
                  <p className="muted">Notification</p>
                  <p>{notificationEnabled ? "Enabled" : "Disabled"}</p>
                </div>
                <div>
                  <p className="muted">User switch</p>
                  <p>{userNotificationsEnabled ? "On" : "Off"}</p>
                </div>
                <div>
                  <p className="muted">Telegram</p>
                  <p>{channelLabel(telegram?.status)}</p>
                </div>
                <div>
                  <p className="muted">Custom limit</p>
                  <p>{plan?.custom_rate_limit_per_minute || 0}/min, burst {plan?.custom_rate_limit_burst || 0}</p>
                </div>
              </div>

              <div className="notification-availability">
                <div className="notification-availability__header">
                  <span>Category</span>
                  <span>Plan allowed</span>
                  <span>User enabled</span>
                  <span>Channel bound</span>
                </div>
                {availability.map((row) => (
                  <div key={row.key} className="notification-availability__row">
                    <span>{row.label}</span>
                    <span>{boolText(row.planAllowed)}</span>
                    <span>{boolText(row.userEnabled)}</span>
                    <span>{boolText(row.channelBound)}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {activeTab === "telegram" ? (
            <section className="card">
              <div className="page-heading" style={{ marginBottom: "0.75rem" }}>
                <div>
                  <h2 className="section-title" style={{ marginTop: 0 }}>Telegram Binding</h2>
                  <p className="muted">Current bot: {botUsername ? <a href={botHref} target="_blank" rel="noreferrer">@{botUsername.replace(/^@/, "")}</a> : "-"}</p>
                </div>
                <span className={badgeClass(telegram?.status)}>{channelLabel(telegram?.status)}</span>
              </div>

              <div className="runtime-detail-grid">
                <div>
                  <p className="muted">Recipient</p>
                  <p>{telegram?.provider_display_name || telegram?.provider_username || "-"}</p>
                </div>
                <div>
                  <p className="muted">Bound at</p>
                  <p>{fmtTime(telegram?.bound_at)}</p>
                </div>
              </div>

              <div className="notification-bind-code">
                <p className="muted">Generate a code, send it to the Telegram bot, then confirm binding here.</p>
                {bindCode ? (
                  <>
                    <code>{bindCode.bind_code}</code>
                    <p className="muted">Expires at {fmtTime(bindCode.expires_at)}</p>
                  </>
                ) : (
                  <p className="muted">No active bind code.</p>
                )}
              </div>

              <div className="notification-actions">
                <button type="button" className="primary" onClick={() => void createBind()} disabled={busy === "bind"}>
                  {telegram?.status === "bound" ? "Generate rebind code" : "Generate bind code"}
                </button>
                <button type="button" onClick={() => void confirmBind()} disabled={busy === "confirm"}>
                  Confirm binding
                </button>
                <button type="button" className="danger" onClick={() => void unbind()} disabled={busy === "unbind" || telegram?.status !== "bound"}>
                  Unbind
                </button>
              </div>
            </section>
          ) : null}

          {activeTab === "preferences" ? (
            <section className="card">
              <h2 className="section-title" style={{ marginTop: 0 }}>Preferences</h2>
              <div className="notification-toggle-grid">
                <label className="notification-toggle">
                  <span className="notification-toggle__heading">
                    <input
                      type="checkbox"
                      checked={userNotificationsEnabled}
                      disabled={saving || !notificationEnabled}
                      onChange={(e) => {
                        if (!preferences) return;
                        void savePreferences({ ...preferences, enabled: e.target.checked });
                      }}
                    />
                    <span className="notification-toggle__title">All notifications</span>
                  </span>
                  <span className="notification-toggle__description">
                    {!notificationEnabled ? "Plan disabled. " : ""}Master switch for all Telegram notification delivery.
                  </span>
                </label>
                {availability.map((row) => (
                  <label key={row.key} className="notification-toggle">
                    <span className="notification-toggle__heading">
                      <input
                        type="checkbox"
                        checked={!!preferences?.[row.key]}
                        disabled={saving || !row.planAllowed}
                        onChange={(e) => {
                          if (!preferences) return;
                          void savePreferences({ ...preferences, [row.key]: e.target.checked });
                        }}
                      />
                      <span className="notification-toggle__title">{row.label}</span>
                    </span>
                    <span className="notification-toggle__description">
                      {!row.planAllowed ? "Plan disabled. " : ""}{row.description}
                    </span>
                  </label>
                ))}
              </div>
            </section>
          ) : null}

          {activeTab === "delivery" ? (
            <section className="card">
              <h2 className="section-title" style={{ marginTop: 0 }}>Delivery Status</h2>
              <div className="runtime-detail-grid">
                <div>
                  <p className="muted">Last delivery</p>
                  <p>{telegram?.last_delivery_status || "-"}</p>
                </div>
                <div>
                  <p className="muted">Last delivery time</p>
                  <p>{fmtTime(telegram?.last_delivery_at)}</p>
                </div>
                <div>
                  <p className="muted">Last error</p>
                  <p>{telegram?.last_delivery_error || "-"}</p>
                </div>
                <div>
                  <p className="muted">Effective channel</p>
                  <p>{channelBound && notificationEnabled && userNotificationsEnabled ? "Ready" : "Not ready"}</p>
                </div>
              </div>

              <div className="notification-actions">
                <button
                  type="button"
                  className="primary"
                  onClick={() => void sendTest()}
                  disabled={busy === "test" || !channelBound || !notificationEnabled || !userNotificationsEnabled}
                >
                  Send test message
                </button>
              </div>
            </section>
          ) : null}
        </PageTabs>
      ) : null}
    </div>
  );
}
