import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

type Props = {
  label?: string;
  startValue: string;
  endValue: string;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  className?: string;
};

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function toLocalDateTimeValue(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function parseLocalDateTime(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function floorToMinute(date: Date): Date {
  const next = new Date(date);
  next.setSeconds(0, 0);
  return next;
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function dateOnly(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function mergeDateAndTime(date: Date, timeSource: Date | null): Date {
  const merged = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (timeSource) {
    merged.setHours(timeSource.getHours(), timeSource.getMinutes(), timeSource.getSeconds(), 0);
  } else {
    merged.setHours(0, 0, 0, 0);
  }
  return merged;
}

function formatDisplay(value: string): string {
  const date = parseLocalDateTime(value);
  if (!date) return "Select";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function timeValue(value: string): string {
  const date = parseLocalDateTime(value);
  if (date) return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
  return "00:00:00";
}

function applyTime(value: string, rawTime: string): string {
  const base = parseLocalDateTime(value) ?? new Date();
  const parts = rawTime.split(":").map((part) => Number(part));
  const hours = Number.isFinite(parts[0]) ? parts[0] : 0;
  const minutes = Number.isFinite(parts[1]) ? parts[1] : 0;
  const seconds = Number.isFinite(parts[2]) ? parts[2] : 0;
  const next = mergeDateAndTime(base, null);
  next.setHours(hours, minutes, seconds, 0);
  return toLocalDateTimeValue(next);
}

function monthLabel(date: Date): string {
  return date.toLocaleString("en-US", { month: "long", year: "numeric" });
}

function buildMonthCells(month: Date): Array<{ key: string; date: Date | null }> {
  const first = startOfMonth(month);
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells: Array<{ key: string; date: Date | null }> = [];
  for (let i = 0; i < first.getDay(); i += 1) {
    cells.push({ key: `blank-start-${i}`, date: null });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(first.getFullYear(), first.getMonth(), day);
    cells.push({ key: dateKey(date), date });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ key: `blank-end-${cells.length}`, date: null });
  }
  return cells;
}

export default function DateTimeRangePicker({
  label = "Time range",
  startValue,
  endValue,
  onStartChange,
  onEndChange,
  className = "",
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const startDate = parseLocalDateTime(startValue);
  const endDate = parseLocalDateTime(endValue);
  const initialMonth = startOfMonth(startDate ?? endDate ?? new Date());
  const [visibleMonth, setVisibleMonth] = useState(initialMonth);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
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
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    function positionPopover() {
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const padding = 16;
      const minHeight = 360;
      const width = Math.min(768, window.innerWidth - padding * 2);
      const maxPanelHeight = Math.min(620, window.innerHeight - padding * 2);
      let top = rect.bottom + 8;
      if (top + minHeight > window.innerHeight - padding) {
        top = Math.max(padding, window.innerHeight - maxPanelHeight - padding);
      }
      const left = Math.max(
        padding,
        Math.min(rect.left, window.innerWidth - width - padding),
      );
      setPopoverStyle({
        left,
        top,
        width,
        maxHeight: Math.max(280, window.innerHeight - top - padding),
        visibility: "visible",
      });
    }

    positionPopover();
    window.addEventListener("resize", positionPopover);
    window.addEventListener("scroll", positionPopover, true);
    return () => {
      window.removeEventListener("resize", positionPopover);
      window.removeEventListener("scroll", positionPopover, true);
    };
  }, [open]);

  const rangeStart = startDate ? dateOnly(startDate).getTime() : null;
  const rangeEnd = endDate ? dateOnly(endDate).getTime() : null;
  const months = useMemo(() => [visibleMonth, addMonths(visibleMonth, 1)], [visibleMonth]);

  function setPreset(days: number) {
    const end = floorToMinute(new Date());
    const start = addDays(end, -days);
    onStartChange(toLocalDateTimeValue(start));
    onEndChange(toLocalDateTimeValue(end));
    setVisibleMonth(startOfMonth(start));
  }

  function pickDate(date: Date) {
    if (!startDate || (startDate && endDate)) {
      onStartChange(toLocalDateTimeValue(mergeDateAndTime(date, startDate)));
      onEndChange("");
      return;
    }
    const pickedStart = dateOnly(startDate).getTime();
    const pickedEnd = dateOnly(date).getTime();
    if (pickedEnd < pickedStart) {
      onStartChange(toLocalDateTimeValue(mergeDateAndTime(date, startDate)));
      onEndChange(toLocalDateTimeValue(mergeDateAndTime(startDate, endDate)));
      return;
    }
    if (pickedEnd === pickedStart) {
      onEndChange(toLocalDateTimeValue(mergeDateAndTime(addDays(dateOnly(date), 1), null)));
      return;
    }
    onEndChange(toLocalDateTimeValue(mergeDateAndTime(date, endDate)));
  }

  function cellClass(date: Date | null): string {
    if (!date) return "dt-range-cell dt-range-cell--blank";
    const t = dateOnly(date).getTime();
    const selectedStart = rangeStart != null && t === rangeStart;
    const selectedEnd = rangeEnd != null && t === rangeEnd;
    const inRange = rangeStart != null && rangeEnd != null && t > rangeStart && t < rangeEnd;
    return [
      "dt-range-cell",
      selectedStart || selectedEnd ? "dt-range-cell--selected" : "",
      inRange ? "dt-range-cell--in-range" : "",
    ].filter(Boolean).join(" ");
  }

  return (
    <div ref={rootRef} className={["filter-field", "date-time-range", className].filter(Boolean).join(" ")}>
      <span>{label}</span>
      <button type="button" className="date-time-range__trigger" onClick={() => setOpen((v) => !v)}>
        <span>
          <strong>Start</strong>
          {formatDisplay(startValue)}
        </span>
        <span>
          <strong>End</strong>
          {formatDisplay(endValue)}
        </span>
      </button>
      {open ? (
        <div className="date-time-range__popover" style={popoverStyle}>
          <div className="date-time-range__toolbar">
            <div className="date-time-range__presets">
              <button type="button" onClick={() => setPreset(7)}>7D</button>
              <button type="button" onClick={() => setPreset(30)}>1M</button>
              <button type="button" className="active">Custom</button>
            </div>
          </div>
          <div className="date-time-range__calendar-head">
            <button type="button" aria-label="Previous month" onClick={() => setVisibleMonth((v) => addMonths(v, -1))}>‹</button>
            <button type="button" aria-label="Next month" onClick={() => setVisibleMonth((v) => addMonths(v, 1))}>›</button>
          </div>
          <div className="date-time-range__months">
            {months.map((month) => (
              <div className="date-time-range__month" key={dateKey(month)}>
                <h3>{monthLabel(month)}</h3>
                <div className="date-time-range__weekdays">
                  {WEEKDAYS.map((day, idx) => <span key={`${day}-${idx}`}>{day}</span>)}
                </div>
                <div className="date-time-range__grid">
                  {buildMonthCells(month).map((cell) => (
                    cell.date ? (
                      <button
                        key={cell.key}
                        type="button"
                        className={cellClass(cell.date)}
                        onClick={() => pickDate(cell.date!)}
                      >
                        {cell.date.getDate()}
                      </button>
                    ) : <span key={cell.key} className={cellClass(null)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="date-time-range__times">
            <label>
              <span>Start time</span>
              <input
                type="time"
                step={1}
                value={timeValue(startValue)}
                disabled={!startValue}
                onChange={(e) => onStartChange(applyTime(startValue, e.target.value))}
              />
            </label>
            <label>
              <span>End time</span>
              <input
                type="time"
                step={1}
                value={timeValue(endValue)}
                disabled={!endValue}
                onChange={(e) => onEndChange(applyTime(endValue, e.target.value))}
              />
            </label>
            <button type="button" onClick={() => { onStartChange(""); onEndChange(""); }}>Clear</button>
            <button type="button" className="primary" onClick={() => setOpen(false)}>Apply</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
