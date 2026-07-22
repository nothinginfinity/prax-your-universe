import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = (process.env.PRAX_LOCAL_URL ?? process.env.PRAX_PREVIEW_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const artifactDir = process.env.PRAX_VISUAL_ARTIFACT_DIR ?? 'artifacts/pux008-local';
const viewports = [
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false, reducedMotion: 'no-preference' },
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true, reducedMotion: 'reduce' }
];
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const stableJson = (value) => JSON.stringify(value);
const roundVector = (value) => Object.fromEntries(Object.entries(value).map(([key, number]) => [key, Number(number.toFixed(4))]));
const roundedCamera = (state) => ({
  position: roundVector(state.position),
  target: roundVector(state.target)
});
const sortedPositions = (state) => [...state.nodePositions]
  .sort((left, right) => left.nodeId.localeCompare(right.nodeId))
  .map(({ nodeId, position }) => ({ nodeId, position: position.map((value) => Number(value.toFixed(6))) }));
const canonicalState = (state) => ({
  roots: state.roots,
  universes: state.universes,
  nodes: state.nodes,
  edges: state.edges,
  layouts: state.layouts,
  layoutNodes: state.layoutNodes
});

const waitForServer = async () => {
  let lastError = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return response.json();
      lastError = new Error(`Health returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }
  throw lastError ?? new Error('Prax server did not become ready.');
};

const getState = (page) => page.evaluate(() => globalThis.__PRAX_TEST__.getState());

const waitForFocusState = (page, expected) => page.waitForFunction(
  (state) => globalThis.__PRAX_TEST__.getState().galaxyFocus.state === state,
  expected,
  { timeout: 5000 }
);

const exerciseFocusCycle = async (page, viewport, exitMode) => {
  const initial = await getState(page);
  const rootId = initial.roots[0].id;

  await page.evaluate((nodeId) => globalThis.__PRAX_TEST__.selectNode(nodeId), rootId);
  await page.waitForFunction(() => globalThis.__PRAX_TEST__.getState().searchlightOpen === true);
  const rootSelection = await getState(page);
  assert.equal(rootSelection.selectedNodeId, rootId);
  assert.equal(await page.isVisible('#searchlight-input'), true);
  assert.equal(await page.getAttribute('#searchlight-launcher-btn', 'aria-expanded'), 'true');
  await page.fill('#searchlight-input', initial.nodes.find(({ id }) => id === rootId).title);
  await page.waitForFunction(() => globalThis.__PRAX_TEST__.getState().searchlight.total > 0);
  if (viewport.reducedMotion === 'no-preference') await sleep(550);

  const baseline = await getState(page);
  const baselineCanonical = stableJson(canonicalState(baseline));
  const baselinePositions = sortedPositions(baseline);
  const baselineCamera = roundedCamera(baseline.cameraState);
  const baselineNodeObjects = baseline.galaxyFocus.nodeObjectCount;
  const baselineEdgeObjects = baseline.galaxyFocus.edgeObjectCount;

  await page.click('#focus-btn');
  await waitForFocusState(page, 'active');
  if (viewport.reducedMotion === 'no-preference') await sleep(550);

  const active = await getState(page);
  assert.equal(active.searchlight.query, '');
  assert.equal(active.searchlightOpen, false);
  assert.equal(active.galaxyFocus.active, true);
  assert.equal(active.galaxyFocus.focusedNodeId, rootId);
  assert.equal(active.galaxyFocus.nodeObjectCount, baselineNodeObjects);
  assert.equal(active.galaxyFocus.edgeObjectCount, baselineEdgeObjects);
  assert.equal(stableJson(canonicalState(active)), baselineCanonical);
  assert.notDeepEqual(sortedPositions(active), baselinePositions);
  const focused = active.renderedNodes.find(({ nodeId }) => nodeId === rootId);
  const unrelated = active.renderedNodes.find(({ nodeId }) => nodeId !== rootId && focused && !active.edges.some(({ fromNodeId, toNodeId }) => (
    (fromNodeId === rootId && toNodeId === nodeId) || (toNodeId === rootId && fromNodeId === nodeId)
  )));
  assert.equal(focused.scale >= 1.8, true);
  assert.equal(focused.opacity, 1);
  if (unrelated) assert.equal(unrelated.opacity <= 0.2, true);
  assert.equal(active.renderedEdges.some(({ opacity }) => opacity >= 0.9), true);
  assert.equal(await page.getAttribute('#focus-btn', 'aria-pressed'), 'true');
  assert.equal(await page.getAttribute('#back-btn', 'aria-hidden'), 'false');
  assert.equal(await page.getAttribute('#back-btn', 'aria-keyshortcuts'), 'Escape');

  if (exitMode === 'back') await page.click('#back-btn');
  else if (exitMode === 'escape') await page.keyboard.press('Escape');
  else await page.click('#galaxy-reset-btn');
  await waitForFocusState(page, 'idle');
  if (viewport.reducedMotion === 'no-preference') await sleep(550);

  const restored = await getState(page);
  assert.equal(stableJson(canonicalState(restored)), baselineCanonical);
  assert.equal(restored.galaxyFocus.nodeObjectCount, baselineNodeObjects);
  assert.equal(restored.galaxyFocus.edgeObjectCount, baselineEdgeObjects);
  if (exitMode !== 'reset') {
    assert.deepEqual(sortedPositions(restored), baselinePositions);
    assert.deepEqual(roundedCamera(restored.cameraState), baselineCamera);
    assert.equal(restored.galaxyFocus.restorationExact, true);
  } else {
    assert.equal(restored.selectedNodeId, null);
    assert.deepEqual(roundVector(restored.cameraState.target), { x: 0, y: 0, z: 0 });
  }
  return { baseline, active, restored };
};

const runViewport = async (browser, viewport) => {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    reducedMotion: viewport.reducedMotion
  });
  const page = await context.newPage();
  const failures = [];
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`console: ${message.text()}`); });
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => failures.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`));
  page.on('response', (response) => { if (response.status() >= 400) failures.push(`response: ${response.status()} ${response.url()}`); });

  await page.goto(`${baseUrl}/?puxTest=008`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => Boolean(globalThis.__PRAX_TEST__?.getState), null, { timeout: 30000 });
  const initial = await getState(page);
  assert.equal(['0.2.0-pux.8.1', '0.2.0-pux.9'].includes(initial.applicationVersion), true);
  assert.equal(initial.galaxyFocus.state, 'idle');
  assert.equal(await page.getAttribute('#focus-btn', 'aria-label'), 'Focus selected node in Galaxy Focus');
  assert.equal(await page.getAttribute('#main-canvas', 'aria-label'), 'Prax spatial knowledge graph. Escape exits Galaxy Focus.');

  await exerciseFocusCycle(page, viewport, 'back');
  await exerciseFocusCycle(page, viewport, 'escape');
  await exerciseFocusCycle(page, viewport, 'reset');

  await page.click('#view-toggle-btn');
  await page.waitForFunction(() => globalThis.__PRAX_TEST__.getState().currentView === 'grid');
  const gridCycle = await exerciseFocusCycle(page, viewport, 'back');
  assert.equal(gridCycle.baseline.currentView, 'grid');
  assert.equal(gridCycle.active.currentView, 'grid');

  await page.click('#searchlight-launcher-btn');
  await page.fill('#searchlight-input', 'welcome');
  await page.waitForFunction(() => globalThis.__PRAX_TEST__.getState().searchlight.total > 0);

  const dimensions = await page.evaluate(() => {
    const controls = document.querySelector('.controls-top').getBoundingClientRect();
    const searchlight = document.querySelector('#searchlight').getBoundingClientRect();
    const infoPanel = document.querySelector('#info-panel').getBoundingClientRect();
    const launcher = document.querySelector('#searchlight-launcher-btn').getBoundingClientRect();
    const focus = document.querySelector('#focus-btn').getBoundingClientRect();
    return {
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      controlsLeft: controls.left,
      controlsRight: controls.right,
      controlsTop: controls.top,
      searchlightLeft: searchlight.left,
      searchlightRight: searchlight.right,
      searchlightBottom: searchlight.bottom,
      infoPanelLeft: infoPanel.left,
      infoPanelRight: infoPanel.right,
      infoPanelTop: infoPanel.top,
      infoPanelBottom: infoPanel.bottom,
      coveredRatio: (infoPanel.width * infoPanel.height) / (innerWidth * innerHeight),
      launcherLeft: launcher.left,
      launcherRight: launcher.right,
      launcherBottom: launcher.bottom,
      focusLeft: focus.left,
      focusRight: focus.right
    };
  });
  assert.equal(dimensions.scrollWidth <= dimensions.viewportWidth, true);
  assert.equal(dimensions.controlsLeft >= 0, true);
  assert.equal(dimensions.controlsRight <= dimensions.viewportWidth, true);
  assert.equal(dimensions.searchlightLeft >= 0, true);
  assert.equal(dimensions.searchlightRight <= dimensions.viewportWidth, true);
  assert.equal(dimensions.searchlightBottom <= dimensions.viewportHeight, true);
  assert.equal(dimensions.infoPanelLeft >= 0, true);
  assert.equal(dimensions.infoPanelRight <= dimensions.viewportWidth, true);
  assert.equal(dimensions.infoPanelTop >= 0, true);
  assert.equal(dimensions.infoPanelBottom <= dimensions.viewportHeight, true);
  assert.equal(dimensions.coveredRatio < 0.6, true);
  assert.equal(dimensions.launcherLeft >= 0, true);
  assert.equal(dimensions.launcherRight <= dimensions.viewportWidth, true);
  assert.equal(dimensions.launcherBottom <= dimensions.viewportHeight, true);
  assert.equal(dimensions.focusLeft >= 0, true);
  assert.equal(dimensions.focusRight <= dimensions.viewportWidth, true);
  assert.deepEqual(failures, []);

  await page.screenshot({ path: `${artifactDir}/${viewport.name}.png`, fullPage: true });
  await context.close();
  return { viewport, dimensions, failures };
};

await mkdir(artifactDir, { recursive: true });
const report = { ok: false, baseUrl, health: null, results: [] };
let browser = null;
try {
  report.health = await waitForServer();
  browser = await chromium.launch({ headless: true });
  for (const viewport of viewports) report.results.push(await runViewport(browser, viewport));
  report.ok = true;
} catch (error) {
  report.error = { name: error?.name ?? 'Error', message: error?.message ?? String(error), stack: error?.stack ?? null };
  const annotation = report.error.message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.error(`::error title=PUX-008 browser verifier::${annotation}`);
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await writeFile(`${artifactDir}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
