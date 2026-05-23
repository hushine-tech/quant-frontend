import type { ReactNode } from "react";

type FilterPanelProps = {
  children: ReactNode;
  className?: string;
};

type FilterFieldProps = {
  label: string;
  children: ReactNode;
  className?: string;
  wide?: boolean;
};

export function FilterPanel({ children, className = "" }: FilterPanelProps) {
  return <div className={`filter-panel ${className}`.trim()}>{children}</div>;
}

export function FilterField({ label, children, className = "", wide = false }: FilterFieldProps) {
  const classes = ["filter-field", wide ? "filter-field--wide" : "", className].filter(Boolean).join(" ");
  return (
    <label className={classes}>
      <span>{label}</span>
      {children}
    </label>
  );
}
