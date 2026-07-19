import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const baseUrl = (process.env.PRAX_LIVE_URL ?? 'https://prax-your-universe.jaredtechfit.workers.dev').replace(/\/$/, '');
const artifactDir = process.env.PRAX_VISUAL_ARTIFACT_DIR ?? 'artifacts/pux003-live';
const profileDir = await mkdtemp(join(tmpdir(), 'prax-pux003-'));
await mkdir(artifactDir, { recursive: true });

const failures = [];
const context = await chromium.launchPersistentContext(profileDir, {
  headless: true,
  viewport: { width: 1440, height: 900 }
});
const page = context.pages()[0] ?? await context.newPage();

page.on('console', (message) => {
  if (message.type() === 'error') failures.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
page.on('requestfailed', (request) => failures.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`));
page.on('response', (response) => {
  if (response.status() >= 400) failures.push(`response: ${response.status()} ${response.url()}`);
});

const readState = () => page.evaluate(() => globalThis.__PRAX_TEST__.getState());

const waitForPrax = async () => {
  await page.waitForFunction(() => Boolean(globalThis.__PRAX_TEST__?.getState), null, { timeout: 15000 });
  await page.waitForTimeout(1500);
};

const almostEqual = (left, right, epsilon = 1e-5) => Math.abs(left - right) <= epsilon;

const validateTopology = (state, label) => {
  assert.equal(state.roots.length, 1, `${label}: expected exactly one universe root`);
  const [root] = state.roots;
  const nonRootNodes = state.nodes.filter(({ id }) => id !== root.id);
  for (const node of nonRootNodes) {
    const rootEdges = state.edges.filter((edge) => (
      edge.edgeType === 'contains'
      && edge.fromNodeId === root.id
      && edge.toNodeId === node.id
    ));
    assert.equal(rootEdges.length, 1, `${label}: node ${node.id} must have one default root edge`);
  }
  assert.deepEqual(
    state.renderedEdges.map(({ edgeId }) => edgeId).sort(),
    state.edges.map(({ id }) => id).sort(),
    `${label}: render registry must contain every canonical edge ID`
  );
  const positions = new Map(state.nodePositions.map(({ nodeId, position }) => [nodeId, position]));
  for (const rendered of state.renderedEdges) {
    assert.equal(rendered.edgeClass, 'explicit', `${label}: edge ${rendered.edgeId} must be explicit`);
    const expected = [...positions.get(rendered.fromNodeId), ...positions.get(rendered.toNodeId)];
    assert.equal(rendered.segment.length, expected.length, `${label}: edge ${rendered.edgeId} segment length`);
    rendered.segment.forEach((value, index) => {
      assert.ok(almostEqual(value, expected[index]), `${label}: edge ${rendered.edgeId} endpoint ${index} is detached`);
    });
  }
};

const gotoPrax = async () => {
  await page.goto(`${baseUrl}/?puxTest=003`, { waitUntil: 'load', timeout: 30000 });
  await waitForPrax();
};

try {
  await gotoPrax();
  let state = await readState();
  assert.equal(state.currentView, 'sphere', 'desktop startup should restore sphere for a fresh profile');
  assert.equal(state.persistenceLabel, 'Local saved', 'desktop startup should use IndexedDB');
  assert.match(state.workerLabel, /0\.2\.0-pux\.3/, 'health status should expose PUX-003 Worker version');
  validateTopology(state, 'desktop sphere startup');
  await page.screenshot({ path: `${artifactDir}/desktop-sphere.png`, fullPage: true });

  const title = 'PUX-003 Live Verification';
  const url = 'https://example.com/pux-003-live-verification';
  await page.click('#add-btn');
  await page.fill('#link-title-input', title);
  await page.fill('#link-url-input', url);
  await page.click('#submit-link-btn');
  await page.waitForFunction((expectedTitle) => (
    globalThis.__PRAX_TEST__?.getState().nodes.some((node) => node.title === expectedTitle)
  ), title, { timeout: 15000 });
  state = await readState();
  const created = state.nodes.find((node) => node.title === title);
  assert.ok(created, 'new link must exist after the UI mutation');
  validateTopology(state, 'desktop sphere after add');

  await page.click('#view-toggle-btn');
  await page.waitForFunction(() => globalThis.__PRAX_TEST__?.getState().currentView === 'grid');
  state = await readState();
  validateTopology(state, 'desktop grid');
  await page.screenshot({ path: `${artifactDir}/desktop-grid.png`, fullPage: true });

  await page.click('#view-toggle-btn');
  await page.waitForFunction(() => globalThis.__PRAX_TEST__?.getState().currentView === 'sphere');
  validateTopology(await readState(), 'desktop sphere restored');

  await page.reload({ waitUntil: 'load', timeout: 30000 });
  await waitForPrax();
  state = await readState();
  const reloaded = state.nodes.find((node) => node.id === created.id);
  assert.ok(reloaded, 'new link must survive a production reload');
  assert.equal(reloaded.url, `${url}/`, 'reloaded link URL must remain canonical');
  validateTopology(state, 'desktop after reload');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'load', timeout: 30000 });
  await waitForPrax();
  state = await readState();
  assert.equal(state.viewport.width, 390, 'mobile viewport width must be applied');
  assert.ok(state.viewport.scrollWidth <= 390, `mobile page must not overflow horizontally: ${state.viewport.scrollWidth}`);
  assert.ok(state.nodes.some((node) => node.id === created.id), 'persisted node must remain present on mobile');
  validateTopology(state, 'mobile sphere');

  await page.click('#view-toggle-btn');
  await page.waitForFunction(() => globalThis.__PRAX_TEST__?.getState().currentView === 'grid');
  state = await readState();
  validateTopology(state, 'mobile grid');
  await page.screenshot({ path: `${artifactDir}/mobile-grid.png`, fullPage: true });

  assert.deepEqual(failures, [], `live browser failures:\n${failures.join('\n')}`);
  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    rootId: state.roots[0].id,
    persistedNodeId: created.id,
    nodeCount: state.nodes.length,
    edgeCount: state.edges.length,
    finalView: state.currentView,
    desktopVerified: true,
    mobileVerified: true,
    reloadVerified: true,
    errors: failures
  }, null, 2));
} finally {
  await context.close();
  await rm(profileDir, { recursive: true, force: true });
}
