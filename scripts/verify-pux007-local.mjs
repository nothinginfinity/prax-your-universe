import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = (process.env.PRAX_LOCAL_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const artifactDir = process.env.PRAX_VISUAL_ARTIFACT_DIR ?? 'artifacts/pux007-local';
const viewports = [
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false, reducedMotion: 'no-preference' },
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true, reducedMotion: 'reduce' }
];

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
  throw lastError ?? new Error('Local Prax server did not become ready.');
};

const getState = (page) => page.evaluate(() => globalThis.__PRAX_TEST__.getState());
const roundedCamera = (state) => ({
  position: Object.fromEntries(Object.entries(state.position).map(([key, value]) => [key, Number(value.toFixed(2))])),
  target: Object.fromEntries(Object.entries(state.target).map(([key, value]) => [key, Number(value.toFixed(2))]))
});

const createLink = async (page, suffix) => {
  await page.click('#add-btn');
  await page.fill('#node-title-input', `PUX-007 Link ${suffix}`);
  await page.fill('#node-url-input', `https://example.com/pux-007-${suffix}`);
  await page.click('#submit-node-btn');
  await page.waitForFunction(() => !document.querySelector('#modal-backdrop').classList.contains('visible'));
};

const createNote = async (page, suffix) => {
  await page.click('#add-btn');
  await page.selectOption('#node-type-input', 'note');
  await page.fill('#node-title-input', `PUX-007 Note ${suffix}`);
  await page.fill('#node-body-input', `Nebula body phrase ${suffix}`);
  await page.click('#submit-node-btn');
  await page.waitForFunction(() => !document.querySelector('#modal-backdrop').classList.contains('visible'));
};

const search = async (page, query) => {
  if (!(await page.isVisible('#searchlight-input'))) await page.click('#searchlight-launcher-btn');
  await page.fill('#searchlight-input', query);
  await page.waitForFunction((expected) => globalThis.__PRAX_TEST__.getState().searchlight.query === expected.toLowerCase(), query);
  return getState(page);
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

  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => failures.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`));
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`response: ${response.status()} ${response.url()}`);
  });

  await page.goto(`${baseUrl}/?puxTest=007`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => Boolean(globalThis.__PRAX_TEST__?.getState), null, { timeout: 30000 });
  await createLink(page, viewport.name);
  await createNote(page, viewport.name);

  const baseline = await getState(page);
  const baselineCamera = roundedCamera(baseline.cameraState);
  const baselineSelection = baseline.selectedNodeId;
  const rootId = baseline.roots[0].id;

  await page.evaluate((nodeId) => globalThis.__PRAX_TEST__.selectNode(nodeId), rootId);
  await page.waitForFunction(() => globalThis.__PRAX_TEST__.getState().searchlightOpen === true);
  let rootState = await getState(page);
  assert.equal(rootState.selectedNodeId, rootId);
  assert.equal(await page.isVisible('#searchlight-input'), true);
  assert.equal(await page.getAttribute('#searchlight-launcher-btn', 'aria-expanded'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement?.id === 'searchlight-input'), false);
  assert.equal(await page.locator('#info-panel').evaluate((panel) => panel.classList.contains('root-searchlight-open')), true);
  assert.equal(await page.isVisible('#info-details'), false);
  await page.click('#searchlight-close-btn');
  assert.equal(await page.locator('#info-panel').evaluate((panel) => panel.classList.contains('root-searchlight-open')), false);
  assert.equal(await page.isVisible('#info-details'), true);

  if (viewport.hasTouch) {
    await page.evaluate(() => globalThis.__PRAX_TEST__.selectNode(null));
    const rootScreenPosition = await page.evaluate((nodeId) => globalThis.__PRAX_TEST__.getNodeScreenPosition(nodeId), rootId);
    assert.ok(rootScreenPosition);
    await page.touchscreen.tap(rootScreenPosition.x, rootScreenPosition.y);
    await page.waitForFunction((nodeId) => {
      const state = globalThis.__PRAX_TEST__.getState();
      return state.selectedNodeId === nodeId && state.searchlightOpen === true;
    }, rootId);
    assert.equal(await page.evaluate(() => document.activeElement?.id === 'searchlight-input'), false);
    await page.click('#searchlight-close-btn');
  }
  await page.evaluate((nodeId) => globalThis.__PRAX_TEST__.selectNode(nodeId), baselineSelection);

  await page.keyboard.press('/');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'searchlight-input');

  let state = await search(page, `PUX-007 Link ${viewport.name}`);
  if (viewport.reducedMotion === 'no-preference') await sleep(550);
  state = await getState(page);
  assert.notDeepEqual(roundedCamera(state.cameraState).target, baselineCamera.target);
  assert.equal(state.searchlight.total, 1);
  assert.equal(state.nodes.find(({ id }) => id === state.searchlight.activeNodeId)?.title, `PUX-007 Link ${viewport.name}`);
  assert.equal(state.selectedNodeId, state.searchlight.activeNodeId);
  assert.equal(state.emphasis.neighborhoodNodeIds.includes(state.searchlight.activeNodeId), true);
  assert.equal(state.emphasis.neighborhoodNodeIds.length >= 2, true);
  const activeVisual = state.renderedNodes.find(({ nodeId }) => nodeId === state.searchlight.activeNodeId);
  const unrelatedVisual = state.renderedNodes.find(({ nodeId }) => !state.emphasis.neighborhoodNodeIds.includes(nodeId) && !state.searchlight.resultIds.includes(nodeId));
  assert.equal(activeVisual.scale >= 1.6, true);
  assert.equal(activeVisual.opacity, 1);
  assert.equal(unrelatedVisual.opacity < 0.2, true);
  assert.equal(state.renderedEdges.some(({ opacity }) => opacity >= 0.85), true);

  state = await search(page, `example.com/pux-007-${viewport.name}`);
  assert.equal(state.searchlight.total, 1);
  assert.equal(state.nodes.find(({ id }) => id === state.searchlight.activeNodeId)?.nodeType, 'link');

  state = await search(page, `Nebula body phrase ${viewport.name}`);
  assert.equal(state.searchlight.total, 1);
  assert.equal(state.nodes.find(({ id }) => id === state.searchlight.activeNodeId)?.nodeType, 'note');

  state = await search(page, 'note');
  assert.equal(state.searchlight.total >= 4, true);
  const firstResult = state.searchlight.activeNodeId;
  await page.click('#searchlight-next-btn');
  state = await getState(page);
  assert.notEqual(state.searchlight.activeNodeId, firstResult);
  await page.click('#searchlight-previous-btn');
  state = await getState(page);
  assert.equal(state.searchlight.activeNodeId, firstResult);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => globalThis.__PRAX_TEST__.getState().searchlight.query === '');
  if (viewport.reducedMotion === 'no-preference') await sleep(550);
  state = await getState(page);
  assert.equal(state.selectedNodeId, baselineSelection);
  assert.deepEqual(roundedCamera(state.cameraState), baselineCamera);
  assert.equal(state.emphasis.activeNodeId, null);

  await search(page, 'welcome');
  const searchTouchTargets = await page.evaluate(() => {
    const close = document.querySelector('#searchlight-close-btn').getBoundingClientRect();
    const previous = document.querySelector('#searchlight-previous-btn').getBoundingClientRect();
    const next = document.querySelector('#searchlight-next-btn').getBoundingClientRect();
    const reset = document.querySelector('#reset-view-btn').getBoundingClientRect();
    return {
      close: { width: close.width, height: close.height },
      previous: { width: previous.width, height: previous.height },
      next: { width: next.width, height: next.height },
      reset: { width: reset.width, height: reset.height }
    };
  });
  for (const target of Object.values(searchTouchTargets)) {
    assert.equal(target.width >= 44, true);
    assert.equal(target.height >= 44, true);
  }
  await page.click('#reset-view-btn');
  if (viewport.reducedMotion === 'no-preference') await sleep(550);
  state = await getState(page);
  assert.equal(state.searchlight.query, '');
  assert.equal(state.selectedNodeId, null);
  assert.deepEqual(roundedCamera(state.cameraState).target, { x: 0, y: 0, z: 0 });

  const dimensions = await page.evaluate(() => {
    const searchlight = document.querySelector('#searchlight').getBoundingClientRect();
    const infoPanel = document.querySelector('#info-panel').getBoundingClientRect();
    const launcher = document.querySelector('#searchlight-launcher-btn').getBoundingClientRect();
    return {
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      searchlightLeft: searchlight.left,
      searchlightRight: searchlight.right,
      searchlightTop: searchlight.top,
      searchlightBottom: searchlight.bottom,
      infoPanelLeft: infoPanel.left,
      infoPanelRight: infoPanel.right,
      infoPanelTop: infoPanel.top,
      infoPanelBottom: infoPanel.bottom,
      coveredRatio: (infoPanel.width * infoPanel.height) / (innerWidth * innerHeight),
      launcherLeft: launcher.left,
      launcherRight: launcher.right,
      launcherBottom: launcher.bottom
    };
  });
  assert.equal(dimensions.scrollWidth <= dimensions.viewportWidth, true);
  assert.equal(dimensions.searchlightLeft >= 0, true);
  assert.equal(dimensions.searchlightRight <= dimensions.viewportWidth, true);
  assert.equal(dimensions.searchlightTop >= 0, true);
  assert.equal(dimensions.searchlightBottom <= dimensions.viewportHeight, true);
  assert.equal(dimensions.infoPanelLeft >= 0, true);
  assert.equal(dimensions.infoPanelRight <= dimensions.viewportWidth, true);
  assert.equal(dimensions.infoPanelTop >= 0, true);
  assert.equal(dimensions.infoPanelBottom <= dimensions.viewportHeight, true);
  assert.equal(dimensions.coveredRatio < 0.6, true);
  assert.equal(dimensions.launcherLeft >= 0, true);
  assert.equal(dimensions.launcherRight <= dimensions.viewportWidth, true);
  assert.equal(dimensions.launcherBottom <= dimensions.viewportHeight, true);
  assert.deepEqual(failures, []);

  await page.screenshot({ path: `${artifactDir}/${viewport.name}.png`, fullPage: true });
  await context.close();
  return { viewport, baselineSelection, dimensions, failures };
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
  report.error = {
    name: error?.name ?? 'Error',
    message: error?.message ?? String(error),
    stack: error?.stack ?? null
  };
  const annotation = report.error.message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.error(`::error title=PUX-007 browser verifier::${annotation}`);
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await writeFile(`${artifactDir}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
