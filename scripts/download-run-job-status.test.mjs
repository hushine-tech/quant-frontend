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
assert(portfolioDetail.includes("job.message"), "Backtest dialog should render the live job message.");
assert(portfolioDetail.includes("job.requests") && portfolioDetail.includes("request.updated_at"), "Backtest dialog should render request statuses and update times.");

console.log("download-run job status checks passed");
