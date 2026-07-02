import { type ReactNode } from "react";
import { X } from "lucide-react";
import RuntimeSelector from "@/components/RuntimeSelector";
import { type Runtime } from "@/api/client";

type RuntimeSelectionDialogProps = {
  open: boolean;
  title: string;
  description?: ReactNode;
  runtimeId: string;
  runtimeLabel?: string;
  environment?: number;
  role?: "executor" | "debugger";
  busy?: boolean;
  error?: string | null;
  confirmLabel: string;
  confirmDisabled?: boolean;
  onRuntimeChange: (runtimeId: string, runtime?: Runtime) => void;
  onCancel: () => void;
  onConfirm: () => void;
  children?: ReactNode;
};

export default function RuntimeSelectionDialog({
  open,
  title,
  description,
  runtimeId,
  runtimeLabel = "Runtime",
  environment,
  role,
  busy = false,
  error,
  confirmLabel,
  confirmDisabled = false,
  onRuntimeChange,
  onCancel,
  onConfirm,
  children,
}: RuntimeSelectionDialogProps) {
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="runtime-selection-title">
        <div className="dialog-header">
          <h3 id="runtime-selection-title" style={{ margin: 0 }}>
            {title}
          </h3>
          <button
            type="button"
            className="dialog-close-button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close dialog"
            title="Close"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {description ? <p className="muted" style={{ marginTop: 0 }}>{description}</p> : null}
        <RuntimeSelector
          value={runtimeId}
          onChange={onRuntimeChange}
          disabled={busy}
          compact
          label={runtimeLabel}
          environment={environment}
          role={role}
        />
        {children}
        {error ? <p className="error" style={{ marginTop: "0.75rem", marginBottom: 0 }}>{error}</p> : null}
        <div className="dialog-action-list dialog-action-list--inline">
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={onConfirm} disabled={busy || !runtimeId || confirmDisabled}>
            {busy ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
