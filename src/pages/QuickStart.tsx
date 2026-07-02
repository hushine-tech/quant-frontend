import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Circle, CircleDashed, ExternalLink } from "lucide-react";
import {
  getAccount,
  getRuntime,
  getStrategy,
  listAccountVenues,
  listRuntimes,
  type Account,
  type Runtime,
  type Strategy,
  type Venue,
} from "@/api/client";
import PageHeader from "@/components/PageHeader";
import { accountEnvironmentLabel } from "@/utils/accountEnvironment";

type StepId = "account" | "venue" | "strategy" | "runtime" | "start";

type StepDefinition = {
  id: StepId;
  title: string;
};

const STEP_DEFINITIONS: StepDefinition[] = [
  { id: "account", title: "Account" },
  { id: "venue", title: "Venue" },
  { id: "strategy", title: "Strategy" },
  { id: "runtime", title: "Runtime" },
  { id: "start", title: "Start" },
];

function routeWithParams(pathname: string, params: Record<string, string | number | undefined | null>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value) !== "") {
      qs.set(key, String(value));
    }
  }
  const suffix = qs.toString();
  return suffix ? `${pathname}?${suffix}` : pathname;
}

function venueEnvironmentParam(environment: number | undefined): string | undefined {
  switch (environment) {
    case 0:
      return "backtest";
    case 1:
      return "demo";
    case 2:
      return "live";
    default:
      return undefined;
  }
}

function runtimeLabel(runtime: Runtime | null, runtimeId: string | null): string {
  if (!runtimeId) return "Choose a routeable executor runtime.";
  if (!runtime) return `Runtime #${runtimeId}`;
  const source = runtime.source === "self_hosted" ? "self-hosted" : runtime.source;
  return `${runtime.name || runtime.runtime_id} · ${source} · ${runtime.status || "unknown"}`;
}

function stepIcon(state: "ready" | "active" | "waiting") {
  if (state === "ready") return <CheckCircle2 size={18} aria-hidden="true" />;
  if (state === "active") return <CircleDashed size={18} aria-hidden="true" />;
  return <Circle size={18} aria-hidden="true" />;
}

function ActionLink({
  href,
  children,
}: {
  href?: string | null;
  children: ReactNode;
}) {
  if (!href) {
    return (
      <span className="button-link button-link--disabled" aria-disabled="true">
        {children}
      </span>
    );
  }
  return (
    <Link className="button-link button-link--primary" to={href}>
      {children}
      <ExternalLink size={15} aria-hidden="true" />
    </Link>
  );
}

export default function QuickStart() {
  const [searchParams] = useSearchParams();
  const accountId = searchParams.get("account_id");
  const venueId = searchParams.get("venue_id");
  const strategyId = searchParams.get("strategy_id");
  const runtimeId = searchParams.get("runtime_id");

  const [account, setAccount] = useState<Account | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [hasRouteableRuntime, setHasRouteableRuntime] = useState<boolean | null>(null);
  const [error, setError] = useState("");

  const quickStartReturnTo = useCallback(
    (override: Record<string, string | number | undefined | null> = {}) => {
      const merged = {
        account_id: accountId,
        venue_id: venueId,
        strategy_id: strategyId,
        runtime_id: runtimeId,
        ...override,
      };
      return routeWithParams("/quick-start", merged);
    },
    [accountId, runtimeId, strategyId, venueId],
  );

  useEffect(() => {
    let alive = true;
    setAccount(null);
    setVenues([]);
    if (!accountId) return;
    void Promise.all([getAccount(accountId), listAccountVenues(accountId, { limit: 100 })])
      .then(([acc, venuePage]) => {
        if (!alive) return;
        setAccount(acc);
        setVenues(venuePage.items ?? []);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [accountId]);

  useEffect(() => {
    let alive = true;
    setStrategy(null);
    if (!strategyId) return;
    void getStrategy(strategyId)
      .then((item) => {
        if (alive) setStrategy(item);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [strategyId]);

  useEffect(() => {
    let alive = true;
    setRuntime(null);
    if (!runtimeId) return;
    void getRuntime(runtimeId)
      .then((item) => {
        if (alive) setRuntime(item);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [runtimeId]);

  useEffect(() => {
    let alive = true;
    setHasRouteableRuntime(null);
    if (!account || !venueId || !strategyId || runtimeId) return;
    void listRuntimes({
      limit: 1,
      eligible: "session_start",
      role: "executor",
      environment: account.environment,
    })
      .then((result) => {
        if (alive) setHasRouteableRuntime((result.runtimes ?? []).length > 0);
      })
      .catch(() => {
        if (alive) setHasRouteableRuntime(null);
      });
    return () => {
      alive = false;
    };
  }, [account, runtimeId, strategyId, venueId]);

  const selectedVenue = useMemo(
    () => venues.find((venue) => String(venue.venue_id) === String(venueId)) ?? null,
    [venueId, venues],
  );
  const suggestedVenue = useMemo(
    () => venues.find((venue) => venue.status === 1) ?? venues[0] ?? null,
    [venues],
  );
  const accountReady = Boolean(accountId && account);
  const accountContextLoaded = !accountId || accountReady;
  const venueStepNeedsCreate = accountReady && !suggestedVenue && !venueId;

  const activeStep: StepId = !accountReady
    ? "account"
    : !venueId
      ? "venue"
      : !strategyId
        ? "strategy"
        : !runtimeId
          ? "runtime"
          : "start";

  const accountHref = routeWithParams("/accounts", {
    return_to: quickStartReturnTo({ account_id: null, venue_id: null, strategy_id: null, runtime_id: null }),
  });
  const venueHref = accountReady
    ? routeWithParams("/venues", {
        tab: venueStepNeedsCreate ? "create" : undefined,
        account_id: accountId,
        environment: venueEnvironmentParam(account?.environment),
        return_to: quickStartReturnTo({ venue_id: null, strategy_id: null, runtime_id: null }),
      })
    : null;
  const strategyHref = accountReady && venueId
    ? routeWithParams(`/accounts/${accountId}`, {
        tab: "run",
        return_to: quickStartReturnTo({ strategy_id: null, runtime_id: null }),
      })
    : null;
  const runtimeHref = accountReady && venueId && strategyId
    ? routeWithParams("/runtimes", {
        tab: hasRouteableRuntime === false ? "create" : undefined,
        eligible: "session_start",
        role: "executor",
        environment: account?.environment,
        return_to: quickStartReturnTo({ runtime_id: null }),
      })
    : null;
  const startHref = accountReady && venueId && strategyId && runtimeId
    ? routeWithParams(`/accounts/${accountId}`, {
        tab: "run",
        runtime_id: runtimeId,
        return_to: quickStartReturnTo(),
      })
    : null;

  const ready: Record<StepId, boolean> = {
    account: accountReady,
    venue: accountReady && Boolean(venueId),
    strategy: accountReady && Boolean(venueId && strategyId),
    runtime: accountReady && Boolean(venueId && strategyId && runtimeId),
    start: accountReady && Boolean(venueId && strategyId && runtimeId),
  };

  return (
    <section>
      <PageHeader
        title="Quick Start"
        description="Use the existing management pages to finish each setup step, then return here to continue."
      />

      {error ? <div className="error">Quick Start context failed to load: {error}</div> : null}

      <div className="quick-start-grid">
        <nav className="quick-start-steps" aria-label="Quick start progress">
          {STEP_DEFINITIONS.map((step) => {
            const state = ready[step.id] ? "ready" : activeStep === step.id ? "active" : "waiting";
            return (
              <div
                key={step.id}
                className={`quick-start-step quick-start-step--${state}`}
                aria-current={activeStep === step.id ? "step" : undefined}
              >
                {stepIcon(state)}
                <span>{step.title}</span>
              </div>
            );
          })}
        </nav>

        <div className="quick-start-shell">
          <section className="quick-start-card">
            <div className="quick-start-card__head">
              <div>
                <h2>1. Account</h2>
                <p>{accountId ? `${account?.name ?? "Account"} #${accountId}` : "No account selected."}</p>
              </div>
              {account ? <span className="quick-start-pill">{accountEnvironmentLabel(account.environment)}</span> : null}
            </div>
            <div className="quick-start-actions">
              <ActionLink href={accountHref}>Open Account Management</ActionLink>
            </div>
          </section>

          <section className="quick-start-card">
            <div className="quick-start-card__head">
              <div>
                <h2>2. Venue</h2>
                <p>
                  {selectedVenue
                    ? `${selectedVenue.display_name} #${selectedVenue.venue_id} · ${selectedVenue.exchange_label ?? "exchange"} · ${selectedVenue.market_label ?? "market"}`
                    : venueId
                      ? `Venue #${venueId}`
                    : suggestedVenue
                      ? `Available default: ${suggestedVenue.display_name} #${suggestedVenue.venue_id}`
                      : accountId && accountContextLoaded
                        ? "No venue yet. Create one in Venue Management."
                        : "No venue selected."}
                </p>
              </div>
            </div>
            <div className="quick-start-actions">
              <ActionLink href={venueHref}>
                {venueStepNeedsCreate ? "Create Venue in Venue Management" : "Open Venue Management"}
              </ActionLink>
            </div>
          </section>

          <section className="quick-start-card">
            <div className="quick-start-card__head">
              <div>
                <h2>3. Strategy</h2>
                <p>
                  {strategyId
                    ? `${strategy?.name ?? "Strategy"} ${strategy?.version ? `v${strategy.version}` : ""} #${strategyId}`
                    : "No strategy selected."}
                </p>
              </div>
            </div>
            <div className="quick-start-actions">
              <ActionLink href={strategyHref}>Open Account Strategy</ActionLink>
            </div>
          </section>

          <section className="quick-start-card">
            <div className="quick-start-card__head">
              <div>
                <h2>4. Runtime</h2>
                <p>
                  {runtimeId
                    ? runtimeLabel(runtime, runtimeId)
                    : hasRouteableRuntime === false
                      ? "No routeable executor runtime yet. Create one in Runtime Management."
                      : runtimeLabel(runtime, runtimeId)}
                </p>
              </div>
            </div>
            <div className="quick-start-actions">
              <ActionLink href={runtimeHref}>
                {hasRouteableRuntime === false ? "Create Runtime in Runtime Management" : "Open Runtime Management"}
              </ActionLink>
            </div>
          </section>

          <section className="quick-start-card">
            <div className="quick-start-card__head">
              <div>
                <h2>5. Start</h2>
                <p>{ready.start ? "Ready to open the account run page." : "Complete the previous steps first."}</p>
              </div>
            </div>
            <div className="quick-start-actions">
              <ActionLink href={startHref}>Open Account Run Strategy</ActionLink>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
