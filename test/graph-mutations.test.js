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
