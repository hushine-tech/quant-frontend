import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import type { Page } from "@/api/client";

type InfiniteTableProps<T> = {
  loadPage: (offset: number, limit: number) => Promise<Page<T>>;
  columns: string[];
  renderRow: (item: T) => React.ReactNode;
  rowKey: (item: T, index: number) => string;
  pageSize?: number;
  emptyText?: string;
  className?: string;
  refreshKey?: string | number | boolean;
};

export default function InfiniteTable<T>({
  loadPage,
  columns,
  renderRow,
  rowKey,
  pageSize = 50,
  emptyText = "No records found.",
  className = "",
  refreshKey = "",
}: InfiniteTableProps<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const loadNext = useCallback(async (nextOffset: number, replace = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const page = await loadPage(nextOffset, pageSize);
      setItems((prev) => (replace ? page.items : [...prev, ...page.items]));
      setOffset(page.next_offset);
      setHasMore(page.has_more);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [loadPage, pageSize]);

  useEffect(() => {
    setItems([]);
    setOffset(0);
    setHasMore(true);
    void loadNext(0, true);
  }, [loadNext, refreshKey]);

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (!hasMore || loading) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 96) {
      void loadNext(offset);
    }
  }

  return (
    <div className={`table-scroll infinite-table ${className}`.trim()} onScroll={onScroll}>
      <table className="compact full-width-table">
        <thead>
          <tr>
            {columns.map((col) => <th key={col}>{col}</th>)}
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={rowKey(item, index)}>{renderRow(item)}</tr>
          ))}
        </tbody>
      </table>
      {!loading && items.length === 0 ? <p className="muted infinite-table__empty">{emptyText}</p> : null}
      {loading ? <p className="muted infinite-table__loading">Loading...</p> : null}
      {error ? <p className="error infinite-table__error">{error}</p> : null}
    </div>
  );
}
