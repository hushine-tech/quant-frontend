import { useEffect, useState } from "react";

// Shared Pager — used by both `OrderTree` and `SessionDetailPage`.
//
// Drives First / Prev / jump-to-page / Next / Last navigation with a
// `Page N of M · X–Y of T` readout. The parent owns offset state and
// receives jump targets via `onJump(newOffset)`.

export type PagerProps = {
  offset: number;
  /** Number of items rendered on the current page. */
  count: number;
  /** Session-wide total matching the current filter. Drives Last + jump. */
  total: number;
  pageSize: number;
  loading: boolean;
  onJump: (newOffset: number) => void;
};

export default function Pager({ offset, count, total, pageSize, loading, onJump }: PagerProps) {
  // The bulk controls (First / Last / jump) only make sense when there is
  // more than one page of data. Below that we render nothing — same as the
  // pre-extract Pager component, no controls dangling on a single-page list.
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;
  const currentPage = Math.floor(offset / pageSize) + 1;
  const start = total === 0 ? 0 : offset + 1;
  const end = offset + count;

  const onFirstPage = currentPage === 1;
  const onLastPage = currentPage >= totalPages;

  // Jump input is uncontrolled-on-keystroke: type freely, commit on Enter
  // or blur. Out-of-range values are clamped to [1, totalPages] before we
  // call `onJump`. Keep the displayed input value synced with the actual
  // current page when the parent navigates by some other means.
  const [pendingPage, setPendingPage] = useState(String(currentPage));
  useEffect(() => { setPendingPage(String(currentPage)); }, [currentPage]);

  function commitJump() {
    const raw = pendingPage.trim();
    const parsed = raw === "" ? 1 : Number.parseInt(raw, 10);
    const clamped = Number.isNaN(parsed)
      ? currentPage
      : Math.max(1, Math.min(totalPages, parsed));
    setPendingPage(String(clamped));
    if (clamped !== currentPage) {
      onJump((clamped - 1) * pageSize);
    }
  }

  // Hide the bar entirely on truly empty results — no offset, nothing to
  // page through. Otherwise always render so the user gets the readout
  // even on a single-page list (just without bulk controls).
  if (offset === 0 && count === 0 && total === 0) return null;

  const showBulkControls = total > pageSize;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.5rem 0",
        borderTop: "1px solid #f1f5f9",
        marginTop: "0.5rem",
        fontSize: "0.85rem",
        flexWrap: "wrap",
      }}
    >
      {showBulkControls ? (
        <button
          type="button"
          onClick={() => onJump(0)}
          disabled={onFirstPage || loading}
          aria-label="First page"
          title="First page"
        >
          ⏮ First
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => onJump(Math.max(0, offset - pageSize))}
        disabled={onFirstPage || loading}
        aria-label="Previous page"
      >
        ← Prev
      </button>

      {showBulkControls ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
          <span className="muted">Page</span>
          <input
            type="number"
            min={1}
            max={totalPages}
            value={pendingPage}
            onChange={(e) => setPendingPage(e.target.value)}
            onBlur={commitJump}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitJump();
              }
            }}
            disabled={loading}
            style={{ width: "5em", textAlign: "right" }}
            aria-label="Jump to page"
          />
          <span className="muted">of {totalPages}</span>
        </span>
      ) : (
        <span className="muted">Page {currentPage}</span>
      )}

      <span className="muted">·</span>
      <span className="muted">
        {start}–{end} of {total}
      </span>

      <button
        type="button"
        onClick={() => onJump(offset + pageSize)}
        disabled={onLastPage || loading}
        aria-label="Next page"
      >
        Next →
      </button>
      {showBulkControls ? (
        <button
          type="button"
          onClick={() => onJump((totalPages - 1) * pageSize)}
          disabled={onLastPage || loading}
          aria-label="Last page"
          title="Last page"
        >
          Last ⏭
        </button>
      ) : null}
    </div>
  );
}
