import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = (process.env.PRAX_LOCAL_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const artifactDir = process.env.PRAX_VISUAL_ARTIFACT_DIR ?? 'artifacts/pux006-local';
const viewports = [
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true }
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

const assertRootTopology = (state) => {
  assert.equal(state.roots.length, 1);
  const [root] = state.roots;
  const nonRootNodes = state.nodes.filter(({ id }) => id !== root.id);
  for (const node of nonRootNodes) {
    const rootEdges = state.edges.filter(({ edgeType, fromNodeId, toNodeId }) => (
      edgeType === 'contains'
      && fromNodeId === root.id
      && toNodeId === node.id
    ));
    assert.equal(rootEdges.length, 1, `Expected one canonical root edge for ${node.id}.`);
  }
};

const runViewport = async (browser, viewport) => {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch
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

  await page.goto(`${baseUrl}/?puxTest=005`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => Boolean(globalThis.__PRAX_TEST__?.getState), null, { timeout: 30000 });

  const initial = await getState(page);
  assertRootTopology(initial);

  await page.click('#add-btn');
  await page.fill('#node-title-input', `Rejected ${viewport.name} link`);
  await page.fill('#node-url-input', 'javascript:alert(1)');
  const dialogPromise = page.waitForEvent('dialog');
  await page.click('#submit-node-btn');
  const dialog = await dialogPromise;
  assert.match(dialog.message(), /http or https/i);
  await dialog.dismiss();
  await page.waitForFunction(() => !document.querySelector('#submit-node-btn').disabled);

  const afterInvalid = await getState(page);
  assert.equal(afterInvalid.nodes.length, initial.nodes.length);
  assert.equal(afterInvalid.edges.length, initial.edges.length);
  assertRootTopology(afterInvalid);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#modal-backdrop').classList.contains('visible'));

  const title = `PUX-006 ${viewport.name} persisted link`;
  await page.click('#add-btn');
  await page.fill('#node-title-input', title);
  await page.fill('#node-url-input', `https://example.com/pux-006-${viewport.name}`);
  await page.click('#submit-node-btn');
  await page.waitForFunction(() => !document.querySelector('#modal-backdrop').classList.contains('visible'));

  const afterCreate = await getState(page);
  const created = afterCreate.nodes.find((node) => node.title === title);
  assert.ok(created);
  assert.equal(created.url, `https://example.com/pux-006-${viewport.name}`);
  assert.equal(afterCreate.nodes.length, initial.nodes.length + 1);
  assert.equal(afterCreate.edges.length, initial.edges.length + 1);
  assertRootTopology(afterCreate);

  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(globalThis.__PRAX_TEST__?.getState), null, { timeout: 30000 });
  const afterReload = await getState(page);
  assert.equal(afterReload.nodes.some((node) => node.id === created.id && node.url === created.url), true);
  assertRootTopology(afterReload);

  const dimensions = await page.evaluate(() => ({
    viewportWidth: innerWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  assert.equal(dimensions.scrollWidth <= dimensions.viewportWidth, true);
  assert.deepEqual(failures, []);

  await mkdir(artifactDir, { recursive: true });
  await page.screenshot({ path: `${artifactDir}/${viewport.name}.png`, fullPage: true });
  await context.close();

  return {
    viewport,
    initialNodeCount: initial.nodes.length,
    finalNodeCount: afterReload.nodes.length,
    createdNodeId: created.id,
    dimensions,
    failures
  };
};

await mkdir(artifactDir, { recursive: true });
const health = await waitForServer();
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const viewport of viewports) results.push(await runViewport(browser, viewport));
} finally {
  await browser.close();
}

const report = {
  ok: true,
  baseUrl,
  health,
  results
};
await writeFile(`${artifactDir}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
