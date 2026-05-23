/**
 * Render a timestamp with UTC as the primary value and UTC+8 as a side note.
 * Wire transport is always Unix milliseconds; the display layer funnels through
 * this helper so formatting stays consistent across pages.
 *
 * Example output: "2025-01-01 00:00 UTC (08:00 UTC+8)".
 */
export function formatUTCWithLocal(input: string | number): string {
  const d = typeof input === "number" ? new Date(input) : new Date(input);
  if (isNaN(d.getTime())) return String(input);

  const utc = fmtDateTime(d, 0);
  const local8 = fmtTime(d, 8);
  return `${utc} UTC (${local8} UTC+8)`;
}

/** Compact variant: UTC only. */
export function formatUTC(input: string | number): string {
  const d = typeof input === "number" ? new Date(input) : new Date(input);
  if (isNaN(d.getTime())) return String(input);
  return `${fmtDateTime(d, 0)} UTC`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function fmtDateTime(d: Date, offsetHours: number): string {
  const t = new Date(d.getTime() + offsetHours * 3600_000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

function fmtTime(d: Date, offsetHours: number): string {
  const t = new Date(d.getTime() + offsetHours * 3600_000);
  return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}
