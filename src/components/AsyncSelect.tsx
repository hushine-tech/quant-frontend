import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { Page } from "@/api/client";

export type AsyncSelectOption<T = unknown> = {
  value: string;
  label: string;
  detail?: string;
  disabled?: boolean;
  item?: T;
};

type AsyncSelectProps<T = unknown> = {
  value: string;
  onChange: (value: string, option?: AsyncSelectOption<T>) => void;
  loadPage: (offset: number, limit: number, query: string) => Promise<Page<AsyncSelectOption<T>>>;
  placeholder?: string;
  disabled?: boolean;
  pageSize?: number;
  allowClear?: boolean;
  searchPlaceholder?: string;
};

export default function AsyncSelect<T = unknown>({
  value,
  onChange,
  loadPage,
  placeholder = "Select",
  disabled = false,
  pageSize = 50,
  allowClear = true,
  searchPlaceholder = "Search...",
}: AsyncSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Array<AsyncSelectOption<T>>>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);
  const loadPageRef = useRef(loadPage);

  const selected = useMemo(() => options.find((opt) => opt.value === value), [options, value]);

  useEffect(() => {
    loadPageRef.current = loadPage;
  }, [loadPage]);

  const fetchOptions = useCallback(async (nextOffset: number, replace = false, q = query) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const page = await loadPageRef.current(nextOffset, pageSize, q);
      setOptions((prev) => (replace ? page.items : [...prev, ...page.items]));
      setOffset(page.next_offset);
      setHasMore(page.has_more);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [pageSize, query]);

  useEffect(() => {
    if (!open) return;
    void fetchOptions(0, true, query);
  }, [fetchOptions, open, query]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (!hasMore || loading) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
      void fetchOptions(offset);
    }
  }

  const buttonText = selected?.label || value || placeholder;

  return (
    <div className="async-select" ref={rootRef}>
      <button
        type="button"
        className="async-select__button"
        disabled={disabled}
        onClick={() => setOpen((next) => !next)}
      >
        <span>{buttonText}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div className="async-select__menu">
          <input
            className="async-select__search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOffset(0);
              setHasMore(true);
            }}
            placeholder={searchPlaceholder}
            autoFocus
          />
          <div className="async-select__options" onScroll={onScroll}>
            {allowClear ? (
              <button
                type="button"
                className="async-select__option"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                {placeholder}
              </button>
            ) : null}
            {options.map((opt) => (
              <button
                type="button"
                key={opt.value}
                className="async-select__option"
                disabled={opt.disabled}
                onClick={() => {
                  onChange(opt.value, opt);
                  setOpen(false);
                }}
              >
                <span>{opt.label}</span>
                {opt.detail ? <small>{opt.detail}</small> : null}
              </button>
            ))}
            {loading ? <div className="async-select__state">Loading...</div> : null}
            {error ? <div className="async-select__state async-select__state--error">{error}</div> : null}
            {!loading && !error && options.length === 0 ? <div className="async-select__state">No options</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
