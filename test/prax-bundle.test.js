import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutNodeRecord } from '../public/js/graph-schema.js';
import { GraphStore, createSeedSnapshot } from '../public/js/graph-store.js';
import {
  PRAX_BUNDLE_FORMAT,
  PRAX_BUNDLE_VERSION,
  PraxBundleError,
  createPraxBundle,
  createPraxExport,
  parsePraxBundleText,
  serializePraxBundle
} from '../public/js/prax-bundle.js';

const EXPORTED_AT = '2026-07-19T06:00:00.000Z';
const clone = (value) => JSON.parse(JSON.stringify(value));
const createRichSnapshot = () => {
  const store = new GraphStore();
  const { node: link } = store.addLinkWithDefaultEdge('Round-trip link', 'https://example.com/round-trip');
  const { node: note } = store.addNoteWithDefaultEdge('Round-trip note', 'Preserved note body');
  store.addEdge({ edgeType: 'related_to', fromNodeId: link.id, toNodeId: note.id });
  store.setPreferredLayout('grid', '2026-07-19T05:59:00.000Z');
  const snapshot = store.snapshot();
  const layout = snapshot.layouts.find(({ layoutType }) => layoutType === 'grid');
  const layoutNode = createLayoutNodeRecord({
    universeId: snapshot.universes[0].id,
    layoutId: layout.id,
    nodeId: note.id,
    position: { x: 1, y: 2, z: 3 },
    provenance: { sourceType: 'user', sourceId: 'layout-test', createdBy: 'test-runner' }
  }, { now: EXPORTED_AT });
  return {
    ...snapshot,
    layoutNodes: [layoutNode]
  };
};

const createExport = () => createPraxExport(createRichSnapshot(), {
  applicationVersion: '0.2.0-pux.5',
  exportedAt: EXPORTED_AT,
  metadata: { extension: { provider: 'test', revision: 2 } }
});

const expectBundleError = (callback, code) => assert.throws(
  callback,
  (error) => error instanceof PraxBundleError && error.code === code
);

test('PUX-005 exports a versioned complete Prax JSON bundle', () => {
  const result = createExport();
  assert.equal(result.bundle.format, PRAX_BUNDLE_FORMAT);
  assert.equal(result.bundle.bundleVersion, PRAX_BUNDLE_VERSION);
  assert.equal(result.bundle.graphSchemaVersion, 1);
  assert.equal(result.bundle.graph.universes.length, 1);
  assert.equal(result.bundle.graph.nodes.some(({ nodeType }) => nodeType === 'universe_root'), true);
  assert.equal(result.bundle.graph.nodes.some(({ nodeType, url }) => nodeType === 'link' && url === 'https://example.com/round-trip'), true);
  assert.equal(result.bundle.graph.nodes.some(({ nodeType, body }) => nodeType === 'note' && body === 'Preserved note body'), true);
  assert.equal(result.bundle.graph.layoutNodes.length, 1);
  assert.equal(result.bundle.graph.settings[0].values.preferredLayout, 'grid');
  assert.deepEqual(result.bundle.metadata.extension, { provider: 'test', revision: 2 });
  assert.match(result.filename, /\.prax\.json$/);
});

test('export serialization is deterministic apart from intentionally supplied timestamp metadata', () => {
  const snapshot = createRichSnapshot();
  const options = {
    applicationVersion: '0.2.0-pux.5',
    exportedAt: EXPORTED_AT,
    metadata: { extension: { provider: 'test', revision: 2 } }
  };
  const first = createPraxExport(snapshot, options);
  const second = createPraxExport(snapshot, options);
  assert.equal(first.json, second.json);
  for (const collection of ['universes', 'nodes', 'edges', 'layouts', 'layoutNodes', 'settings']) {
    const ids = first.bundle.graph[collection].map(({ id }) => id);
    assert.deepEqual(ids, [...ids].sort());
  }
  assert.equal(first.json.endsWith('\n'), true);
});

test('valid export-import round trips preserve IDs, provenance, content, edge types, layouts, and preferences', () => {
  const exported = createExport();
  const imported = parsePraxBundleText(exported.json, { filename: exported.filename });
  assert.deepEqual(imported.snapshot, exported.bundle.graph);
  assert.equal(imported.summary.universeName, exported.bundle.graph.universes[0].name);
  assert.equal(imported.summary.nodeCount, exported.bundle.graph.nodes.length);
  assert.equal(imported.summary.edgeCount, exported.bundle.graph.edges.length);
  assert.equal(imported.summary.normalizationChanged, false);
});

test('legacy version-1 raw snapshots receive only deterministic missing root topology', () => {
  const snapshot = clone(createSeedSnapshot());
  const rootIds = new Set(snapshot.nodes.filter(({ nodeType }) => nodeType === 'universe_root').map(({ id }) => id));
  snapshot.nodes = snapshot.nodes.filter(({ id }) => !rootIds.has(id));
  snapshot.edges = snapshot.edges.filter(({ fromNodeId, toNodeId }) => !rootIds.has(fromNodeId) && !rootIds.has(toNodeId));
  const imported = parsePraxBundleText(JSON.stringify(snapshot), { filename: 'legacy-v1.json' });
  assert.equal(imported.summary.legacy, true);
  assert.equal(imported.summary.normalizationChanged, true);
  assert.equal(imported.summary.addedRootCount, 1);
  assert.equal(imported.summary.addedDefaultEdgeCount, imported.snapshot.nodes.length - 1);
  assert.equal(imported.snapshot.nodes.filter(({ nodeType }) => nodeType === 'universe_root').length, 1);
});

test('malformed JSON and unsupported versions are rejected', () => {
  expectBundleError(() => parsePraxBundleText('{broken'), 'malformed_json');
  const bundle = clone(createExport().bundle);
  bundle.bundleVersion = 99;
  expectBundleError(() => parsePraxBundleText(JSON.stringify(bundle)), 'bundle_version');
  bundle.bundleVersion = 1;
  bundle.graphSchemaVersion = 99;
  expectBundleError(() => parsePraxBundleText(JSON.stringify(bundle)), 'graph_schema_version');
});

test('duplicate node IDs and duplicate edge IDs are rejected', () => {
  const nodeBundle = clone(createExport().bundle);
  nodeBundle.graph.nodes.push(clone(nodeBundle.graph.nodes[0]));
  expectBundleError(() => parsePraxBundleText(JSON.stringify(nodeBundle)), 'graph_validation');
  const edgeBundle = clone(createExport().bundle);
  edgeBundle.graph.edges.push(clone(edgeBundle.graph.edges[0]));
  expectBundleError(() => parsePraxBundleText(JSON.stringify(edgeBundle)), 'graph_validation');
});

test('multiple universes and multiple roots are rejected', () => {
  const multipleUniverses = clone(createExport().bundle);
  const second = clone(multipleUniverses.graph.universes[0]);
  second.id = 'universe:second-import';
  second.originId = 'second-import';
  multipleUniverses.graph.universes.push(second);
  expectBundleError(() => parsePraxBundleText(JSON.stringify(multipleUniverses)), 'universe_count');

  const multipleRoots = clone(createExport().bundle);
  multipleRoots.graph.nodes.push(clone(multipleRoots.graph.nodes.find(({ nodeType }) => nodeType === 'universe_root')));
  expectBundleError(() => parsePraxBundleText(JSON.stringify(multipleRoots)), 'graph_validation');
});

test('missing endpoints, invalid root mutations, and unsupported node or edge types are rejected', () => {
  const missingEndpoint = clone(createExport().bundle);
  missingEndpoint.graph.edges.find(({ edgeType }) => edgeType === 'related_to').toNodeId = 'missing:node:import';
  expectBundleError(() => parsePraxBundleText(JSON.stringify(missingEndpoint)), 'graph_validation');

  const invalidRoot = clone(createExport().bundle);
  const rootId = invalidRoot.graph.nodes.find(({ nodeType }) => nodeType === 'universe_root').id;
  invalidRoot.graph.edges.find(({ fromNodeId }) => fromNodeId === rootId).edgeType = 'references';
  expectBundleError(() => parsePraxBundleText(JSON.stringify(invalidRoot)), 'graph_validation');

  const unsupportedNode = clone(createExport().bundle);
  unsupportedNode.graph.nodes.find(({ nodeType }) => nodeType === 'note').nodeType = 'future_type';
  expectBundleError(() => parsePraxBundleText(JSON.stringify(unsupportedNode)), 'graph_validation');

  const unsupportedEdge = clone(createExport().bundle);
  unsupportedEdge.graph.edges[0].edgeType = 'future_edge';
  expectBundleError(() => parsePraxBundleText(JSON.stringify(unsupportedEdge)), 'graph_validation');
});

test('unknown structural envelope and graph fields are rejected while safe metadata extensions survive', () => {
  const envelope = clone(createExport().bundle);
  envelope.futureStructure = {};
  expectBundleError(() => parsePraxBundleText(JSON.stringify(envelope)), 'unknown_structural_field');

  const graph = clone(createExport().bundle);
  graph.graph.futureRelationships = [];
  expectBundleError(() => parsePraxBundleText(JSON.stringify(graph)), 'unknown_structural_field');

  const safe = clone(createExport().bundle);
  safe.metadata.extension = { nested: ['safe', 1, true] };
  const imported = parsePraxBundleText(JSON.stringify(safe));
  assert.deepEqual(imported.bundle.metadata.extension, safe.metadata.extension);
});

test('unsafe metadata keys and oversized files are rejected', () => {
  const unsafe = clone(createExport().bundle);
  unsafe.metadata = JSON.parse('{"__proto__":{"polluted":true}}');
  expectBundleError(() => parsePraxBundleText(JSON.stringify(unsafe)), 'metadata_key');
  expectBundleError(() => parsePraxBundleText(' '.repeat(32), { maxBytes: 8 }), 'file_too_large');
});

test('bundle creation refuses incomplete multi-universe snapshots', () => {
  const snapshot = clone(createSeedSnapshot());
  const second = clone(snapshot.universes[0]);
  second.id = 'universe:second-export';
  second.originId = 'second-export';
  snapshot.universes.push(second);
  expectBundleError(() => createPraxBundle(snapshot), 'universe_count');
});

test('serializePraxBundle emits the canonical JSON representation', () => {
  const bundle = createExport().bundle;
  assert.deepEqual(JSON.parse(serializePraxBundle(bundle)), bundle);
});
