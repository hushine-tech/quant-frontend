import { Link } from "react-router-dom";

/**
 * Reserved area for a future TradingView (or similar) widget.
 * Keep chart-specific dependencies isolated here.
 */
export default function ChartsPlaceholder() {
  return (
    <div>
      <h1>Charts</h1>
      <p className="muted">
        TradingView integration will plug in here. For now this page is a placeholder.
      </p>
      <p>
        <Link to="/portfolios">Portfolios</Link>
      </p>
    </div>
  );
}
