import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ROOT_EDGE_TYPE,
  EDGE_TYPES,
  GraphValidationError,
  NODE_TYPES,
  PRAX_SCHEMA_VERSION,
  UNIVERSE_ROOT_NODE_TYPE,
  createEdgeRecord,
  createLayoutNodeRecord,
  createNodeRecord,
  createUniverseRecord,
  createUniverseRootId,
  createUniverseRootOriginId,
  validateGraphSnapshot
} from '../public/js/graph-schema.js';

const NOW = '2026-07-19T01:30:00.000Z';
const provenance = { sourceType: 'user', sourceId: 'test', createdBy: 'test-runner' };
const systemProvenance = { sourceType: 'system', sourceId: 'test-root', createdBy: 'prax' };
const universe = createUniverseRecord({ originId: 'test-universe', name: 'Test', provenance }, { now: NOW });

const nodeInput = (overrides = {}) => ({
  universeId: universe.id,
  originId: 'node-origin-1',
  nodeType: 'note',
  title: 'Original title',
  body: 'Body',
  provenance,
  ...overrides
});

const createRoot = (overrides = {}) => createNodeRecord({
  universeId: universe.id,
  originId: createUniverseRootOriginId(universe.id),
  nodeType: UNIVERSE_ROOT_NODE_TYPE,
  title: universe.name,
  body: 'Canonical root for this universe.',
  provenance: systemProvenance,
  ...overrides
}, { now: NOW });

test('schema exports the planned node and edge types including a dedicated universe root', () => {
  assert.deepEqual(NODE_TYPES, ['universe', 'universe_root', 'link', 'note', 'project', 'document', 'conversation']);
  assert.deepEqual(EDGE_TYPES, ['contains', 'references', 'belongs_to', 'related_to', 'created_from']);
  assert.equal(DEFAULT_ROOT_EDGE_TYPE, 'contains');
  assert.equal(PRAX_SCHEMA_VERSION, 1);
});

test('node identity is stable when mutable content changes', () => {
  const first = createNodeRecord(nodeInput(), { now: NOW });
  const edited = createNodeRecord(nodeInput({ title: 'Edited title', body: 'Edited body' }), { now: NOW });
  assert.equal(first.id, edited.id);
  assert.notEqual(first.title, edited.title);
});

test('universe root identity is deterministic for the universe', () => {
  const first = createRoot();
  const second = createRoot({ title: 'Renamed display title' });
  assert.equal(first.id, createUniverseRootId(universe.id));
  assert.equal(second.id, first.id);
});

test('valid imported IDs are preserved', () => {
  const imported = createNodeRecord(nodeInput({ id: 'external:node:123' }), { now: NOW });
  assert.equal(imported.id, 'external:node:123');
});

test('canonical nodes reject layout coordinates', () => {
  assert.throws(
    () => createNodeRecord(nodeInput({ position: { x: 1, y: 2, z: 3 } }), { now: NOW }),
    (error) => error instanceof GraphValidationError && error.issues[0].code === 'layout_leak'
  );
});

test('link nodes require valid HTTP or HTTPS URLs', () => {
  assert.throws(
    () => createNodeRecord(nodeInput({ nodeType: 'link', url: 'javascript:alert(1)' }), { now: NOW }),
    (error) => error instanceof GraphValidationError && error.issues[0].code === 'url_protocol'
  );
  const link = createNodeRecord(nodeInput({ nodeType: 'link', url: 'https://example.com/path' }), { now: NOW });
  assert.equal(link.url, 'https://example.com/path');
});

test('edge types are explicit and validated', () => {
  const first = createNodeRecord(nodeInput(), { now: NOW });
  const second = createNodeRecord(nodeInput({ originId: 'node-origin-2', title: 'Second' }), { now: NOW });
  assert.throws(
    () => createEdgeRecord({ universeId: universe.id, edgeType: 'similar_to', fromNodeId: first.id, toNodeId: second.id, provenance }, { now: NOW }),
    GraphValidationError
  );
  const edge = createEdgeRecord({ universeId: universe.id, edgeType: 'references', fromNodeId: first.id, toNodeId: second.id, provenance }, { now: NOW });
  assert.equal(edge.edgeType, 'references');
});

test('layout coordinates live in layout-node records', () => {
  const node = createNodeRecord(nodeInput(), { now: NOW });
  const record = createLayoutNodeRecord({
    universeId: universe.id,
    layoutId: 'layout:custom:test',
    nodeId: node.id,
    position: { x: 1, y: 2, z: 3 },
    provenance
  }, { now: NOW });
  assert.deepEqual(record.position, { x: 1, y: 2, z: 3 });
  assert.equal(Object.isFrozen(record.position), true);
});

test('snapshot validation rejects edges with missing endpoints', () => {
  const node = createNodeRecord(nodeInput(), { now: NOW });
  const edge = createEdgeRecord({
    universeId: universe.id,
    edgeType: 'references',
    fromNodeId: node.id,
    toNodeId: 'missing:node:123',
    provenance
  }, { now: NOW });
  assert.throws(
    () => validateGraphSnapshot({
      schemaVersion: 1,
      universes: [universe],
      nodes: [node],
      edges: [edge],
      layouts: [],
      layoutNodes: [],
      settings: []
    }),
    (error) => error instanceof GraphValidationError && error.issues[0].code === 'missing_reference'
  );
});

test('graph validation rejects non-deterministic universe roots', () => {
  const root = createRoot({ id: 'node:wrong-root-id' });
  assert.throws(
    () => validateGraphSnapshot({
      schemaVersion: 1,
      universes: [universe],
      nodes: [root],
      edges: [],
      layouts: [],
      layoutNodes: [],
      settings: []
    }),
    (error) => error instanceof GraphValidationError && error.issues[0].code === 'root_identity'
  );
});

test('graph validation rejects duplicate roots and invalid root edge directions', () => {
  const root = createRoot();
  const duplicateRoot = createRoot({ id: root.id.replace(/.$/, '0') });
  assert.throws(
    () => validateGraphSnapshot({
      schemaVersion: 1,
      universes: [universe],
      nodes: [root, duplicateRoot],
      edges: [],
      layouts: [],
      layoutNodes: [],
      settings: []
    }),
    GraphValidationError
  );

  const node = createNodeRecord(nodeInput(), { now: NOW });
  const invalidEdge = createEdgeRecord({
    universeId: universe.id,
    edgeType: 'references',
    fromNodeId: root.id,
    toNodeId: node.id,
    provenance
  }, { now: NOW });
  assert.throws(
    () => validateGraphSnapshot({
      schemaVersion: 1,
      universes: [universe],
      nodes: [root, node],
      edges: [invalidEdge],
      layouts: [],
      layoutNodes: [],
      settings: []
    }),
    (error) => error instanceof GraphValidationError && error.issues[0].code === 'invalid_root_edge'
  );
});

test('strict graph validation requires one root contains edge for every non-root node', () => {
  const root = createRoot();
  const node = createNodeRecord(nodeInput(), { now: NOW });
  assert.throws(
    () => validateGraphSnapshot({
      schemaVersion: 1,
      universes: [universe],
      nodes: [root, node],
      edges: [],
      layouts: [],
      layoutNodes: [],
      settings: []
    }, { requireUniverseRoots: true }),
    (error) => error instanceof GraphValidationError && error.issues[0].code === 'missing_root_edge'
  );

  const edge = createEdgeRecord({
    universeId: universe.id,
    edgeType: 'contains',
    fromNodeId: root.id,
    toNodeId: node.id,
    provenance: systemProvenance
  }, { now: NOW });
  const valid = validateGraphSnapshot({
    schemaVersion: 1,
    universes: [universe],
    nodes: [root, node],
    edges: [edge],
    layouts: [],
    layoutNodes: [],
    settings: []
  }, { requireUniverseRoots: true });
  assert.equal(valid.edges[0].edgeType, 'contains');
});
