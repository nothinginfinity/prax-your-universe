import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphValidationError, UNIVERSE_ROOT_NODE_TYPE, validateGraphSnapshot } from '../public/js/graph-schema.js';
import { GraphStore, createSeedSnapshot, upgradeGraphSnapshot } from '../public/js/graph-store.js';
import {
  GRAPH_OBJECT_STORES,
  IndexedDbRepositoryError,
  PRAX_DATABASE_VERSION,
  PraxIndexedDbRepository
} from '../public/js/indexeddb-repository.js';
import { FakeIndexedDbFactory } from '../test-support/fake-indexeddb.js';

const createRepository = (indexedDB, databaseName) => new PraxIndexedDbRepository({ indexedDB, databaseName });

const asPux2Snapshot = (snapshot = createSeedSnapshot()) => {
  const rootIds = new Set(snapshot.nodes
    .filter(({ nodeType }) => nodeType === UNIVERSE_ROOT_NODE_TYPE)
    .map(({ id }) => id));
  return validateGraphSnapshot({
    ...snapshot,
    nodes: snapshot.nodes.filter(({ id }) => !rootIds.has(id)),
    edges: snapshot.edges.filter(({ fromNodeId, toNodeId }) => !rootIds.has(fromNodeId) && !rootIds.has(toNodeId))
  });
};

const seedLegacySnapshot = (indexedDB, databaseName, snapshot) => {
  indexedDB.seedRecords(databaseName, {
    [GRAPH_OBJECT_STORES.universes]: snapshot.universes,
    [GRAPH_OBJECT_STORES.nodes]: snapshot.nodes,
    [GRAPH_OBJECT_STORES.edges]: snapshot.edges,
    [GRAPH_OBJECT_STORES.layouts]: snapshot.layouts,
    [GRAPH_OBJECT_STORES.layoutNodes]: snapshot.layoutNodes,
    [GRAPH_OBJECT_STORES.settings]: snapshot.settings,
    meta: [{
      key: 'graph',
      schemaVersion: snapshot.schemaVersion,
      databaseVersion: PRAX_DATABASE_VERSION,
      savedAt: '2026-07-19T02:00:00.000Z'
    }]
  });
};

test('database initialization creates the versioned normalized object stores', async () => {
  const indexedDB = new FakeIndexedDbFactory();
  const databaseName = 'prax-init-test';
  const repository = createRepository(indexedDB, databaseName);
  await repository.open();
  const state = indexedDB.inspect(databaseName);
  assert.equal(state.version, PRAX_DATABASE_VERSION);
  assert.deepEqual(new Set(state.stores), new Set([...Object.values(GRAPH_OBJECT_STORES), 'meta']));
  repository.close();
});

test('loadOrCreate seeds an empty database and hydrates it across repository instances', async () => {
  const indexedDB = new FakeIndexedDbFactory();
  const databaseName = 'prax-seed-test';
  const first = createRepository(indexedDB, databaseName);
  const seeded = await first.loadOrCreate(createSeedSnapshot());
  first.close();

  const second = createRepository(indexedDB, databaseName);
  const hydrated = await second.loadSnapshot();
  assert.deepEqual(hydrated, seeded);
  second.close();
});

test('nodes, edges, layouts, layout nodes, roots, and preferences survive repository reloads', async () => {
  const indexedDB = new FakeIndexedDbFactory();
  const databaseName = 'prax-roundtrip-test';
  const store = new GraphStore();
  const { node: first } = store.addNodeWithDefaultEdge({ originId: 'persisted-1', nodeType: 'note', title: 'Persisted note' });
  const { node: second } = store.addNodeWithDefaultEdge({ originId: 'persisted-2', nodeType: 'project', title: 'Persisted project' });
  store.addEdge({ edgeType: 'related_to', fromNodeId: first.id, toNodeId: second.id });
  store.setPreferredLayout('grid', '2026-07-19T02:05:00.000Z');

  const writer = createRepository(indexedDB, databaseName);
  await writer.saveSnapshot(store.snapshot());
  writer.close();

  const reader = createRepository(indexedDB, databaseName);
  const restored = new GraphStore(await reader.loadSnapshot());
  assert.equal(restored.getNode(first.id).title, 'Persisted note');
  assert.equal(restored.getUniverseRoot().nodeType, UNIVERSE_ROOT_NODE_TYPE);
  assert.equal(restored.getDefaultRootEdge(first.id).edgeType, 'contains');
  assert.equal(restored.listLayouts().length, 2);
  assert.equal(restored.getPreferredLayout(), 'grid');
  reader.close();
});

test('PUX-004 create, edit, and delete operations survive repository reloads without a database migration', async () => {
  const indexedDB = new FakeIndexedDbFactory();
  const databaseName = 'prax-pux004-crud-test';
  const repository = createRepository(indexedDB, databaseName);
  const store = new GraphStore(await repository.loadOrCreate(createSeedSnapshot()));
  const { node: link } = store.addLinkWithDefaultEdge('Link', 'https://example.com/pux004');
  const { node: note } = store.addNoteWithDefaultEdge('Note', 'Original');
  const editTime = new Date(Date.parse(note.createdAt) + 1000).toISOString();
  const edited = store.updateNode(note.id, { title: 'Edited note', body: 'Edited body' }, editTime);
  await repository.saveSnapshot(store.snapshot());
  repository.close();

  const reader = createRepository(indexedDB, databaseName);
  const restored = new GraphStore(await reader.loadSnapshot());
  assert.equal(restored.getNode(link.id).url, 'https://example.com/pux004');
  assert.equal(restored.getNode(note.id).id, edited.id);
  assert.equal(restored.getNode(note.id).title, 'Edited note');
  assert.equal(restored.getNode(note.id).body, 'Edited body');
  restored.deleteNode(note.id);
  await reader.saveSnapshot(restored.snapshot());
  reader.close();

  const finalReader = createRepository(indexedDB, databaseName);
  const finalStore = new GraphStore(await finalReader.loadSnapshot());
  assert.equal(finalStore.getNode(note.id), null);
  assert.equal(finalStore.listEdges().some(({ fromNodeId, toNodeId }) => fromNodeId === note.id || toNodeId === note.id), false);
  assert.equal(finalStore.getNode(link.id).id, link.id);
  assert.equal(PRAX_DATABASE_VERSION, 1);
  finalReader.close();
});

test('a PUX-002 IndexedDB snapshot upgrades transactionally without data loss', async () => {
  const indexedDB = new FakeIndexedDbFactory();
  const databaseName = 'prax-pux2-upgrade-test';
  const repository = createRepository(indexedDB, databaseName);
  await repository.open();

  const legacyStore = new GraphStore();
  const { node: userLink } = legacyStore.addLinkWithDefaultEdge('Historical link', 'https://example.com/historical');
  legacyStore.setPreferredLayout('grid', '2026-07-19T02:10:00.000Z');
  const pux2 = asPux2Snapshot(legacyStore.snapshot());
  seedLegacySnapshot(indexedDB, databaseName, pux2);

  const loaded = await repository.loadSnapshot();
  assert.equal(loaded.nodes.some(({ nodeType }) => nodeType === UNIVERSE_ROOT_NODE_TYPE), false);
  const upgraded = upgradeGraphSnapshot(loaded);
  await repository.saveSnapshot(upgraded.snapshot);
  repository.close();

  const reader = createRepository(indexedDB, databaseName);
  const restored = new GraphStore(await reader.loadSnapshot());
  assert.equal(restored.getNode(userLink.id).url, userLink.url);
  assert.equal(restored.getNode(userLink.id).provenance.sourceId, userLink.provenance.sourceId);
  assert.equal(restored.getPreferredLayout(), 'grid');
  assert.equal(restored.listLayouts().length, pux2.layouts.length);
  assert.equal(restored.getDefaultRootEdge(userLink.id).edgeType, 'contains');
  assert.equal(restored.listNodes().filter(({ nodeType }) => nodeType === UNIVERSE_ROOT_NODE_TYPE).length, 1);
  reader.close();
});

test('snapshot validation happens before any IndexedDB mutation', async () => {
  const indexedDB = new FakeIndexedDbFactory();
  const databaseName = 'prax-validation-test';
  const repository = createRepository(indexedDB, databaseName);
  const seed = await repository.loadOrCreate(createSeedSnapshot());
  const malformed = { ...seed, nodes: [...seed.nodes, seed.nodes[0]] };
  await assert.rejects(() => repository.saveSnapshot(malformed), GraphValidationError);
  assert.deepEqual(await repository.loadSnapshot(), seed);
  repository.close();
});

test('an aborted write transaction preserves the previous committed graph', async () => {
  const indexedDB = new FakeIndexedDbFactory();
  const databaseName = 'prax-atomic-test';
  const repository = createRepository(indexedDB, databaseName);
  const seed = await repository.loadOrCreate(createSeedSnapshot());
  const modifiedStore = new GraphStore(seed);
  modifiedStore.addLink('Should roll back', 'https://example.com/rollback');

  indexedDB.failNextWrite();
  await assert.rejects(
    () => repository.saveSnapshot(modifiedStore.snapshot()),
    (error) => error instanceof IndexedDbRepositoryError && error.operation === 'save'
  );
  assert.deepEqual(await repository.loadSnapshot(), seed);
  repository.close();
});

test('unavailable IndexedDB fails explicitly instead of silently pretending to persist', async () => {
  const repository = new PraxIndexedDbRepository({ indexedDB: null, databaseName: 'prax-unavailable-test' });
  await assert.rejects(
    () => repository.loadSnapshot(),
    (error) => error instanceof IndexedDbRepositoryError && error.code === 'unavailable'
  );
});

test('opening an unsupported future database version fails closed with a migration error', async () => {
  const indexedDB = new FakeIndexedDbFactory();
  const databaseName = 'prax-migration-gap-test';
  const current = createRepository(indexedDB, databaseName);
  await current.open();
  current.close();

  const future = new PraxIndexedDbRepository({
    indexedDB,
    databaseName,
    databaseVersion: PRAX_DATABASE_VERSION + 1
  });
  await assert.rejects(
    () => future.open(),
    (error) => error instanceof IndexedDbRepositoryError && error.code === 'missing_migration'
  );
  assert.equal(indexedDB.inspect(databaseName).version, PRAX_DATABASE_VERSION);
});
