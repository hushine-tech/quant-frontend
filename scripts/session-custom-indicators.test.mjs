import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const clientPath = path.join(root, "src/api/client.ts");
const chartPanelPath = path.join(root, "src/components/SessionChartPanel.tsx");

const clientSource = readFileSync(clientPath, "utf8");
const chartPanelSource = readFileSync(chartPanelPath, "utf8");

assert.match(clientSource, /export type StrategyIndicatorDefinition/, "API client should type strategy indicator definitions");
assert.match(clientSource, /export type StrategyIndicatorChunk/, "API client should type strategy indicator chunks");
assert.match(clientSource, /getSessionIndicators/, "API client should expose session indicator definitions");
assert.match(clientSource, /\/api\/sessions\/\$\{sessionId\}\/indicators/, "definitions endpoint should be session-scoped");
assert.match(clientSource, /getSessionIndicatorChunks/, "API client should expose session indicator chunks");
assert.match(clientSource, /\/api\/sessions\/\$\{sessionId\}\/indicators\/chunks/, "chunks endpoint should be session-scoped");

assert.match(chartPanelSource, /getSessionIndicators/, "Session chart should load custom indicator definitions");
assert.match(chartPanelSource, /getSessionIndicatorChunks/, "Session chart should load custom indicator chunks");
assert.match(chartPanelSource, /chartStreamKey/, "Session chart should derive the runtime stream key");
assert.match(chartPanelSource, /expandCustomIndicatorChunks/, "Session chart should expand chunked indicator values to chart points");
assert.match(chartPanelSource, /buildCustomIndicatorMarkers/, "Session chart should convert marker chunks to chart markers");
assert.match(chartPanelSource, /syncCustomIndicatorSeries/, "Session chart should update custom series without recreating the chart");
assert.match(chartPanelSource, /customIndicatorSeriesRefs/, "Session chart should retain custom indicator series refs");
assert.match(chartPanelSource, /chart\.removeSeries/, "Session chart should remove hidden or stale custom series");
assert.match(chartPanelSource, /showCustomIndicators/, "Session chart should expose per-indicator toggles");
assert.match(chartPanelSource, /custom-indicator/, "Session chart should render custom indicator labels");

console.log("session custom indicator checks passed");
