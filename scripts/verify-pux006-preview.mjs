import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = (process.env.PRAX_PREVIEW_URL ?? '').replace(/\/$/, '');
const artifactDir = process.env.PRAX_VISUAL_ARTIFACT_DIR ?? 'artifacts/pux006-preview';

assert.match(baseUrl, /^https:\/\//, 'PRAX_PREVIEW_URL must be an HTTPS URL.');
await mkdir(artifactDir, { recursive: true });

const report = {
  ok: false,
  baseUrl,
  health: null,
  staticAssets: [],
  desktop: null,
  mobile: null,
  failures: []
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitForPreview = async () => {
  let lastError = null;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { redirect: 'follow' });
      if (response.ok) return response.json();
      lastError = new Error(`Preview health returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await sleep(2000);
  }
  throw lastError ?? new Error('Preview did not become ready.');
};

const attachFailureCollectors = (page) => {
  const failures = [];
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => failures.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`));
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`response: ${response.status()} ${response.url()}`);
  });
  return failures;
};

const readState = (page) => page.evaluate(() => globalThis.__PRAX_TEST__.getState());

const waitForPrax = async (page) => {
  await page.waitForFunction(() => {
    const state = globalThis.__PRAX_TEST__?.getState?.();
    return Boolean(state)
      && state.persistenceLabel === 'Local saved'
      && state.workerLabel !== 'Worker checking'
      && state.roots.length === 1
      && state.renderedNodes.length === state.nodes.length
      && state.renderedEdges.length === state.edges.length;
  }, null, { timeout: 30000 });
};

const validateIntegrity = (state, label) => {
  assert.equal(state.roots.length, 1, `${label}: expected one canonical root`);
  assert.equal(state.universes.length, 1, `${label}: expected one universe`);
  const [root] = state.roots;
  const nodeIds = new Set(state.nodes.map(({ id }) => id));
  const edgeIds = new Set(state.edges.map(({ id }) => id));
  const layoutIds = new Set(state.layouts.map(({ id }) => id));

  assert.equal(nodeIds.size, state.nodes.length, `${label}: duplicate node IDs`);
  assert.equal(edgeIds.size, state.edges.length, `${label}: duplicate edge IDs`);
  for (const edge of state.edges) {
    assert.equal(nodeIds.has(edge.fromNodeId), true, `${label}: missing from endpoint for ${edge.id}`);
    assert.equal(nodeIds.has(edge.toNodeId), true, `${label}: missing to endpoint for ${edge.id}`);
  }
  for (const node of state.nodes.filter(({ id }) => id !== root.id)) {
    const rootEdges = state.edges.filter(({ edgeType, fromNodeId, toNodeId }) => (
      edgeType === 'contains'
      && fromNodeId === root.id
      && toNodeId === node.id
    ));
    assert.equal(rootEdges.length, 1, `${label}: ${node.id} requires one root contains edge`);
  }
  for (const layoutNode of state.layoutNodes) {
    assert.equal(nodeIds.has(layoutNode.nodeId), true, `${label}: orphan layout node ${layoutNode.nodeId}`);
    assert.equal(layoutIds.has(layoutNode.layoutId), true, `${label}: unknown layout ${layoutNode.layoutId}`);
  }
  assert.deepEqual(
    state.renderedNodes.map(({ nodeId }) => nodeId).sort(),
    [...nodeIds].sort(),
    `${label}: rendered node registry mismatch`
  );
  assert.deepEqual(
    state.renderedEdges.map(({ edgeId }) => edgeId).sort(),
    [...edgeIds].sort(),
    `${label}: rendered edge registry mismatch`
  );
};

const assertNoOverflow = async (page, width, label) => {
  const dimensions = await page.evaluate(() => ({
    viewportWidth: innerWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  assert.equal(dimensions.viewportWidth, width, `${label}: unexpected viewport width`);
  assert.equal(dimensions.scrollWidth <= width, true, `${label}: horizontal overflow ${dimensions.scrollWidth}`);
  return dimensions;
};

const setImportFile = async (page, name, text) => {
  await page.setInputFiles('#import-file-input', {
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(text)
  });
};

const createNode = async (page, { nodeType, title, url = '', body = '', touch = false }) => {
  if (touch) await page.locator('#add-btn').tap();
  else await page.click('#add-btn');
  await page.selectOption('#node-type-input', nodeType);
  await page.fill('#node-title-input', title);
  if (nodeType === 'link') await page.fill('#node-url-input', url);
  if (nodeType === 'note') await page.fill('#node-body-input', body);
  if (touch) await page.locator('#submit-node-btn').tap();
  else await page.click('#submit-node-btn');
  await page.waitForFunction((expectedTitle) => {
    const state = globalThis.__PRAX_TEST__?.getState?.();
    return state?.nodes.some(({ title }) => title === expectedTitle)
      && !document.querySelector('#modal-backdrop').classList.contains('visible');
  }, title, { timeout: 15000 });
  return (await readState(page)).nodes.find(({ title: current }) => current === title);
};

const verifyStaticAssets = async (page) => {
  const resources = await page.evaluate(() => [...document.querySelectorAll('script[src], link[rel="stylesheet"][href]')]
    .map((element) => element.src || element.href));
  const sameOrigin = resources.filter((resource) => new URL(resource).origin === location.origin);
  assert.equal(sameOrigin.some((resource) => resource.endsWith('/styles.css')), true, 'styles.css not referenced');
  assert.equal(sameOrigin.some((resource) => resource.endsWith('/js/app.js')), true, 'app.js not referenced');
  const results = [];
  for (const resource of sameOrigin) {
    const response = await page.request.get(resource);
    results.push({ url: resource, status: response.status() });
    assert.equal(response.ok(), true, `Static asset failed: ${response.status()} ${resource}`);
  }
  return results;
};

const runDesktop = async (browser) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const failures = attachFailureCollectors(page);
  const result = { checkpoints: [] };

  await page.goto(`${baseUrl}/?puxTest=005`, { waitUntil: 'load', timeout: 30000 });
  await waitForPrax(page);
  report.staticAssets = await verifyStaticAssets(page);

  let state = await readState(page);
  validateIntegrity(state, 'desktop initial');
  assert.equal(state.renderedNodes.length > 0, true, 'Three.js graph did not render nodes');
  result.initial = { nodes: state.nodes.length, edges: state.edges.length };
  result.checkpoints.push('root application, health, static assets, Three.js render, canonical topology');

  const beforeInvalid = state;
  await page.click('#add-btn');
  await page.fill('#node-title-input', 'Rejected preview link');
  await page.fill('#node-url-input', 'javascript:alert(1)');
  const invalidDialogPromise = page.waitForEvent('dialog');
  const invalidClickPromise = page.click('#submit-node-btn');
  const invalidDialog = await invalidDialogPromise;
  assert.match(invalidDialog.message(), /http or https/i);
  await invalidDialog.dismiss();
  await invalidClickPromise;
  await page.waitForFunction(() => !document.querySelector('#submit-node-btn').disabled);
  state = await readState(page);
  assert.equal(state.nodes.length, beforeInvalid.nodes.length);
  assert.equal(state.edges.length, beforeInvalid.edges.length);
  validateIntegrity(state, 'after invalid create');
  await page.keyboard.press('Escape');
  result.checkpoints.push('invalid URL rejected without graph mutation');

  const linkTitle = 'PUX-006 remote persisted link';
  const linkUrl = 'https://example.com/pux-006-remote';
  const link = await createNode(page, { nodeType: 'link', title: linkTitle, url: linkUrl });
  assert.ok(link);
  state = await readState(page);
  validateIntegrity(state, 'after valid create');
  const linkEdgeIds = state.edges
    .filter(({ fromNodeId, toNodeId }) => fromNodeId === link.id || toNodeId === link.id)
    .map(({ id }) => id);
  assert.equal(linkEdgeIds.length > 0, true, 'Created link has no connected edge');

  await page.reload({ waitUntil: 'load', timeout: 30000 });
  await waitForPrax(page);
  state = await readState(page);
  assert.equal(state.nodes.some(({ id, url }) => id === link.id && url === linkUrl), true);
  validateIntegrity(state, 'after valid create reload');
  result.checkpoints.push('valid link created and survived reload');

  await page.evaluate((nodeId) => globalThis.__PRAX_TEST__.selectNode(nodeId), link.id);
  await page.click('#edit-node-btn');
  await page.fill('#node-url-input', 'data:text/html,invalid');
  const editDialogPromise = page.waitForEvent('dialog');
  const editClickPromise = page.click('#submit-node-btn');
  const editDialog = await editDialogPromise;
  assert.match(editDialog.message(), /http or https/i);
  await editDialog.dismiss();
  await editClickPromise;
  await page.waitForFunction(() => !document.querySelector('#submit-node-btn').disabled);
  state = await readState(page);
  assert.equal(state.nodes.find(({ id }) => id === link.id)?.url, linkUrl);
  validateIntegrity(state, 'after invalid edit rollback');
  await page.keyboard.press('Escape');
  result.checkpoints.push('invalid link edit rolled back to previous valid value');

  const note = await createNode(page, {
    nodeType: 'note',
    title: 'PUX-006 remote note',
    body: 'Remote preview note persistence evidence.'
  });
  await page.reload({ waitUntil: 'load', timeout: 30000 });
  await waitForPrax(page);
  state = await readState(page);
  assert.equal(state.nodes.find(({ id }) => id === note.id)?.body, 'Remote preview note persistence evidence.');
  validateIntegrity(state, 'after note reload');

  await page.evaluate((nodeId) => globalThis.__PRAX_TEST__.selectNode(nodeId), link.id);
  page.once('dialog', (dialog) => dialog.accept());
  await page.click('#delete-node-btn');
  await page.waitForFunction((nodeId) => !globalThis.__PRAX_TEST__.getState().nodes.some(({ id }) => id === nodeId), link.id);
  state = await readState(page);
  assert.equal(state.edges.some(({ id }) => linkEdgeIds.includes(id)), false);
  assert.equal(state.layoutNodes.some(({ nodeId }) => nodeId === link.id), false);
  validateIntegrity(state, 'after destructive deletion');
  await page.reload({ waitUntil: 'load', timeout: 30000 });
  await waitForPrax(page);
  state = await readState(page);
  assert.equal(state.nodes.some(({ id }) => id === link.id), false);
  assert.equal(state.edges.some(({ id }) => linkEdgeIds.includes(id)), false);
  validateIntegrity(state, 'after deletion reload');
  result.checkpoints.push('delete removed node, connected edges, layout records, and survived reload');

  const validBundle = await page.evaluate(() => globalThis.__PRAX_TEST__.createExport().json);
  const beforeMalformed = await readState(page);
  page.once('dialog', (dialog) => dialog.accept());
  await setImportFile(page, 'malformed.prax.json', '{not-json');
  await page.waitForFunction(() => globalThis.__PRAX_TEST__.getState().transferMessage === 'Import rejected');
  const afterMalformed = await readState(page);
  assert.deepEqual(afterMalformed.nodes, beforeMalformed.nodes);
  assert.deepEqual(afterMalformed.edges, beforeMalformed.edges);

  const unsupported = JSON.parse(validBundle);
  unsupported.bundleVersion = 99;
  page.once('dialog', (dialog) => dialog.accept());
  await setImportFile(page, 'unsupported.prax.json', JSON.stringify(unsupported));
  await page.waitForFunction(() => globalThis.__PRAX_TEST__.getState().transferMessage === 'Import rejected');
  const afterUnsupported = await readState(page);
  assert.deepEqual(afterUnsupported.nodes, beforeMalformed.nodes);
  assert.deepEqual(afterUnsupported.edges, beforeMalformed.edges);
  validateIntegrity(afterUnsupported, 'after rejected imports');
  result.checkpoints.push('malformed and unsupported imports rejected without graph replacement');

  result.dimensions = await assertNoOverflow(page, 1440, 'desktop');
  await page.screenshot({ path: `${artifactDir}/desktop-preview.png`, fullPage: true });
  assert.deepEqual(failures, [], `Desktop browser failures:\n${failures.join('\n')}`);
  result.failures = failures;
  result.final = { nodes: afterUnsupported.nodes.length, edges: afterUnsupported.edges.length };
  await context.close();
  return result;
};

const runMobile = async (browser) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();
  const failures = attachFailureCollectors(page);
  const result = { checkpoints: [] };

  await page.goto(`${baseUrl}/?puxTest=005`, { waitUntil: 'load', timeout: 30000 });
  await waitForPrax(page);
  let state = await readState(page);
  validateIntegrity(state, 'mobile initial');
  assert.equal(await page.locator('#main-canvas').isVisible(), true);
  result.dimensions = await assertNoOverflow(page, 390, 'mobile');

  const initialView = state.currentView;
  await page.locator('#view-toggle-btn').tap();
  await page.waitForFunction((previous) => globalThis.__PRAX_TEST__.getState().currentView !== previous, initialView);
  state = await readState(page);
  validateIntegrity(state, 'mobile after view toggle');
  result.checkpoints.push('touch view control usable');

  const mobileLink = await createNode(page, {
    nodeType: 'link',
    title: 'PUX-006 mobile persisted link',
    url: 'https://example.com/pux-006-mobile',
    touch: true
  });
  await page.reload({ waitUntil: 'load', timeout: 30000 });
  await waitForPrax(page);
  state = await readState(page);
  assert.equal(state.nodes.some(({ id }) => id === mobileLink.id), true);
  validateIntegrity(state, 'mobile after reload');
  result.checkpoints.push('touch creation and IndexedDB reload persistence');

  for (const selector of ['#add-btn', '#view-toggle-btn', '#export-btn', '#import-btn']) {
    const box = await page.locator(selector).boundingBox();
    assert.ok(box, `${selector} has no tap box`);
    assert.equal(box.width > 0 && box.height > 0, true, `${selector} unusable tap box`);
  }

  await page.screenshot({ path: `${artifactDir}/mobile-preview.png`, fullPage: true });
  assert.deepEqual(failures, [], `Mobile browser failures:\n${failures.join('\n')}`);
  result.failures = failures;
  result.final = { nodes: state.nodes.length, edges: state.edges.length, view: state.currentView };
  await context.close();
  return result;
};

let browser = null;
try {
  report.health = await waitForPreview();
  assert.equal(report.health.ok, true);
  assert.equal(report.health.app, 'prax-your-universe');
  assert.equal(report.health.version, '0.2.0-pux.5');
  assert.equal(report.health.milestone, 'PUX-005');
  assert.equal(report.health.graph_schema_version, 1);
  assert.equal(report.health.indexeddb_database_version, 1);
  assert.equal(report.health.public_mutation_api, false);

  browser = await chromium.launch({ headless: true });
  report.desktop = await runDesktop(browser);
  report.mobile = await runMobile(browser);
  report.ok = true;
} catch (error) {
  report.error = {
    name: error?.name ?? 'Error',
    message: error?.message ?? String(error),
    stack: error?.stack ?? null
  };
  const annotation = report.error.message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.error(`::error title=PUX-006 preview verifier::${annotation}`);
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await writeFile(`${artifactDir}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
