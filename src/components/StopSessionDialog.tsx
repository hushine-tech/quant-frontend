type StopSessionDialogProps = {
  open: boolean;
  sessionId?: string;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onStopOnly: () => void;
  onStopAndClose: () => void;
};

export default function StopSessionDialog({
  open,
  sessionId,
  busy = false,
  error,
  onCancel,
  onStopOnly,
  onStopAndClose,
}: StopSessionDialogProps) {
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="stop-session-title">
        <h3 id="stop-session-title" style={{ marginTop: 0, marginBottom: "0.5rem" }}>
          停止 Session
        </h3>
        <p className="muted" style={{ marginTop: 0 }}>
          {sessionId ? <>Session <code>{sessionId}</code> 将按你选择的方式停止。</> : "请选择停止方式。"}
        </p>
        <div className="dialog-action-list">
          <button type="button" onClick={onCancel} autoFocus disabled={busy}>
            取消
          </button>
          <button type="button" onClick={onStopOnly} disabled={busy}>
            仅停止 session，不平仓
          </button>
          <button type="button" className="danger" onClick={onStopAndClose} disabled={busy}>
            先清仓后停止 session
          </button>
        </div>
        <p className="muted" style={{ marginBottom: 0, fontSize: "0.85rem" }}>
          `仅停止` 是 soft stop，只停策略和数据消费，不处理账户持仓。`先清仓后停止` 是账户级退出，会尝试把风险敞口清到空状态。
        </p>
        {error ? <p className="error" style={{ marginTop: "0.75rem", marginBottom: 0 }}>{error}</p> : null}
      </div>
    </div>
  );
}
