import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";

type PageHeaderProps = {
  title: string;
  description?: ReactNode;
  loading?: boolean;
  onRefresh?: () => void;
  actions?: ReactNode;
};

export default function PageHeader({
  title,
  description,
  loading = false,
  onRefresh,
  actions,
}: PageHeaderProps) {
  return (
    <div className="page-header">
      <div className="page-header__copy">
        <h1>{title}</h1>
        {description ? <p className="muted">{description}</p> : null}
      </div>
      <div className="page-header__actions">
        {actions}
        {onRefresh ? (
          <button
            type="button"
            className="icon-text-button"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw size={16} aria-hidden="true" />
            <span>{loading ? "Refreshing..." : "Refresh"}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
