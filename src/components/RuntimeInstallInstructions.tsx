import type { IssuedRuntimeCredential, Runtime } from "@/api/client";

type RuntimeInstallInstructionsProps = {
  credential?: Pick<IssuedRuntimeCredential, "key_id" | "role">;
  runtime?: Pick<Runtime, "runtime_id" | "name" | "role" | "credential_key_id">;
};

function normalizeRole(role?: string): "executor" | "debugger" {
  return role === "debugger" ? "debugger" : "executor";
}

function slugPart(value?: string): string {
  const slug = (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "runtime";
}

function containerName(role: "executor" | "debugger", keyID?: string, runtime?: RuntimeInstallInstructionsProps["runtime"]): string {
  if (runtime?.name) return slugPart(runtime.name);
  const suffix = keyID || runtime?.runtime_id || role;
  return `hushine-${role}-${slugPart(suffix).slice(0, 12)}`;
}

function dockerRunCommand(role: "executor" | "debugger", name: string): string {
  const image = `hushine/strategy-runtime:${role}-dev`;
  const lines = [
    "mkdir -p $HOME/.hushine",
    "# Put the downloaded .cred file at $HOME/.hushine/runtime.cred",
  ];
  if (role === "debugger") {
    lines.push("mkdir -p $HOME/hushine-debug-workspace");
  }
  lines.push("docker run --rm -it \\");
  lines.push(`  --name ${name} \\`);
  if (role === "debugger") {
    lines.push("  -p 127.0.0.1:5678:5678 \\");
  }
  lines.push("  -v $HOME/.hushine/runtime.cred:/etc/hushine/runtime.cred:ro \\");
  if (role === "debugger") {
    lines.push("  -v $HOME/hushine-debug-workspace:/workspace \\");
  }
  lines.push(
    "  -e RUNTIME_CREDENTIAL_PATH=/etc/hushine/runtime.cred \\",
    "  -e RUNTIME_CHANNEL_GRPC_ADDR=<control-panel-host>:50055 \\",
    `  ${image}`,
  );
  return lines.join("\n");
}

function debuggerReplayCommand(name: string): string {
  return [
    `docker exec -it ${name} \\`,
    "  hushine-debug replay \\",
    "  --debugpy \\",
    "  --host 0.0.0.0 \\",
    "  --port 5678 \\",
    "  --wait",
  ].join("\n");
}

export default function RuntimeInstallInstructions({
  credential,
  runtime,
}: RuntimeInstallInstructionsProps) {
  const role = normalizeRole(credential?.role || runtime?.role);
  const keyID = credential?.key_id || runtime?.credential_key_id;
  const name = containerName(role, keyID, runtime);

  return (
    <div className="runtime-install-instructions">
      <section>
        <h3>Start container</h3>
        <p className="muted">
          The credential private key is downloaded only once. Keep the file at <code>$HOME/.hushine/runtime.cred</code>.
          If the file is lost, revoke this credential and generate a new one.
        </p>
        <pre>{dockerRunCommand(role, name)}</pre>
      </section>
      {role === "debugger" ? (
        <section>
          <h3>Run inside container</h3>
          <p className="muted">
            After the debugger runtime is connected and a debug dataset is loaded, run this from the host.
            VSCode should attach to <code>localhost:5678</code>.
          </p>
          <pre>{debuggerReplayCommand(name)}</pre>
        </section>
      ) : (
        <section>
          <h3>Run inside container</h3>
          <p className="muted">
            Executor runtimes start the strategy service automatically. No manual <code>hushine-debug replay</code> command is needed.
          </p>
        </section>
      )}
    </div>
  );
}
