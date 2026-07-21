import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GraphValidationError,
  UNIVERSE_ROOT_NODE_TYPE,
  createLayoutNodeRecord,
  validateGraphSnapshot
} from '../public/js/graph-schema.js';
import { GraphStore, createSeedSnapshot, upgradeGraphSnapshot } from '../public/js/graph-store.js';
import {
  PRAX_DATABASE_VERSION,
  PraxIndexedDbRepository
} from '../public/js/indexeddb-repository.js';
import { FakeIndexedDbFactory } from '../test-support/fake-indexeddb.js';

const strictSnapshot = (snapshot) => validateGraphSnapshot(snapshot, { requireUniverseRoots: true });
const createRepository = (indexedDB, databaseName) => new PraxIndexedDbRepository({ indexedDB, databaseName });

const expectGraphIssue = (callback, code) => assert.throws(
  callback,
  (error) => error instanceof GraphValidationError && error.issues[0]?.code === code
);

test('PUX-006 invalid link creation fails closed without mutating graph state', () => {
  const invalidUrls = [
    ['', 'required'],
    ['   ', 'required'],
    ['not a url', 'url'],
    ['ftp://example.com/file', 'url_protocol'],
    ['javascript:alert(1)', 'url_protocol'],
    ['data:text/plain,prax', 'url_protocol']
  ];

  for (const [url, code] of invalidUrls) {
    const store = new GraphStore();
    const before = store.snapshot();
    expectGraphIssue(() => store.addLinkWithDefaultEdge('Rejected link', url), code);
    assert.deepEqual(store.snapshot(), before);
  }
});

test('PUX-006 link URLs are canonicalized and invalid edits roll back atomically', () => {
  const store = new GraphStore();
  const { node } = store.addLinkWithDefaultEdge('Canonical link', '  https://EXAMPLE.com:443/path  ');
  assert.equal(node.url, 'https://example.com/path');

  const before = store.snapshot();
  expectGraphIssue(
    () => store.updateNode(node.id, { title: 'Unsafe edit', url: 'javascript:alert(1)' }),
    'url_protocol'
  );
  assert.deepEqual(store.snapshot(), before);
});

test('PUX-006 deletion removes connected edges and layout-node records while preserving strict graph integrity', () => {
  const store = new GraphStore();
  const { node: target } = store.addNoteWithDefaultEdge('Delete target', 'Connected content');
  const { node: survivor } = store.addNoteWithDefaultEdge('Survivor', 'Must remain');
  const relationship = store.addEdge({
    edgeType: 'related_to',
    fromNodeId: target.id,
    toNodeId: survivor.id
  });
  const layout = store.listLayouts().find(({ layoutType }) => layoutType === 'grid');
  const layoutNode = createLayoutNodeRecord({
    universeId: target.universeId,
    originId: 'pux-006-delete-layout-node',
    layoutId: layout.id,
    nodeId: target.id,
    position: { x: 4, y: 5, z: 6 },
    provenance: { sourceType: 'user', sourceId: 'pux-006', createdBy: 'test-runner' }
  });
  store.replaceSnapshot({
    ...store.snapshot(),
    layoutNodes: [...store.listLayoutNodes(), layoutNode]
  });

  const removed = store.deleteNode(target.id);
  assert.equal(removed.edges.some(({ id }) => id === relationship.id), true);
  assert.equal(removed.layoutNodes.some(({ id }) => id === layoutNode.id), true);
  assert.equal(store.getNode(target.id), null);
  assert.equal(store.getNode(survivor.id)?.id, survivor.id);
  assert.equal(store.listEdges().some(({ fromNodeId, toNodeId }) => fromNodeId === target.id || toNodeId === target.id), false);
  assert.equal(store.listLayoutNodes().some(({ nodeId }) => nodeId === target.id), false);
  assert.deepEqual(strictSnapshot(store.snapshot()), store.snapshot());
});

test('PUX-006 legacy graph upgrade is deterministic and idempotent', () => {
  const seed = createSeedSnapshot();
  const rootIds = new Set(seed.nodes
    .filter(({ nodeType }) => nodeType === UNIVERSE_ROOT_NODE_TYPE)
    .map(({ id }) => id));
  const legacy = validateGraphSnapshot({
    ...seed,
    nodes: seed.nodes.filter(({ id }) => !rootIds.has(id)),
    edges: seed.edges.filter(({ fromNodeId, toNodeId }) => !rootIds.has(fromNodeId) && !rootIds.has(toNodeId))
  });

  const first = upgradeGraphSnapshot(legacy);
  const second = upgradeGraphSnapshot(first.snapshot);
  const root = first.snapshot.nodes.find(({ nodeType }) => nodeType === UNIVERSE_ROOT_NODE_TYPE);
  const nonRootNodes = first.snapshot.nodes.filter(({ nodeType }) => nodeType !== UNIVERSE_ROOT_NODE_TYPE);
  const rootEdges = first.snapshot.edges.filter(({ edgeType, fromNodeId }) => edgeType === 'contains' && fromNodeId === root.id);

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.deepEqual(second.snapshot, first.snapshot);
  assert.equal(first.snapshot.nodes.filter(({ nodeType }) => nodeType === UNIVERSE_ROOT_NODE_TYPE).length, 1);
  assert.equal(rootEdges.length, nonRootNodes.length);
  assert.deepEqual(strictSnapshot(first.snapshot), first.snapshot);
});

test('PUX-006 create, edit, delete, relationships, and preferences survive a full repository reload', async () => {
  const indexedDB = new FakeIndexedDbFactory();
  const databaseName = 'prax-pux006-reload-matrix';
  const writer = createRepository(indexedDB, databaseName);
  const store = new GraphStore(await writer.loadOrCreate(createSeedSnapshot()));
  const { node: link } = store.addLinkWithDefaultEdge('Reload link', 'https://example.com/original');
  const { node: deleted } = store.addNoteWithDefaultEdge('Temporary note', 'Delete before reload');
  store.addEdge({ edgeType: 'related_to', fromNodeId: link.id, toNodeId: deleted.id });
  const editTime = new Date(Date.parse(link.createdAt) + 1000).toISOString();
  store.updateNode(link.id, {
    title: 'Reload link edited',
    url: 'https://example.com/final'
  }, editTime);
  store.deleteNode(deleted.id);
  store.setPreferredLayout('grid', '2026-07-20T12:00:00.000Z');
  const committed = await writer.saveSnapshot(store.snapshot());
  writer.close();

  const reader = createRepository(indexedDB, databaseName);
  const restored = new GraphStore(await reader.loadSnapshot());
  const restoredSnapshot = restored.snapshot();

  assert.deepEqual(restoredSnapshot, committed);
  assert.equal(restored.getNode(link.id)?.title, 'Reload link edited');
  assert.equal(restored.getNode(link.id)?.url, 'https://example.com/final');
  assert.equal(restored.getNode(deleted.id), null);
  assert.equal(restored.listEdges().some(({ fromNodeId, toNodeId }) => fromNodeId === deleted.id || toNodeId === deleted.id), false);
  assert.equal(restored.getDefaultRootEdge(link.id)?.edgeType, 'contains');
  assert.equal(restored.getPreferredLayout(), 'grid');
  assert.equal(PRAX_DATABASE_VERSION, 1);
  assert.deepEqual(strictSnapshot(restoredSnapshot), restoredSnapshot);
  reader.close();
});
