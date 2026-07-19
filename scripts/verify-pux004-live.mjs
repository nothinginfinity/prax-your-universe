import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const baseUrl = (process.env.PRAX_LIVE_URL ?? 'https://prax-your-universe.jaredtechfit.workers.dev').replace(/\/$/, '');
const artifactDir = process.env.PRAX_VISUAL_ARTIFACT_DIR ?? 'artifacts/pux004-live';
const profileDir = await mkdtemp(join(tmpdir(), 'prax-pux004-'));
await mkdir(artifactDir, { recursive: true });

const failures = [];
let checkpoint = 'launch';
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
  await page.waitForFunction(() => {
    const getState = globalThis.__PRAX_TEST__?.getState;
    if (!getState) return false;
    const state = getState();
    return state.persistenceLabel === 'Local saved'
      && state.workerLabel !== 'Worker checking'
      && state.roots.length === 1
      && state.edges.length > 0
      && state.renderedNodes.length === state.nodes.length
      && state.renderedEdges.length === state.edges.length;
  }, null, { timeout: 30000 });
  await page.waitForTimeout(500);
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
    state.renderedNodes.map(({ nodeId }) => nodeId).sort(),
    state.nodes.map(({ id }) => id).sort(),
    `${label}: render registry must contain every canonical node ID`
  );
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
  await page.goto(`${baseUrl}/?puxTest=004`, { waitUntil: 'load', timeout: 30000 });
  await waitForPrax();
};

const createNodeFromUi = async ({ nodeType, title, url = '', body = '' }) => {
  await page.click('#add-btn');
  await page.selectOption('#node-type-input', nodeType);
  await page.fill('#node-title-input', title);
  if (nodeType === 'link') await page.fill('#node-url-input', url);
  if (nodeType === 'note') await page.fill('#node-body-input', body);
  await page.click('#submit-node-btn');
  await page.waitForFunction((expectedTitle) => globalThis.__PRAX_TEST__?.getState().nodes.some(({ title }) => title === expectedTitle), title, { timeout: 15000 });
  return (await readState()).nodes.find((node) => node.title === title);
};

try {
  checkpoint = 'desktop startup';
  await gotoPrax();
  let state = await readState();
  assert.equal(state.currentView, 'sphere', 'desktop startup should restore sphere for a fresh profile');
  assert.equal(state.persistenceLabel, 'Local saved', 'desktop startup should use IndexedDB');
  assert.match(state.workerLabel, /0\.2\.0-pux\.4/, 'health status should expose PUX-004 Worker version');
  validateTopology(state, 'desktop sphere startup');
  await page.screenshot({ path: `${artifactDir}/desktop-startup.png`, fullPage: true });

  checkpoint = 'create link';
  const link = await createNodeFromUi({
    nodeType: 'link',
    title: 'PUX-004 Live Link',
    url: 'https://example.com/pux-004-live-link'
  });
  assert.equal(link.nodeType, 'link');
  assert.equal(link.url, 'https://example.com/pux-004-live-link');

  checkpoint = 'create note';
  const note = await createNodeFromUi({
    nodeType: 'note',
    title: 'PUX-004 Live Note',
    body: 'Original PUX-004 note body.'
  });
  state = await readState();
  validateTopology(state, 'desktop after link and note creation');
  const renderedLink = state.renderedNodes.find(({ nodeId }) => nodeId === link.id);
  const renderedNote = state.renderedNodes.find(({ nodeId }) => nodeId === note.id);
  assert.equal(renderedLink.visualKey, 'link', 'link must render with link metadata');
  assert.equal(renderedNote.visualKey, 'note', 'note must render with note metadata');
  assert.notEqual(renderedLink.visualLabel, renderedNote.visualLabel, 'link and note visual labels must differ');
  await page.screenshot({ path: `${artifactDir}/desktop-created.png`, fullPage: true });

  checkpoint = 'edit note';
  await page.evaluate((nodeId) => globalThis.__PRAX_TEST__.selectNode(nodeId), note.id);
  await page.click('#edit-node-btn');
  assert.equal(await page.isDisabled('#node-type-input'), true, 'node type must be immutable while editing');
  await page.fill('#node-title-input', 'PUX-004 Edited Note');
  await page.fill('#node-body-input', 'Edited PUX-004 note body.');
  await page.click('#submit-node-btn');
  await page.waitForFunction((nodeId) => {
    const node = globalThis.__PRAX_TEST__?.getState().nodes.find(({ id }) => id === nodeId);
    return node?.title === 'PUX-004 Edited Note' && node?.body === 'Edited PUX-004 note body.';
  }, note.id, { timeout: 15000 });
  state = await readState();
  const edited = state.nodes.find(({ id }) => id === note.id);
  assert.equal(edited.id, note.id, 'editing must preserve node identity');
  assert.equal(state.renderedNodes.find(({ nodeId }) => nodeId === note.id).title, 'PUX-004 Edited Note');
  validateTopology(state, 'desktop after note edit');
  await page.screenshot({ path: `${artifactDir}/desktop-edited.png`, fullPage: true });

  checkpoint = 'reload edited graph';
  await page.reload({ waitUntil: 'load', timeout: 30000 });
  await waitForPrax();
  state = await readState();
  assert.equal(state.nodes.find(({ id }) => id === note.id)?.title, 'PUX-004 Edited Note', 'edited note must survive reload');
  assert.equal(state.nodes.find(({ id }) => id === link.id)?.url, link.url, 'created link must survive reload');
  validateTopology(state, 'desktop after edited reload');

  checkpoint = 'delete note and connected edges';
  await page.evaluate((nodeId) => globalThis.__PRAX_TEST__.selectNode(nodeId), note.id);
  page.once('dialog', (dialog) => dialog.accept());
  await page.click('#delete-node-btn');
  await page.waitForFunction((nodeId) => {
    const state = globalThis.__PRAX_TEST__?.getState();
    return !state.nodes.some(({ id }) => id === nodeId)
      && !state.edges.some(({ fromNodeId, toNodeId }) => fromNodeId === nodeId || toNodeId === nodeId)
      && !state.renderedNodes.some(({ nodeId: renderedId }) => renderedId === nodeId)
      && !state.renderedEdges.some(({ fromNodeId, toNodeId }) => fromNodeId === nodeId || toNodeId === nodeId);
  }, note.id, { timeout: 15000 });
  state = await readState();
  assert.equal(state.selectedNodeId, null, 'deleting the selected node must clear selection');
  assert.ok(state.nodes.some(({ id }) => id === link.id), 'deleting a note must not delete unrelated nodes');
  validateTopology(state, 'desktop after note deletion');
  await page.screenshot({ path: `${artifactDir}/desktop-deleted.png`, fullPage: true });

  checkpoint = 'reload deleted graph';
  await page.reload({ waitUntil: 'load', timeout: 30000 });
  await waitForPrax();
  state = await readState();
  assert.equal(state.nodes.some(({ id }) => id === note.id), false, 'deleted note must remain deleted after reload');
  assert.equal(state.edges.some(({ fromNodeId, toNodeId }) => fromNodeId === note.id || toNodeId === note.id), false, 'deleted node edges must remain deleted after reload');
  validateTopology(state, 'desktop after deleted reload');

  checkpoint = 'toggle grid';
  await page.click('#view-toggle-btn');
  await page.waitForFunction(() => globalThis.__PRAX_TEST__?.getState().currentView === 'grid');
  state = await readState();
  validateTopology(state, 'desktop grid');
  await page.screenshot({ path: `${artifactDir}/desktop-grid.png`, fullPage: true });

  checkpoint = 'mobile responsive state';
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'load', timeout: 30000 });
  await waitForPrax();
  state = await readState();
  assert.equal(state.viewport.width, 390, 'mobile viewport width must be applied');
  assert.ok(state.viewport.scrollWidth <= 390, `mobile page must not overflow horizontally: ${state.viewport.scrollWidth}`);
  assert.ok(state.nodes.some(({ id }) => id === link.id), 'persisted link must remain present on mobile');
  assert.equal(state.nodes.some(({ id }) => id === note.id), false, 'deleted note must remain absent on mobile');
  validateTopology(state, 'mobile grid');
  await page.screenshot({ path: `${artifactDir}/mobile-grid.png`, fullPage: true });

  checkpoint = 'mobile create modal';
  await page.click('#add-btn');
  await page.selectOption('#node-type-input', 'note');
  assert.equal(await page.locator('#node-body-field').isVisible(), true, 'mobile note body field must be visible');
  await page.screenshot({ path: `${artifactDir}/mobile-note-modal.png`, fullPage: true });
  await page.click('.modal-cancel-btn');

  assert.deepEqual(failures, [], `live browser failures:\n${failures.join('\n')}`);
  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    rootId: state.roots[0].id,
    persistedLinkId: link.id,
    editedAndDeletedNoteId: note.id,
    nodeCount: state.nodes.length,
    edgeCount: state.edges.length,
    finalView: state.currentView,
    desktopVerified: true,
    mobileVerified: true,
    createVerified: true,
    editVerified: true,
    deleteVerified: true,
    reloadVerified: true,
    errors: failures
  }, null, 2));
} catch (error) {
  const state = await page.evaluate(() => globalThis.__PRAX_TEST__?.getState?.() ?? null).catch(() => null);
  await page.screenshot({ path: `${artifactDir}/failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${artifactDir}/failure.txt`, [
    `checkpoint: ${checkpoint}`,
    error.stack ?? String(error),
    `browser failures: ${JSON.stringify(failures, null, 2)}`,
    `state: ${JSON.stringify(state, null, 2)}`
  ].join('\n\n'));
  const summary = [
    `checkpoint=${checkpoint}`,
    `error=${error.message}`,
    `view=${state?.currentView ?? 'unavailable'}`,
    `worker=${state?.workerLabel ?? 'unavailable'}`,
    `persistence=${state?.persistenceLabel ?? 'unavailable'}`,
    `roots=${state?.roots?.length ?? 'unavailable'}`,
    `nodes=${state?.nodes?.length ?? 'unavailable'}`,
    `edges=${state?.edges?.length ?? 'unavailable'}`,
    `renderedNodes=${state?.renderedNodes?.length ?? 'unavailable'}`,
    `renderedEdges=${state?.renderedEdges?.length ?? 'unavailable'}`,
    `browserFailures=${failures.length}`
  ].join(' | ').replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  console.error(`::error title=PUX-004 live verification::${summary}`);
  throw error;
} finally {
  await context.close();
  await rm(profileDir, { recursive: true, force: true });
}
