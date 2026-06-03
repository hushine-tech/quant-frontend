import type { Page } from "@/api/client";

type SourcePageLoader<T> = (offset: number, limit: number) => Promise<Page<T>>;

type CollectFilteredPageParams<TItem, TOption> = {
  offset: number;
  limit: number;
  loadSourcePage: SourcePageLoader<TItem>;
  matches: (item: TItem) => boolean;
  map: (item: TItem) => TOption;
};

export async function collectFilteredPage<TItem, TOption>({
  offset,
  limit,
  loadSourcePage,
  matches,
  map,
}: CollectFilteredPageParams<TItem, TOption>): Promise<Page<TOption>> {
  const targetOffset = Math.max(0, offset);
  const targetLimit = Math.max(1, limit);
  const sourceLimit = Math.max(targetLimit, 100);
  const items: TOption[] = [];
  let matchedCount = 0;
  let sourceOffset = 0;
  let hasMore = true;
  let foundMore = false;

  // AsyncSelect offsets are counted after filtering, so source pages are scanned from the start.
  while (hasMore) {
    const currentOffset = sourceOffset;
    const page = await loadSourcePage(sourceOffset, sourceLimit);
    sourceOffset = page.next_offset;
    hasMore = page.has_more;

    for (const item of page.items) {
      if (!matches(item)) continue;
      if (matchedCount < targetOffset) {
        matchedCount += 1;
        continue;
      }
      if (items.length < targetLimit) {
        items.push(map(item));
        matchedCount += 1;
        continue;
      }
      foundMore = true;
      break;
    }

    if (foundMore) break;
    if (page.items.length === 0 || sourceOffset <= currentOffset) break;
  }

  const nextOffset = targetOffset + items.length;
  return {
    items,
    next_offset: nextOffset,
    has_more: foundMore,
    total: foundMore ? nextOffset + 1 : nextOffset,
  };
}
