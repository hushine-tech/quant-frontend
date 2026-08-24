import { useEffect, useId, useRef, useState } from "react";
import { listSymbols, type SpotSymbolCatalogEntry } from "@/api/client";

type Props = {
  market: "spot" | "usdm_futures";
  label: string;
  onAdd: (symbol: string, entry?: SpotSymbolCatalogEntry, stale?: boolean) => void;
  disabled?: boolean;
  /** Extra symbols always shown at the top (e.g. TESTUSDT for testing). */
  extraSymbols?: string[];
  className?: string;
  /**
   * Optional currently-selected symbol. When set, the picker renders a
   * single-select variant: the current value is shown above the search,
   * result buttons omit the "+" prefix, and the result list auto-collapses
   * after picking or when the user clicks outside the picker.
   * When NOT set, the picker stays in its original "add-to-list" mode where
   * the result list is always expanded (PortfolioNew uses this).
   */
  selected?: string;
};

export default function SymbolPicker({ market, label, onAdd, disabled, extraSymbols, selected, className }: Props) {
  const inputId = useId();
  const singleSelect = selected !== undefined;
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<string[]>([]);
  const [entries, setEntries] = useState<SpotSymbolCatalogEntry[]>([]);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Single-select: result list visibility is controlled; opens on focus,
  // closes on pick / outside click / Escape.
  // Add-to-list: always expanded, matching PortfolioNew's current interaction.
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (disabled) {
      setHits([]);
      setEntries([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      (async () => {
        setLoading(true);
        setErr(null);
        try {
          const r = await listSymbols(market, q);
          if (!cancelled) {
            setHits(r.symbols ?? []);
            setEntries(r.entries ?? []);
            setStale(r.stale);
          }
        } catch (e) {
          if (!cancelled) setErr(e instanceof Error ? e.message : "Search failed");
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, market, disabled]);

  // Outside-click + Escape handlers — single-select only, skip otherwise
  // to leave PortfolioNew's always-open behavior untouched.
  useEffect(() => {
    if (!singleSelect || !open) return;
    function onMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [singleSelect, open]);

  function handlePick(s: string) {
    const entry = entries.find((candidate) => candidate.symbol === s);
    onAdd(s, entry, stale);
    if (singleSelect) {
      setOpen(false);
      setQ("");
    }
  }

  // Whether the result list block is visible right now.
  const showResults = singleSelect ? open : true;

  // What the text box shows right now:
  //   - single-select + closed: the chosen symbol (acts like a native <select>)
  //   - single-select + open  : the live search query (user is typing)
  //   - add-to-list mode       : always the live search query
  const displayValue = singleSelect && !open ? (selected ?? "") : q;

  const rootClasses = [
    "symbol-picker",
    singleSelect ? "symbol-picker--single" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <div ref={rootRef} className={rootClasses} style={className ? undefined : { marginTop: "0.75rem" }}>
      <label htmlFor={inputId}>
        <span>{label}</span>
      </label>
      <input
        id={inputId}
        name="symbol_search"
        type="search"
        placeholder="Type to search symbols…"
        value={displayValue}
        disabled={disabled}
        onChange={(e) => {
          setQ(e.target.value);
          if (singleSelect) setOpen(true);
        }}
        onFocus={() => {
          if (singleSelect) {
            // Clear the query so the user types fresh instead of inheriting
            // a stale search string from an earlier opened-but-not-picked session.
            setQ("");
            setOpen(true);
          }
        }}
        style={{ maxWidth: "100%" }}
      />
      {showResults ? (
        <>
          {loading ? <p className="muted">Searching…</p> : null}
          {err ? <p className="error">{err}</p> : null}
          {stale && hits.length > 0 ? (
            <p className="muted">Using cached symbol list (stale).</p>
          ) : null}
          {extraSymbols && extraSymbols.length > 0 ? (
            <ul className="symbol-hits" style={{ marginBottom: "0.25rem" }}>
              {extraSymbols.map((s) => (
                <li key={`extra-${s}`}>
                  <button type="button" disabled={disabled} onClick={() => handlePick(s)}>
                    {singleSelect ? s : `+ ${s}`} <span className="muted">(test)</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {!loading && hits.length > 0 ? (
            <ul className="symbol-hits">
              {hits.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    disabled={disabled || (market === "spot" && (stale || !entries.some((entry) => entry.symbol === s)))}
                    title={market === "spot" && stale ? "Refresh symbol metadata before selecting this Spot symbol." : undefined}
                    onClick={() => handlePick(s)}
                  >
                    {singleSelect ? s : `+ ${s}`}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
