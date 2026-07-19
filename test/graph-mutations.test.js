import test from 'node:test';
import assert from 'node:assert/strict';
import { commitGraphMutation } from '../public/js/graph-mutations.js';
import { GraphStore, createSeedSnapshot } from '../public/js/graph-store.js';
import { IndexedDbRepositoryError, PraxIndexedDbRepository } from '../public/js/indexeddb-repository.js';
import { FakeIndexedDbFactory } from '../test-support/fake-indexeddb.js';

test('failed IndexedDB persistence rolls back both the new node and default edge', async () => {
  const indexedDB = new FakeIndexedDbFactory();
  const repository = new PraxIndexedDbRepository({ indexedDB, databaseName: 'prax-mutation-rollback-test' });
  const seed = await repository.loadOrCreate(createSeedSnapshot());
  const store = new GraphStore(seed);
  const before = store.snapshot();
  let projected = false;

  indexedDB.failNextWrite();
  await assert.rejects(
    () => commitGraphMutation({
      store,
      repository,
      mutate: () => store.addLinkWithDefaultEdge('Rollback link', 'https://example.com/rollback-mutation'),
      project: () => {
        projected = true;
      }
    }),
    (error) => error instanceof IndexedDbRepositoryError && error.operation === 'save'
  );

  assert.deepEqual(store.snapshot(), before);
  assert.deepEqual(await repository.loadSnapshot(), before);
  assert.equal(projected, false);
  repository.close();
});

test('successful graph mutation persists before projecting node and edge records', async () => {
  const indexedDB = new FakeIndexedDbFactory();
  const repository = new PraxIndexedDbRepository({ indexedDB, databaseName: 'prax-mutation-success-test' });
  const seed = await repository.loadOrCreate(createSeedSnapshot());
  const store = new GraphStore(seed);
  let projected = null;

  const result = await commitGraphMutation({
    store,
    repository,
    mutate: () => store.addLinkWithDefaultEdge('Persisted link', 'https://example.com/persisted-mutation'),
    project: (records) => {
      projected = records;
    }
  });

  const persisted = new GraphStore(await repository.loadSnapshot());
  assert.equal(projected.node.id, result.node.id);
  assert.equal(projected.edge.id, result.edge.id);
  assert.equal(persisted.getNode(result.node.id).id, result.node.id);
  assert.equal(persisted.getDefaultRootEdge(result.node.id).id, result.edge.id);
  repository.close();
});

test('failed edit persistence restores the prior node and suppresses scene projection', async () => {
  const indexedDB = new FakeIndexedDbFactory();
  const repository = new PraxIndexedDbRepository({ indexedDB, databaseName: 'prax-edit-rollback-test' });
  const seed = await repository.loadOrCreate(createSeedSnapshot());
  const store = new GraphStore(seed);
  const { node } = store.addNoteWithDefaultEdge('Editable', 'Before');
  await repository.saveSnapshot(store.snapshot());
  const before = store.snapshot();
  let projected = false;

  indexedDB.failNextWrite();
  await assert.rejects(
    () => commitGraphMutation({
      store,
      repository,
      mutate: () => store.updateNode(node.id, { title: 'Changed', body: 'After' }),
      project: () => {
        projected = true;
      }
    }),
    (error) => error instanceof IndexedDbRepositoryError && error.operation === 'save'
  );

  assert.deepEqual(store.snapshot(), before);
  assert.deepEqual(await repository.loadSnapshot(), before);
  assert.equal(projected, false);
  repository.close();
});

test('failed delete persistence restores the node and every connected edge', async () => {
  const indexedDB = new FakeIndexedDbFactory();
  const repository = new PraxIndexedDbRepository({ indexedDB, databaseName: 'prax-delete-rollback-test' });
  const seed = await repository.loadOrCreate(createSeedSnapshot());
  const store = new GraphStore(seed);
  const { node: first } = store.addNoteWithDefaultEdge('Delete candidate', 'Body');
  const { node: second } = store.addNoteWithDefaultEdge('Neighbor', 'Body');
  store.addEdge({ edgeType: 'related_to', fromNodeId: first.id, toNodeId: second.id });
  await repository.saveSnapshot(store.snapshot());
  const before = store.snapshot();
  let projected = false;

  indexedDB.failNextWrite();
  await assert.rejects(
    () => commitGraphMutation({
      store,
      repository,
      mutate: () => store.deleteNode(first.id),
      project: () => {
        projected = true;
      }
    }),
    (error) => error instanceof IndexedDbRepositoryError && error.operation === 'save'
  );

  assert.deepEqual(store.snapshot(), before);
  assert.deepEqual(await repository.loadSnapshot(), before);
  assert.equal(projected, false);
  repository.close();
});

test('successful deletion is durable before the scene removes the node', async () => {
  const indexedDB = new FakeIndexedDbFactory();
  const repository = new PraxIndexedDbRepository({ indexedDB, databaseName: 'prax-delete-success-test' });
  const seed = await repository.loadOrCreate(createSeedSnapshot());
  const store = new GraphStore(seed);
  const { node } = store.addNoteWithDefaultEdge('Delete me', 'Body');
  await repository.saveSnapshot(store.snapshot());
  let persistenceObservedInProjection = false;

  await commitGraphMutation({
    store,
    repository,
    mutate: () => store.deleteNode(node.id),
    project: () => {
      const state = indexedDB.inspect('prax-delete-success-test');
      persistenceObservedInProjection = !state.records.nodes.some(({ id }) => id === node.id)
        && !state.records.edges.some(({ fromNodeId, toNodeId }) => fromNodeId === node.id || toNodeId === node.id);
    }
  });

  assert.equal(persistenceObservedInProjection, true);
  assert.equal(store.getNode(node.id), null);
  repository.close();
});
