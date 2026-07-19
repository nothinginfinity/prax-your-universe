import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const baseUrl = (process.env.PRAX_LIVE_URL ?? 'https://prax-your-universe.jaredtechfit.workers.dev').replace(/\/$/, '');
const artifactDir = process.env.PRAX_VISUAL_ARTIFACT_DIR ?? 'artifacts/pux005-live';
const profileDir = await mkdtemp(join(tmpdir(), 'prax-pux005-'));
await mkdir(artifactDir, { recursive: true });

const failures = [];
let checkpoint = 'launch';
const context = await chromium.launchPersistentContext(profileDir, {
  headless: true,
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true
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
    const state = globalThis.__PRAX_TEST__?.getState?.();
    return Boolean(state)
      && state.persistenceLabel === 'Local saved'
      && state.workerLabel !== 'Worker checking'
      && state.roots.length === 1
      && state.renderedNodes.length === state.nodes.length
      && state.renderedEdges.length === state.edges.length;
  }, null, { timeout: 30000 });
  await page.waitForTimeout(400);
};

const validateTopology = (state, label) => {
  assert.equal(state.roots.length, 1, `${label}: expected one root`);
  const root = state.roots[0];
  assert.equal(state.universes.length, 1, `${label}: expected one universe`);
  for (const node of state.nodes.filter(({ id }) => id !== root.id)) {
    assert.equal(state.edges.filter((edge) => (
      edge.edgeType === 'contains'
      && edge.fromNodeId === root.id
      && edge.toNodeId === node.id
    )).length, 1, `${label}: node ${node.id} requires one root contains edge`);
  }
  assert.deepEqual(
    state.renderedNodes.map(({ nodeId }) => nodeId).sort(),
    state.nodes.map(({ id }) => id).sort(),
    `${label}: rendered node registry mismatch`
  );
  assert.deepEqual(
    state.renderedEdges.map(({ edgeId }) => edgeId).sort(),
    state.edges.map(({ id }) => id).sort(),
    `${label}: rendered edge registry mismatch`
  );
  assert.equal(new Set(state.renderedNodes.map(({ nodeId }) => nodeId)).size, state.renderedNodes.length, `${label}: duplicate meshes`);
  assert.equal(new Set(state.renderedEdges.map(({ edgeId }) => edgeId)).size, state.renderedEdges.length, `${label}: duplicate edge lines`);
};

const createNode = async ({ nodeType, title, url = '', body = '' }) => {
  await page.click('#add-btn');
  await page.selectOption('#node-type-input', nodeType);
  await page.fill('#node-title-input', title);
  if (nodeType === 'link') await page.fill('#node-url-input', url);
  if (nodeType === 'note') await page.fill('#node-body-input', body);
  await page.click('#submit-node-btn');
  await page.waitForFunction((expectedTitle) => {
    const state = globalThis.__PRAX_TEST__?.getState?.();
    const node = state?.nodes.find(({ title }) => title === expectedTitle);
    return Boolean(node)
      && state.renderedNodes.some(({ nodeId }) => nodeId === node.id)
      && state.renderedEdges.length === state.edges.length;
  }, title, { timeout: 15000 });
  return (await readState()).nodes.find(({ title: current }) => current === title);
};

const setImportFile = async (name, text) => {
  await page.setInputFiles('#import-file-input', {
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(text)
  });
};

try {
  checkpoint = 'health';
  const healthResponse = await page.request.get(`${baseUrl}/api/health`);
  assert.equal(healthResponse.status(), 200);
  const health = await healthResponse.json();
  assert.equal(health.version, '0.2.0-pux.5');
  assert.equal(health.milestone, 'PUX-005');
  assert.equal(health.prax_bundle_version, 1);
  assert.equal(health.import_export, true);
  assert.equal(health.import_behavior, 'replace-only');
  assert.equal(health.public_mutation_api, false);

  checkpoint = 'desktop startup';
  await page.goto(`${baseUrl}/?puxTest=005`, { waitUntil: 'load', timeout: 30000 });
  await waitForPrax();
  let state = await readState();
  assert.match(state.workerLabel, /0\.2\.0-pux\.5/);
  validateTopology(state, 'desktop startup');
  await page.screenshot({ path: `${artifactDir}/desktop-startup.png`, fullPage: true });

  checkpoint = 'create export records';
  const link = await createNode({
    nodeType: 'link',
    title: 'PUX-005 Export Link',
    url: 'https://example.com/pux-005-export'
  });
  const note = await createNode({
    nodeType: 'note',
    title: 'PUX-005 Export Note',
    body: 'PUX-005 note body before export.'
  });
  state = await readState();
  validateTopology(state, 'after export records');

  checkpoint = 'download export';
  const downloadPromise = page.waitForEvent('download');
  await page.click('#export-btn');
  const download = await downloadPromise;
  const exportPath = `${artifactDir}/${download.suggestedFilename()}`;
  await download.saveAs(exportPath);
  const exportedText = await readFile(exportPath, 'utf8');
  const exported = JSON.parse(exportedText);
  assert.equal(exported.format, 'prax-json');
  assert.equal(exported.bundleVersion, 1);
  assert.equal(exported.graphSchemaVersion, 1);
  assert.equal(exported.graph.universes.length, 1);
  assert.equal(exported.graph.nodes.some(({ id }) => id === link.id), true);
  assert.equal(exported.graph.nodes.some(({ id }) => id === note.id), true);
  assert.equal(exported.graph.nodes.find(({ id }) => id === link.id).url, link.url);
  assert.equal(exported.graph.nodes.find(({ id }) => id === note.id).body, note.body);
  assert.equal(exported.graph.nodes.filter(({ nodeType }) => nodeType === 'universe_root').length, 1);

  checkpoint = 'prepare destructive replacement';
  const replacement = JSON.parse(exportedText);
  replacement.metadata.exportedAt = '2026-07-19T06:30:00.000Z';
  replacement.metadata.verifier = { purpose: 'destructive replacement' };
  replacement.graph.nodes.find(({ id }) => id === link.id).title = 'PUX-005 Imported Link';
  replacement.graph.nodes.find(({ id }) => id === link.id).url = 'https://example.com/pux-005-imported';
  replacement.graph.nodes.find(({ id }) => id === note.id).title = 'PUX-005 Imported Note';
  replacement.graph.nodes.find(({ id }) => id === note.id).body = 'PUX-005 body after import.';
  replacement.graph.settings[0].values.preferredLayout = 'grid';
  const replacementText = `${JSON.stringify(replacement, null, 2)}\n`;
  const discarded = await createNode({
    nodeType: 'note',
    title: 'PUX-005 Discarded Before Import',
    body: 'This node must disappear during replacement.'
  });
  assert.ok((await readState()).nodes.some(({ id }) => id === discarded.id));

  checkpoint = 'validate import modal';
  await setImportFile('replacement.prax.json', replacementText);
  await page.waitForSelector('#import-modal-backdrop.visible', { timeout: 15000 });
  assert.equal(await page.textContent('#import-universe-name'), replacement.graph.universes[0].name);
  assert.match(await page.textContent('#import-counts'), new RegExp(`${replacement.graph.nodes.length} nodes`));
  assert.match(await page.textContent('#import-normalization'), /No topology repair/);
  await page.screenshot({ path: `${artifactDir}/desktop-import-confirmation.png`, fullPage: true });

  checkpoint = 'confirm destructive import';
  await page.click('#confirm-import-btn');
  await page.waitForFunction(({ linkId, noteId, discardedId }) => {
    const state = globalThis.__PRAX_TEST__?.getState?.();
    return state?.nodes.find(({ id }) => id === linkId)?.title === 'PUX-005 Imported Link'
      && state.nodes.find(({ id }) => id === noteId)?.body === 'PUX-005 body after import.'
      && !state.nodes.some(({ id }) => id === discardedId)
      && state.currentView === 'grid'
      && state.renderedNodes.length === state.nodes.length
      && state.renderedEdges.length === state.edges.length;
  }, { linkId: link.id, noteId: note.id, discardedId: discarded.id }, { timeout: 20000 });
  state = await readState();
  assert.equal(state.nodes.find(({ id }) => id === link.id).url, 'https://example.com/pux-005-imported');
  assert.equal(state.nodes.find(({ id }) => id === note.id).title, 'PUX-005 Imported Note');
  assert.equal(state.nodes.some(({ id }) => id === discarded.id), false);
  validateTopology(state, 'after destructive import');
  await page.screenshot({ path: `${artifactDir}/desktop-imported.png`, fullPage: true });

  checkpoint = 'reload imported graph';
  await page.reload({ waitUntil: 'load', timeout: 30000 });
  await waitForPrax();
  state = await readState();
  assert.equal(state.nodes.find(({ id }) => id === link.id)?.title, 'PUX-005 Imported Link');
  assert.equal(state.nodes.find(({ id }) => id === note.id)?.body, 'PUX-005 body after import.');
  assert.equal(state.nodes.some(({ id }) => id === discarded.id), false);
  assert.equal(state.currentView, 'grid');
  validateTopology(state, 'after imported reload');

  checkpoint = 'malformed import non-mutation';
  const beforeMalformed = await readState();
  page.once('dialog', (dialog) => dialog.accept());
  await setImportFile('malformed.prax.json', '{not-json');
  await page.waitForFunction(() => globalThis.__PRAX_TEST__?.getState?.().transferMessage === 'Import rejected');
  const afterMalformed = await readState();
  assert.deepEqual(afterMalformed.nodes, beforeMalformed.nodes);
  assert.deepEqual(afterMalformed.edges, beforeMalformed.edges);

  checkpoint = 'unsupported version non-mutation';
  const unsupported = JSON.parse(replacementText);
  unsupported.bundleVersion = 99;
  page.once('dialog', (dialog) => dialog.accept());
  await setImportFile('future.prax.json', JSON.stringify(unsupported));
  await page.waitForFunction(() => globalThis.__PRAX_TEST__?.getState?.().transferMessage === 'Import rejected');
  const afterUnsupported = await readState();
  assert.deepEqual(afterUnsupported.nodes, beforeMalformed.nodes);
  assert.deepEqual(afterUnsupported.edges, beforeMalformed.edges);

  checkpoint = 'mobile import export UI';
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'load', timeout: 30000 });
  await waitForPrax();
  state = await readState();
  assert.equal(state.viewport.width, 390);
  assert.ok(state.viewport.scrollWidth <= 390, `mobile horizontal overflow: ${state.viewport.scrollWidth}`);
  assert.equal(await page.locator('#export-btn').isVisible(), true);
  assert.equal(await page.locator('#import-btn').isVisible(), true);
  await setImportFile('mobile-replacement.prax.json', replacementText);
  await page.waitForSelector('#import-modal-backdrop.visible', { timeout: 15000 });
  const modalBox = await page.locator('.import-modal-container').boundingBox();
  assert.ok(modalBox.width <= 390, `mobile import modal width ${modalBox.width}`);
  await page.screenshot({ path: `${artifactDir}/mobile-import-confirmation.png`, fullPage: true });
  await page.click('#cancel-import-btn');
  const mobileDownloadPromise = page.waitForEvent('download');
  await page.click('#export-btn');
  const mobileDownload = await mobileDownloadPromise;
  assert.match(mobileDownload.suggestedFilename(), /\.prax\.json$/);
  await page.screenshot({ path: `${artifactDir}/mobile-import-export.png`, fullPage: true });

  assert.deepEqual(failures, [], `live browser failures:\n${failures.join('\n')}`);
  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    bundleVersion: 1,
    exportedFilename: download.suggestedFilename(),
    importedLinkId: link.id,
    importedNoteId: note.id,
    discardedNodeId: discarded.id,
    nodeCount: state.nodes.length,
    edgeCount: state.edges.length,
    replaceVerified: true,
    reloadVerified: true,
    malformedRejected: true,
    unsupportedVersionRejected: true,
    desktopVerified: true,
    mobileVerified: true,
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
  console.error(`::error title=PUX-005 live verification::${summary}`);
  throw error;
} finally {
  await context.close();
  await rm(profileDir, { recursive: true, force: true });
}
