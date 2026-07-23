import type { StrategyOrderTargetDeclaration } from "@/api/client";

type StopSessionDialogProps = {
  open: boolean;
  sessionId?: string;
  busy?: boolean;
  error?: string | null;
  declaredTargets?: StrategyOrderTargetDeclaration[];
  stopAndCloseDisabled?: boolean;
  stopAndCloseDisabledReason?: string | null;
  onCancel: () => void;
  onStopOnly: () => void;
  onStopAndClose: () => void;
};

export default function StopSessionDialog({
  open,
  sessionId,
  busy = false,
  error,
  declaredTargets = [],
  stopAndCloseDisabled = false,
  stopAndCloseDisabledReason,
  onCancel,
  onStopOnly,
  onStopAndClose,
}: StopSessionDialogProps) {
  if (!open) return null;
  const spotTargets = declaredTargets.filter((target) => target.market.trim().toLowerCase() === "spot");

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="stop-session-title">
        <h3 id="stop-session-title" style={{ marginTop: 0, marginBottom: "0.5rem" }}>
          停止 Session
        </h3>
        <p className="muted" style={{ marginTop: 0 }}>
          {sessionId ? <>Session <code>{sessionId}</code> 将按你选择的方式停止。</> : "请选择停止方式。"}
        </p>
        <p className="muted" style={{ marginBottom: 0, fontSize: "0.85rem" }}>
          `仅停止` 是 soft stop，只停策略和数据消费，不处理账户持仓。`先清仓后停止` 是账户级退出，会尝试把风险敞口清到空状态。
        </p>
        {declaredTargets.length > 0 ? (
          <div style={{ marginTop: "0.75rem" }}>
            <p style={{ margin: "0 0 0.35rem", fontWeight: 600 }}>Declared order targets</p>
            <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
              {declaredTargets.map((target) => (
                <li key={`${target.exchange}:${target.market}:${target.symbol}`}>
                  <code>{target.exchange} / {target.market} / {target.symbol}</code>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {spotTargets.length > 0 ? (
          <div className="error" style={{ marginTop: "0.75rem" }}>
            <p style={{ margin: "0 0 0.35rem", fontWeight: 600 }}>Spot stop-and-close warning</p>
            <p style={{ margin: 0 }}>
              All current <code>free</code> corresponding base-asset holdings at this Venue, including
              pre-existing/manual holdings, will be sold. Any open order, locked amount, or unavoidable
              dust will abort the entire batch before any close order is submitted.
            </p>
          </div>
        ) : null}
        {stopAndCloseDisabledReason ? (
          <p className="error" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
            {stopAndCloseDisabledReason}
          </p>
        ) : null}
        {error ? <p className="error" style={{ marginTop: "0.75rem", marginBottom: 0 }}>{error}</p> : null}
        <div className="dialog-action-list" style={{ marginTop: "0.9rem" }}>
          <button type="button" onClick={onCancel} autoFocus disabled={busy}>
            取消
          </button>
          <button type="button" onClick={onStopOnly} disabled={busy}>
            仅停止 session，不平仓
          </button>
          <button type="button" className="danger" onClick={onStopAndClose} disabled={busy || stopAndCloseDisabled}>
            先清仓后停止 session
          </button>
        </div>
      </div>
    </div>
  );
}
