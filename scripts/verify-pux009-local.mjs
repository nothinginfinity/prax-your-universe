import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = (process.env.PRAX_LOCAL_URL ?? process.env.PRAX_PREVIEW_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const artifactDir = process.env.PRAX_VISUAL_ARTIFACT_DIR ?? 'artifacts/pux009-local';
const viewports = [
  { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { name: 'iphone-dpr3', width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
];
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const stableJson = (value) => JSON.stringify(value);
const canonicalState = (state) => ({
  roots: state.roots,
  universes: state.universes,
  nodes: state.nodes,
  edges: state.edges,
  layouts: state.layouts,
  layoutNodes: state.layoutNodes,
  settings: state.settings
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

const findRaycastMissAdaptivePoint = (page) => page.evaluate(() => {
  const state = globalThis.__PRAX_TEST__.getState();
  const metrics = state.nodes
    .filter(({ nodeType }) => nodeType !== 'universe_root')
    .map(({ id }) => globalThis.__PRAX_TEST__.getNodeScreenMetrics(id, 'touch'))
    .filter(Boolean);
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const compareIds = (left, right) => left < right ? -1 : (left > right ? 1 : 0);

  for (const target of metrics) {
    if (!(target.effectiveRadiusPx > target.projectedRadiusPx + 4)) continue;
    const radius = Math.min(
      target.effectiveRadiusPx - 2,
      Math.max(target.projectedRadiusPx + 4, (target.projectedRadiusPx + target.effectiveRadiusPx) / 2)
    );
    for (const [dx, dy] of directions) {
      const x = target.x + dx * radius;
      const y = target.y + dy * radius;
      if (x < 8 || x > innerWidth - 8 || y < 8 || y > innerHeight - 8) continue;
      const candidates = [];
      let raycastMiss = true;
      for (const candidate of metrics) {
        const centerDistancePx = Math.hypot(x - candidate.x, y - candidate.y);
        if (centerDistancePx <= candidate.projectedRadiusPx + 2) raycastMiss = false;
        if (centerDistancePx <= candidate.effectiveRadiusPx) {
          const band = Math.max(1, candidate.effectiveRadiusPx - candidate.projectedRadiusPx);
          candidates.push({
            nodeId: candidate.nodeId,
            depth: candidate.depth,
            normalizedBoundaryDistance: Math.max(0, centerDistancePx - candidate.projectedRadiusPx) / band
          });
        }
      }
      if (!raycastMiss || candidates.length === 0) continue;
      candidates.sort((left, right) => {
        const boundary = left.normalizedBoundaryDistance - right.normalizedBoundaryDistance;
        if (Math.abs(boundary) > 1e-9) return boundary;
        const depth = left.depth - right.depth;
        if (Math.abs(depth) > 1e-9) return depth;
        return compareIds(left.nodeId, right.nodeId);
      });
      return { x, y, expectedNodeId: candidates[0].nodeId, targetMetrics: target, candidates };
    }
  }
  return null;
});

const verifyAdaptiveInteraction = async (page, viewport, projection) => {
  await page.evaluate(() => globalThis.__PRAX_TEST__.selectNode(null));
  const before = await getState(page);
  const beforeCanonical = stableJson(canonicalState(before));
  const point = await findRaycastMissAdaptivePoint(page);
  assert.ok(point, `No raycast-miss adaptive point found in ${projection} at ${viewport.name}.`);
  assert.ok(point.targetMetrics.effectiveRadiusPx >= point.targetMetrics.projectedRadiusPx);
  assert.ok(point.targetMetrics.effectiveRadiusPx <= 48 || point.targetMetrics.projectedRadiusPx > 48);

  if (viewport.hasTouch) {
    await page.touchscreen.tap(point.x, point.y);
    await page.waitForFunction(
      (nodeId) => globalThis.__PRAX_TEST__.getState().selectedNodeId === nodeId,
      point.expectedNodeId,
      { timeout: 5000 }
    );
  } else {
    await page.mouse.click(point.x, point.y);
    await sleep(100);
    assert.equal((await getState(page)).selectedNodeId, null);
  }

  const after = await getState(page);
  assert.equal(stableJson(canonicalState(after)), beforeCanonical);
  return { projection, point, selectedNodeId: after.selectedNodeId };
};

const runViewport = async (browser, viewport) => {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    reducedMotion: 'reduce'
  });
  const page = await context.newPage();
  const failures = [];
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`console: ${message.text()}`); });
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => failures.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`));
  page.on('response', (response) => { if (response.status() >= 400) failures.push(`response: ${response.status()} ${response.url()}`); });

  const response = await page.goto(`${baseUrl}/?puxTest=009`, { waitUntil: 'load', timeout: 30000 });
  assert.equal(response?.status(), 200);
  await page.waitForFunction(() => Boolean(globalThis.__PRAX_TEST__?.getNodeScreenMetrics), null, { timeout: 30000 });
  assert.equal(await page.title(), 'Prax — Your Universe');
  const initial = await getState(page);
  assert.equal(initial.applicationVersion, '0.2.0-pux.9');
  assert.equal(await page.evaluate(() => devicePixelRatio), viewport.deviceScaleFactor);

  const sphere = await verifyAdaptiveInteraction(page, viewport, 'sphere');
  await page.click('#view-toggle-btn');
  await page.waitForFunction(() => globalThis.__PRAX_TEST__.getState().currentView === 'grid');
  const grid = await verifyAdaptiveInteraction(page, viewport, 'grid');

  await page.evaluate(() => globalThis.__PRAX_TEST__.search('welcome'));
  await page.waitForFunction(() => globalThis.__PRAX_TEST__.getState().searchlight.total > 0);
  const searchState = await getState(page);
  const searchMetrics = await page.evaluate((nodeId) => globalThis.__PRAX_TEST__.getNodeScreenMetrics(nodeId, 'touch'), searchState.searchlight.activeNodeId);
  assert.ok(searchMetrics);
  assert.ok(searchMetrics.effectiveRadiusPx >= searchMetrics.projectedRadiusPx);
  await page.evaluate(() => globalThis.__PRAX_TEST__.dismissSearch());

  const focusNodeId = initial.nodes.find(({ nodeType }) => nodeType !== 'universe_root').id;
  await page.evaluate((nodeId) => globalThis.__PRAX_TEST__.selectNode(nodeId), focusNodeId);
  const beforeFocusMetrics = await page.evaluate((nodeId) => globalThis.__PRAX_TEST__.getNodeScreenMetrics(nodeId, 'touch'), focusNodeId);
  await page.evaluate((nodeId) => globalThis.__PRAX_TEST__.focusNode(nodeId), focusNodeId);
  await page.waitForFunction(() => globalThis.__PRAX_TEST__.getState().galaxyFocus.state === 'active');
  const focusedMetrics = await page.evaluate((nodeId) => globalThis.__PRAX_TEST__.getNodeScreenMetrics(nodeId, 'touch'), focusNodeId);
  assert.ok(focusedMetrics.projectedRadiusPx > beforeFocusMetrics.projectedRadiusPx);
  assert.ok(focusedMetrics.effectiveRadiusPx >= focusedMetrics.projectedRadiusPx);
  await page.evaluate(() => globalThis.__PRAX_TEST__.backFromFocus());

  const dimensions = await page.evaluate(() => ({
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight
  }));
  assert.equal(dimensions.scrollWidth <= dimensions.viewportWidth, true);
  assert.deepEqual(failures, []);

  await page.screenshot({ path: `${artifactDir}/${viewport.name}.png`, fullPage: true });
  await context.close();
  return { viewport, sphere, grid, searchMetrics, beforeFocusMetrics, focusedMetrics, dimensions, failures };
};

await mkdir(artifactDir, { recursive: true });
const report = { ok: false, baseUrl, health: null, results: [] };
let browser = null;
try {
  report.health = await waitForServer();
  assert.equal(report.health.milestone, 'PUX-009');
  assert.equal(report.health.adaptive_node_hit_testing, true);
  assert.equal(report.health.public_mutation_api, false);
  browser = await chromium.launch({ headless: true });
  for (const viewport of viewports) report.results.push(await runViewport(browser, viewport));
  report.ok = true;
} catch (error) {
  report.error = { name: error?.name ?? 'Error', message: error?.message ?? String(error), stack: error?.stack ?? null };
  const annotation = report.error.message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.error(`::error title=PUX-009 browser verifier::${annotation}`);
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await writeFile(`${artifactDir}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
