import { useEffect, useRef, useState } from "react";
import {
  activeStrategyMatchesSession,
  listPortfolioStrategies,
  previewRunStrategy,
  type PreviewRunStrategy,
  type Session,
} from "@/api/client";

type ResumeStrategyPreviewState = {
  preview: PreviewRunStrategy | null;
  loading: boolean;
  error: string | null;
  ready: boolean;
};

function resumePreviewKey(session: Session, runtimeID: string, maxLossClosePct: number): string {
  return [
    session.session_id,
    session.strategy_id,
    runtimeID,
    maxLossClosePct,
    session.start_time_ms ?? "",
    session.end_time_ms ?? "",
  ].join(":");
}

export function useResumeStrategyPreview(
  open: boolean,
  portfolioID: number,
  session: Session | null,
  runtimeID: string,
  maxLossClosePct: number | null,
): ResumeStrategyPreviewState {
  const [preview, setPreview] = useState<PreviewRunStrategy | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptedKey, setAcceptedKey] = useState("");
  const requestSequenceRef = useRef(0);
  const key = session && runtimeID && maxLossClosePct !== null
    ? resumePreviewKey(session, runtimeID, maxLossClosePct)
    : "";

  useEffect(() => {
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    setPreview(null);
    setAcceptedKey("");
    setError(null);
    setLoading(false);
    if (!open || !session || !runtimeID || maxLossClosePct === null) return;

    let cancelled = false;
    let timer: number | null = null;
    const targetSession = session;
    const targetMaxLossClosePct = maxLossClosePct;
    const targetKey = resumePreviewKey(targetSession, runtimeID, targetMaxLossClosePct);

    async function loadPreview() {
      setLoading(true);
      try {
        const before = await listPortfolioStrategies(portfolioID);
        if (!activeStrategyMatchesSession(before, targetSession.strategy_id)) {
          throw new Error("Activate this Session's original strategy before resuming so its leverage can be previewed safely.");
        }
        const result = await previewRunStrategy(portfolioID, {
          start_time_ms: targetSession.start_time_ms,
          end_time_ms: targetSession.end_time_ms,
          runtime_id: runtimeID,
          max_loss_close_pct: targetMaxLossClosePct,
        });
        const after = await listPortfolioStrategies(portfolioID);
        if (!activeStrategyMatchesSession(after, targetSession.strategy_id)) {
          throw new Error("The active strategy changed while checking resume readiness. Review the preview again.");
        }
        if (!cancelled && requestSequenceRef.current === sequence) {
          setPreview(result);
          setAcceptedKey(targetKey);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled && requestSequenceRef.current === sequence) {
          setPreview(null);
          setAcceptedKey("");
          setError(loadError instanceof Error ? loadError.message : "Resume preflight failed");
        }
      } finally {
        if (!cancelled && requestSequenceRef.current === sequence) {
          setLoading(false);
          timer = window.setTimeout(loadPreview, 15_000);
        }
      }
    }

    void loadPreview();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [open, portfolioID, key]);

  return {
    preview,
    loading,
    error,
    ready: Boolean(key && acceptedKey === key && preview?.ok && !loading && !error),
  };
}
