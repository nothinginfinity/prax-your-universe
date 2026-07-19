import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphValidationError } from '../public/js/graph-schema.js';
import { GraphStore, createSeedSnapshot } from '../public/js/graph-store.js';
import {
  GRAPH_OBJECT_STORES,
  IndexedDbRepositoryError,
  PRAX_DATABASE_VERSION,
  PraxIndexedDbRepository
} from '../public/js/indexeddb-repository.js';
import { FakeIndexedDbFactory } from '../test-support/fake-indexeddb.js';

const createRepository = (indexedDB, databaseName) => new PraxIndexedDbRepository({ indexedDB, databaseName });

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

test('nodes, edges, layouts, layout nodes, and preferences survive repository reloads', async () => {
  const indexedDB = new FakeIndexedDbFactory();
  const databaseName = 'prax-roundtrip-test';
  const store = new GraphStore();
  const first = store.addNode({ originId: 'persisted-1', nodeType: 'note', title: 'Persisted note' });
  const second = store.addNode({ originId: 'persisted-2', nodeType: 'project', title: 'Persisted project' });
  store.addEdge({ edgeType: 'related_to', fromNodeId: first.id, toNodeId: second.id });
  store.setPreferredLayout('grid', '2026-07-19T02:05:00.000Z');

  const writer = createRepository(indexedDB, databaseName);
  await writer.saveSnapshot(store.snapshot());
  writer.close();

  const reader = createRepository(indexedDB, databaseName);
  const restored = new GraphStore(await reader.loadSnapshot());
  assert.equal(restored.getNode(first.id).title, 'Persisted note');
  assert.equal(restored.listEdges().length, 1);
  assert.equal(restored.listLayouts().length, 2);
  assert.equal(restored.getPreferredLayout(), 'grid');
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
