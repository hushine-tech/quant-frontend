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
assert.match(chartPanelSource, /Default Indicators/, "Session chart should label default indicators in English");
assert.match(chartPanelSource, /session-chart__default-indicators/, "Default indicator controls should render in their own framed section");
assert.match(chartPanelSource, /Strategy Custom Indicators/, "Session chart should label strategy custom indicators in English");
assert.match(chartPanelSource, /session-chart__custom-indicators/, "Session chart should render custom indicators in a separate section");
assert.match(chartPanelSource, /session-chart__indicator-group/, "Indicator control sections should share a framed group style");
assert.match(chartPanelSource, /aria-label="Strategy Custom Indicators"/, "Custom indicator controls should have their own accessible region");
assert.match(chartPanelSource, /aria-label="Default Indicators"/, "Default indicator controls should have their own accessible region");

const defaultLayerIndex = chartPanelSource.indexOf('aria-label="Default Indicators"');
const customSectionIndex = chartPanelSource.indexOf("session-chart__custom-indicators");
const customTitleIndex = chartPanelSource.indexOf("Strategy Custom Indicators");
const customToggleIndex = chartPanelSource.indexOf("{customDefinitions.map");
assert.ok(defaultLayerIndex >= 0, "Default chart layer controls should exist");
assert.ok(customSectionIndex > defaultLayerIndex, "Custom indicator section should appear below the default chart layer controls");
assert.ok(customTitleIndex > customSectionIndex, "Custom indicator title should be inside the custom indicator section");
assert.ok(customToggleIndex > customTitleIndex, "Custom indicator toggles should render below the custom indicator title");

const cssSource = readFileSync(path.join(root, "src/index.css"), "utf8");
assert.match(cssSource, /\.session-chart__indicator-group[\s\S]*border:\s*1px solid/, "Indicator groups should be visually framed");
assert.match(cssSource, /\.session-chart__indicator-title[\s\S]*text-transform:\s*uppercase/, "Indicator group titles should be compact section labels");

console.log("session custom indicator checks passed");
