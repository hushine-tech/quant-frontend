import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  listRuntimes,
  runtimeSelectionOptions,
  type Runtime,
} from "@/api/client";

type RuntimeSelectorProps = {
  value: string;
  onChange: (runtimeId: string, runtime?: Runtime) => void;
  mode?: number;
  role?: "executor" | "debugger";
  eligible?: string;
  disabled?: boolean;
  compact?: boolean;
  label?: string;
};

export default function RuntimeSelector({
  value,
  onChange,
  mode,
  role,
  eligible = "session_start",
  disabled = false,
  compact = false,
  label = "Runtime",
}: RuntimeSelectorProps) {
  const [runtimes, setRuntimes] = useState<Runtime[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await listRuntimes({
          limit: 100,
          eligible,
          role,
          mode,
        });
        if (!cancelled) setRuntimes(result.runtimes);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Load runtimes failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [eligible, mode, role]);

  const options = useMemo(() => runtimeSelectionOptions(runtimes), [runtimes]);
  const routeable = useMemo(() => options.filter((o) => o.routeable), [options]);

  useEffect(() => {
    if (loading || error) return;
    if (!value) return;
    const selected = options.find((o) => o.runtime_id === value);
    if (selected?.routeable) return;
    onChange("");
  }, [error, loading, onChange, options, routeable, value]);

  const selectedRuntime = routeable.find((o) => o.runtime_id === value)?.runtime;
  const noRouteable = !loading && routeable.length === 0;
  const selectedSource = selectedRuntime?.source === "self_hosted"
    ? "self-hosted"
    : selectedRuntime?.source || "source n/a";

  return (
    <div className={compact ? "runtime-selector runtime-selector--compact" : "runtime-selector"}>
      <label>
        <span>{label}</span>
        <select
          value={value}
          disabled={disabled || loading || noRouteable}
          onChange={(e) => {
            const next = e.target.value;
            const opt = routeable.find((o) => o.runtime_id === next);
            onChange(next, opt?.runtime);
          }}
        >
          <option value="">
            {loading ? "Loading runtimes..." : noRouteable ? "No routeable runtime" : "Select runtime"}
          </option>
          {routeable.map((opt) => (
            <option key={opt.runtime_id} value={opt.runtime_id}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      {error ? <p className="error">{error}</p> : null}
      {!error && !loading && routeable.length > 0 && !selectedRuntime ? (
        <p className="muted runtime-selector__meta">Select an execution runtime before starting.</p>
      ) : null}
      {!error && selectedRuntime ? (
        <p className="muted runtime-selector__meta">
          <Link to={`/runtimes/${encodeURIComponent(selectedRuntime.runtime_id)}`}>
            {selectedRuntime.runtime_id}
          </Link>
          {" · "}
          {selectedRuntime.status || "unknown"}
          {" · "}
          {selectedSource}
        </p>
      ) : null}
      {!error && noRouteable ? (
        <p className="muted runtime-selector__meta">
          <Link to="/runtimes">Open Runtime Management</Link>
        </p>
      ) : null}
    </div>
  );
}
