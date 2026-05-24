// Phase D3: Settings → Runtime Credentials page.
//
// User flow:
//   1. List shows the user's active credentials (label, key_id, created_at,
//      last_used_at).
//   2. "Generate new credential" prompts for an optional label, calls
//      Issue, and triggers an immediate download of a JSON file
//      `hushine-runtime-credential-<keyid>.cred` containing
//      {version, key_id, private_key_pem}. The private key is shown once,
//      then the in-memory state is cleared. There is no "show again" path.
//   3. "Revoke" requires a confirmation; on success the row is removed
//      from the default list only when the user hides inactive credentials.
//
// Security note: the private key MUST never be persisted in browser
// storage (localStorage / sessionStorage / IndexedDB). It lives in
// component state until either downloaded or the user navigates away.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  listRuntimeCredentialsPage,
  issueRuntimeCredential,
  listRuntimeAdmissionFailures,
  revokeRuntimeCredential,
  type RuntimeCredential,
  type IssuedRuntimeCredential,
  type RuntimeAdmissionFailure,
} from "../api/client";
import { FilterField, FilterPanel } from "@/components/FilterControls";
import InfiniteTable from "@/components/InfiniteTable";
import RuntimeInstallInstructions from "@/components/RuntimeInstallInstructions";

const CREDENTIAL_FILE_VERSION = 1;

function formatTimestamp(s?: string): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

function downloadCredentialFile(issued: IssuedRuntimeCredential, label: string): void {
  // Schema must match the runtime SDK loader (see
  // strategy-runtime credential file contract in
  // control-panel-service/README.md "D3 self-hosted runtime onboarding").
  const payload = {
    version: CREDENTIAL_FILE_VERSION,
    key_id: issued.key_id,
    role: issued.role,
    private_key_pem: issued.private_key_pem,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  // Filename includes a slug of the label + the key_id suffix so the
  // user can match downloads to credentials in the list view.
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const stem = slug ? `${slug}-${issued.key_id.slice(0, 8)}` : issued.key_id.slice(0, 8);
  a.download = `hushine-runtime-credential-${stem}.cred`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type RuntimeCredentialsPanelVariant = "full" | "create" | "list";

type RuntimeCredentialsPanelProps = {
  createTitle?: string;
  showAdmissionFailures?: boolean;
  variant?: RuntimeCredentialsPanelVariant;
};

export function RuntimeCredentialsPanel({
  createTitle = "Self-hosted runtime",
  showAdmissionFailures = true,
  variant = "full",
}: RuntimeCredentialsPanelProps) {
  const showCreate = variant === "full" || variant === "create";
  const showList = variant === "full" || variant === "list";
  const [admissionFailures, setAdmissionFailures] = useState<RuntimeAdmissionFailure[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // newLabel is the input for the next "issue" request.
  const [newLabel, setNewLabel] = useState("");
  const [newRole, setNewRole] = useState<"executor" | "debugger">("executor");
  const [issuing, setIssuing] = useState(false);

  // Just-issued bundle, shown as a one-time banner. Cleared when the
  // user dismisses it or navigates away.
  const [justIssued, setJustIssued] = useState<IssuedRuntimeCredential | null>(null);
  const [justIssuedLabel, setJustIssuedLabel] = useState("");

  const load = async (showInactive: boolean) => {
    setLoading(true);
    setError(null);
    try {
      void showInactive;
      const failureResult = showAdmissionFailures
        ? await listRuntimeAdmissionFailures(10).catch(() => ({ failures: [] }))
        : { failures: [] };
      setAdmissionFailures(failureResult.failures);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (showList || showAdmissionFailures) {
      void load(includeInactive);
      return;
    }
    setLoading(false);
  }, [includeInactive, showList, showAdmissionFailures]);

  // Clear the in-memory private key when the component unmounts. This
  // is belt-and-suspenders — the variable goes out of scope anyway, but
  // the explicit clear documents the security expectation.
  useEffect(() => {
    return () => {
      setJustIssued(null);
      setJustIssuedLabel("");
    };
  }, []);

  const onIssue = async () => {
    setIssuing(true);
    setError(null);
    try {
      const issued = await issueRuntimeCredential(newLabel.trim(), newRole);
      // Trigger download IMMEDIATELY so the user has the file even if
      // they navigate away before dismissing the banner.
      downloadCredentialFile(issued, newLabel.trim());
      setJustIssued(issued);
      setJustIssuedLabel(newLabel.trim());
      setNewLabel("");
      if (showList) {
        setRefreshKey((v) => v + 1);
        await load(includeInactive);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIssuing(false);
    }
  };

  const onRevoke = async (c: RuntimeCredential) => {
    const confirmed = window.confirm(
      `Revoke credential "${c.label || c.key_id.slice(0, 8)}"?\n\n` +
        "Any runtime currently using this credential will be disconnected. " +
        "Revocation is permanent — the only recovery is generating a new credential.",
    );
    if (!confirmed) return;
    setError(null);
    try {
      await revokeRuntimeCredential(c.key_id);
      setRefreshKey((v) => v + 1);
      await load(includeInactive);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className={showCreate && !showList ? "card runtime-create-section" : undefined}>
      <h2 className="section-title" style={{ marginTop: 0 }}>
        {showCreate && !showList ? createTitle : "Credentials"}
      </h2>
      {showCreate ? (
        <p className="muted">
          Each self-hosted strategy-runtime container needs a credential to
          connect to the platform. The credential is an Ed25519 keypair —
          the private half is downloaded once when you generate it and is
          never stored on the platform. Mount the downloaded file at{" "}
          <code>/etc/hushine/runtime.cred</code> in your runtime container.
        </p>
      ) : (
        <p className="muted">Review runtime credentials, consumed runtimes, and revoke credentials when needed.</p>
      )}

      {error && (
        <div
          role="alert"
          style={{
            background: "#fee",
            border: "1px solid #c00",
            padding: "0.5rem 0.75rem",
            margin: "1rem 0",
            borderRadius: "4px",
          }}
        >
          {error}
        </div>
      )}

      {justIssued && (
        <div
          style={{
            background: "#efe",
            border: "1px solid #2a7",
            padding: "0.75rem 1rem",
            margin: "1rem 0",
            borderRadius: "4px",
          }}
        >
          <strong>Credential issued.</strong> The download should have
          started automatically. The private key is shown only once — if
          you lost the download, revoke and generate a new one.
          <div style={{ fontFamily: "monospace", marginTop: "0.5rem", fontSize: "0.85rem" }}>
            key_id: {justIssued.key_id}
          </div>
          <RuntimeInstallInstructions credential={justIssued} />
          <button
            type="button"
            onClick={() => downloadCredentialFile(justIssued, justIssuedLabel)}
            style={{ marginRight: "0.5rem", marginTop: "0.5rem" }}
          >
            Re-download
          </button>
          <button
            type="button"
            onClick={() => {
              setJustIssued(null);
              setJustIssuedLabel("");
            }}
            style={{ marginTop: "0.5rem" }}
          >
            Dismiss
          </button>
        </div>
      )}

      {showCreate ? (
        <section className={showCreate && !showList ? "runtime-credential-create-card" : "card"}>
          <h2 className="section-title" style={{ marginTop: 0 }}>Generate credential</h2>
          <p className="muted">Generate a one-time credential, then use the downloaded command to start the runtime container.</p>
          <FilterPanel>
            <FilterField label="Label">
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                disabled={issuing}
                maxLength={64}
                placeholder="home VPS"
              />
            </FilterField>
            <FilterField label="Role">
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as "executor" | "debugger")}
                disabled={issuing}
              >
                <option value="executor">Executor</option>
                <option value="debugger">Debugger</option>
              </select>
            </FilterField>
            <div className="filter-action">
              <button type="button" className="primary" onClick={onIssue} disabled={issuing}>
                {issuing ? "Generating..." : "Generate credential"}
              </button>
            </div>
          </FilterPanel>
        </section>
      ) : null}

      {showList ? (
        <>
          <div className="primary-toolbar">
            <label>
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
              />{" "}
              Include inactive
            </label>
            <button
              type="button"
              onClick={() => {
                setRefreshKey((v) => v + 1);
                void load(includeInactive);
              }}
            >
              Refresh
            </button>
          </div>

          <InfiniteTable<RuntimeCredential>
            columns={["Label", "Key ID", "Role", "Status", "Created", "Downloaded", "Consumed", "Expires", "Runtime", "Last used", "Actions"]}
            refreshKey={`${includeInactive}-${refreshKey}`}
            emptyText={`No ${includeInactive ? "" : "active or consumed "}credentials yet. Generate one from Create Runtime to get started.`}
            loadPage={(offset, limit) => listRuntimeCredentialsPage(includeInactive, { offset, limit })}
            rowKey={(c) => c.key_id}
            renderRow={(c) => (
              <>
                <td>{c.label || <em style={{ color: "#888" }}>(no label)</em>}</td>
                <td><code>{c.key_id}</code></td>
                <td>{c.role}{c.hosted_internal ? <span className="muted"> · internal</span> : null}</td>
                <td>{c.status}</td>
                <td>{formatTimestamp(c.created_at)}</td>
                <td>{formatTimestamp(c.downloaded_at)}</td>
                <td>{formatTimestamp(c.consumed_at)}</td>
                <td>{formatTimestamp(c.expires_at)}</td>
                <td>
                  {c.consumed_runtime_id ? (
                    <Link to={`/runtimes/${encodeURIComponent(c.consumed_runtime_id)}`}>{c.consumed_runtime_id}</Link>
                  ) : "—"}
                </td>
                <td>{formatTimestamp(c.last_used_at)}</td>
                <td>
                  {c.status === "active" || c.status === "downloaded" || c.status === "consumed" ? (
                    <button type="button" onClick={() => onRevoke(c)}>Revoke</button>
                  ) : (
                    <span style={{ color: "#888" }}>Revoked {formatTimestamp(c.revoked_at)}</span>
                  )}
                </td>
              </>
            )}
          />
        </>
      ) : null}

      {showAdmissionFailures && !loading && admissionFailures.length > 0 && (
        <section
          style={{
            background: "#fafafa",
            border: "1px solid #ddd",
            padding: "1rem",
            margin: "1rem 0",
            borderRadius: "4px",
          }}
        >
          <h2 style={{ marginTop: 0 }}>Recent startup failures</h2>
          <p style={{ color: "#555", fontSize: "0.9rem", marginTop: 0 }}>
            These are failed self-hosted runtime admissions. Secrets are never shown here.
          </p>
          <div className="table-scroll">
            <table className="compact" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #ccc", textAlign: "left" }}>
                  <th style={{ padding: "0.5rem" }}>Last seen</th>
                  <th style={{ padding: "0.5rem" }}>Runtime</th>
                  <th style={{ padding: "0.5rem" }}>Credential</th>
                  <th style={{ padding: "0.5rem" }}>Reason</th>
                  <th style={{ padding: "0.5rem" }}>Attempts</th>
                </tr>
              </thead>
              <tbody>
                {admissionFailures.map((f) => (
                  <tr
                    key={f.admission_failure_id || `${f.credential_key_id || "credential"}-${f.requested_runtime_id || "runtime"}`}
                    style={{ borderBottom: "1px solid #eee" }}
                  >
                    <td style={{ padding: "0.5rem" }}>{formatTimestamp(f.last_seen_at)}</td>
                    <td style={{ padding: "0.5rem" }}>
                      {f.requested_runtime_id ? (
                        <Link to={`/runtimes/${encodeURIComponent(f.requested_runtime_id)}`}>
                          {f.requested_name || f.requested_runtime_id}
                        </Link>
                      ) : (
                        f.requested_name || "—"
                      )}
                    </td>
                    <td style={{ padding: "0.5rem" }}>
                      {f.credential_key_id ? (
                        <code>{f.credential_key_id}</code>
                      ) : (
                        "—"
                      )}
                      {f.consumed_runtime_id ? (
                        <span style={{ color: "#666" }}>
                          {" "}used by{" "}
                          <Link to={`/runtimes/${encodeURIComponent(f.consumed_runtime_id)}`}>
                            {f.consumed_runtime_id}
                          </Link>
                        </span>
                      ) : null}
                    </td>
                    <td style={{ padding: "0.5rem" }}>{f.reason || f.failure_code || "—"}</td>
                    <td style={{ padding: "0.5rem" }}>{f.attempt_count || 1}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

export default function RuntimeCredentials() {
  return <RuntimeCredentialsPanel />;
}
