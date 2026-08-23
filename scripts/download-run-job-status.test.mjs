import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const client = fs.readFileSync(path.join(root, "src/api/client.ts"), "utf8");
const portfolioDetail = fs.readFileSync(path.join(root, "src/pages/PortfolioDetail.tsx"), "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(client.includes("message?: string"), "DownloadRunJob should expose a progress message.");
assert(client.includes("requests?: MarketDataRequest[]"), "DownloadRunJob should expose historical request details.");
assert(client.includes("target_results?: StrategyLeverageTargetResult[]"), "DownloadRunJob should expose per-target apply and rollback results.");
assert(client.includes("rollback_failed?: boolean"), "DownloadRunJob should preserve rollback failure state.");
assert(portfolioDetail.includes("job.message"), "Backtest dialog should render the live job message.");
assert(portfolioDetail.includes("job.requests") && portfolioDetail.includes("request.updated_at"), "Backtest dialog should render request statuses and update times.");
assert(portfolioDetail.includes("downloadRunJobStrategyResult(job)"), "Backtest polling should convert terminal structured state into a visible result.");

console.log("download-run job status checks passed");
