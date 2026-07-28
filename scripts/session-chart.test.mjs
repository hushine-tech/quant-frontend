import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const chartPanelPath = path.join(root, "src/components/SessionChartPanel.tsx");
const indicatorsPath = path.join(root, "src/utils/chartIndicators.ts");
const sessionDetailPath = path.join(root, "src/pages/SessionDetailPage.tsx");
const cssPath = path.join(root, "src/index.css");

assert.equal(existsSync(chartPanelPath), true, "SessionChartPanel component should exist");
assert.equal(existsSync(indicatorsPath), true, "chartIndicators utility should exist");

const indicatorsSource = readFileSync(indicatorsPath, "utf8");
const transpiled = ts.transpileModule(indicatorsSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const indicators = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(transpiled)}`);

assert.equal(typeof indicators.calculateRSI, "function", "calculateRSI should be exported");
assert.equal(typeof indicators.calculateMACD, "function", "calculateMACD should be exported");

const ascending = Array.from({ length: 40 }, (_, index) => index + 1);
const rsi = indicators.calculateRSI(ascending, 14);
assert.equal(rsi.length, ascending.length, "RSI result should align with input candles");
assert.ok(rsi[rsi.length - 1].value > 99, "strictly rising prices should produce high RSI");

const macd = indicators.calculateMACD(ascending, 12, 26, 9);
assert.equal(macd.length, ascending.length, "MACD result should align with input candles");
assert.ok(macd[macd.length - 1].dif > 0, "rising prices should produce positive DIF");
assert.ok(Number.isFinite(macd[macd.length - 1].dea), "DEA should be finite");
assert.ok(Number.isFinite(macd[macd.length - 1].macd), "MACD histogram should be finite");
assert.equal(macd[macd.length - 1].histogram, macd[macd.length - 1].macd, "MACD histogram alias should stay aligned");
assert.equal(macd[macd.length - 1].signal, macd[macd.length - 1].dea, "DEA signal alias should stay aligned");

const chartPanelSource = readFileSync(chartPanelPath, "utf8");
assert.match(chartPanelSource, /lightweight-charts/, "SessionChartPanel should use lightweight-charts");
assert.match(chartPanelSource, /queryMarketDataKlines/, "SessionChartPanel should load market data klines");
assert.match(chartPanelSource, /getSessionFills/, "SessionChartPanel should load session fills");
assert.match(chartPanelSource, /getSessionLifecycleEvents/, "SessionChartPanel should load lifecycle events");
assert.match(chartPanelSource, /calculateMACD/, "SessionChartPanel should render MACD data");
assert.match(chartPanelSource, /calculateRSI/, "SessionChartPanel should render RSI data");
assert.match(chartPanelSource, /RSI_PERIODS\s*=\s*\[6,\s*12,\s*24\]/, "Session chart should define RSI6/RSI12/RSI24 as default periods");
assert.match(chartPanelSource, /calculateRSI\(closes,\s*period\)/, "Session chart should calculate RSI by selected period");
assert.doesNotMatch(chartPanelSource, /calculateRSI\(closes\)/, "Session chart should not render a single implicit RSI period");
assert.match(chartPanelSource, /DIF/, "Session chart should label the DIF line");
assert.match(chartPanelSource, /DEA/, "Session chart should label the DEA line");
assert.match(chartPanelSource, /RSI6/, "Session chart should expose RSI6");
assert.match(chartPanelSource, /RSI12/, "Session chart should expose RSI12");
assert.match(chartPanelSource, /RSI24/, "Session chart should expose RSI24");
assert.match(chartPanelSource, /SESSION_CHART_HEIGHT\s*=\s*480/, "Session chart should use a compact default height");
assert.doesNotMatch(chartPanelSource, /container\.replaceChildren\(\)/, "Session chart should not destroy the chart container on refresh");
assert.doesNotMatch(
  chartPanelSource,
  /\[hasMeasuredWidth,[^\]]*width[^\]]*\]/,
  "Session chart creation should not depend on raw width changes",
);
assert.match(chartPanelSource, /chartRef/, "Session chart should keep a stable chart instance");
assert.match(chartPanelSource, /initialVisibleRangeAppliedRef/, "Session chart should only set the initial visible range once per chart setup");
assert.match(chartPanelSource, /buildSessionBoundaryMarkers/, "Session chart should render session start/end markers");
assert.match(chartPanelSource, /START/, "Session chart should label the session start marker");
assert.match(chartPanelSource, /END/, "Session chart should label the session end marker");
assert.match(chartPanelSource, /inputSignature/, "Session chart should reset stream selection only when input contents change");
assert.match(chartPanelSource, /showInitialLoading/, "Session chart should distinguish first load from background refresh");
assert.doesNotMatch(
  chartPanelSource,
  /\{loading\s*\?\s*<p className="muted">Loading chart/,
  "Session chart should not insert a loading row during background refresh",
);
assert.match(chartPanelSource, /captureChartViewport/, "Session chart should capture viewport before refreshing data");
assert.match(chartPanelSource, /restoreChartViewport/, "Session chart should restore viewport after refreshing data");
assert.match(chartPanelSource, /getVisibleLogicalRange/, "Session chart should preserve horizontal logical range");
assert.match(chartPanelSource, /setVisibleLogicalRange/, "Session chart should restore horizontal logical range");
assert.doesNotMatch(chartPanelSource, /priceScale\(\)\.getVisibleRange/, "Session chart should not freeze price ranges when preserving refresh viewport");
assert.doesNotMatch(chartPanelSource, /priceScale\(\)\.setVisibleRange/, "Session chart should let price scales autoscale after horizontal zoom");
assert.match(chartPanelSource, /setAutoScale\(true\)/, "Session chart should re-enable price scale autoscale after data refresh");
assert.match(chartPanelSource, /hoverCandle/, "Session chart should keep hovered candle OHLCV state");
assert.match(chartPanelSource, /subscribeCrosshairMove/, "Session chart should subscribe to crosshair movement for OHLCV hover data");
assert.match(chartPanelSource, /unsubscribeCrosshairMove/, "Session chart should unsubscribe the crosshair movement handler on teardown");
assert.match(chartPanelSource, /seriesData\.get\(candleSeries\)/, "Session chart should read OHLC data from the candlestick series");
assert.match(chartPanelSource, /session-chart__ohlcv/, "Session chart should render a fixed OHLCV information row");
assert.match(chartPanelSource, />O</, "Session chart should expose the open value label");
assert.match(chartPanelSource, />H</, "Session chart should expose the high value label");
assert.match(chartPanelSource, />L</, "Session chart should expose the low value label");
assert.match(chartPanelSource, />C</, "Session chart should expose the close value label");
assert.match(chartPanelSource, />V</, "Session chart should expose the volume value label");
assert.match(chartPanelSource, /sessionRangeKey/, "Session chart load dependencies should use stable session range keys");
assert.match(chartPanelSource, /sessionBoundaryKey/, "Session chart marker dependencies should use stable session boundary keys");
assert.match(
  chartPanelSource,
  /label:\s*formatChartStreamLabel\(input\)/,
  "Session chart stream labels should include market so Spot and Futures routes are distinguishable",
);
assert.match(chartPanelSource, /Perpetual Futures/, "Session chart should use an explicit Futures market label");
assert.match(chartPanelSource, /Spot/, "Session chart should use an explicit Spot market label");
assert.doesNotMatch(
  chartPanelSource,
  /\}, \[selectedInput, session\]\);/,
  "Session chart load callback should not depend on the whole session object",
);
assert.doesNotMatch(
  chartPanelSource,
  /\[chartState, selectedInputKey, selectedInput, session,/,
  "Session chart data effect should not depend on the whole session object",
);
assert.equal(
  (chartPanelSource.match(/fetchKlines\(capturedInput, startMs, endMs\)/g) ?? []).length,
  1,
  "SessionChartPanel should fetch klines once per chart load",
);
assert.doesNotMatch(
  chartPanelSource,
  /setInterval/,
  "Session chart polling must schedule after the prior request settles",
);
assert.match(
  chartPanelSource,
  /chartRequestOwnerRef[\s\S]*chartLoadPendingRef/,
  "Session chart must reject stale loads and queue the newest identity",
);
assert.match(
  chartPanelSource,
  /return \(\) => \{[\s\S]*chartRequestOwnerRef\.current\.invalidate\(\);[\s\S]*chartLoadPendingRef\.current = false;[\s\S]*\};/,
  "Session chart cleanup must cancel a queued load after unmount",
);
assert.match(
  chartPanelSource,
  /setChartState\(null\);[\s\S]*\}, \[session\.session_id, selectedInputKey\]\);/,
  "Session or stream changes must clear the previous chart before the replacement request settles",
);
assert.match(
  chartPanelSource,
  /\}, \[hasMeasuredWidth, session\.session_id, selectedInputKey,/,
  "Session changes must recreate the chart so old series data cannot remain visible",
);

const sessionDetailSource = readFileSync(sessionDetailPath, "utf8");
assert.match(sessionDetailSource, /SessionChartPanel/, "Session detail should render SessionChartPanel");
assert.match(sessionDetailSource, /"chart"/, "Session detail should include a chart tab");
assert.match(sessionDetailSource, /setChartLoaded/, "Chart tab should lazy-load chart data");

const cssSource = readFileSync(cssPath, "utf8");
assert.match(cssSource, /\.session-chart__canvas[\s\S]*height:\s*480px/, "Session chart canvas should use compact fixed height");
assert.doesNotMatch(cssSource, /\.session-chart__canvas[\s\S]*min-height:\s*520px/, "Session chart canvas should not force a tall minimum height");
assert.match(cssSource, /\.session-chart__ohlcv[\s\S]*min-height:/, "OHLCV hover row should reserve height to avoid layout jitter");

console.log("session chart checks passed");
