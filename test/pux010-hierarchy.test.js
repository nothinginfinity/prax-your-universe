import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PARENT_EDGE_TYPE,
  PRAX_SCHEMA_VERSION,
  createNodeRecord,
  createUniverseRecord
} from '../public/js/graph-schema.js';
import {
  GraphStore,
  createSeedSnapshot,
  createUniverseRootRecord,
  upgradeGraphSnapshot
} from '../public/js/graph-store.js';
import { commitGraphMutation } from '../public/js/graph-mutations.js';
import { PRAX_DATABASE_VERSION, PraxIndexedDbRepository } from '../public/js/indexeddb-repository.js';
import { PRAX_BUNDLE_VERSION, createPraxExport, parsePraxBundleText } from '../public/js/prax-bundle.js';
import { FakeIndexedDbFactory } from '../test-support/fake-indexeddb.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const withoutSchemaVersion = (snapshot) => ({
  ...snapshot,
  schemaVersion: undefined,
  universes: snapshot.universes.map(({ schemaVersion, ...record }) => record),
  nodes: snapshot.nodes.map(({ schemaVersion, ...record }) => record),
  edges: snapshot.edges.map(({ schemaVersion, ...record }) => record),
  layouts: snapshot.layouts.map(({ schemaVersion, ...record }) => record),
  layoutNodes: snapshot.layoutNodes.map(({ schemaVersion, ...record }) => record),
  settings: snapshot.settings.map(({ schemaVersion, ...record }) => record)
});

const firstContentNode = (store) => store.listNodes().find(({ nodeType }) => nodeType !== 'universe_root');

test('schema version 1 migrates to version 2 without manufacturing hierarchy or changing graph identity', () => {
  const current = createSeedSnapshot();
  const legacy = clone(current);
  legacy.schemaVersion = 1;
  for (const collection of ['universes', 'nodes', 'edges', 'layouts', 'layoutNodes', 'settings']) {
    legacy[collection] = legacy[collection].map((record) => ({ ...record, schemaVersion: 1 }));
  }

  const upgraded = upgradeGraphSnapshot(legacy);

  assert.equal(upgraded.changed, true);
  assert.equal(upgraded.snapshot.schemaVersion, PRAX_SCHEMA_VERSION);
  assert.equal(upgraded.snapshot.edges.some(({ edgeType }) => edgeType === PARENT_EDGE_TYPE), false);
  assert.deepEqual(withoutSchemaVersion(upgraded.snapshot), withoutSchemaVersion(current));
  for (const collection of ['universes', 'nodes', 'edges', 'layouts', 'layoutNodes', 'settings']) {
    assert.equal(upgraded.snapshot[collection].every(({ schemaVersion }) => schemaVersion === PRAX_SCHEMA_VERSION), true);
  }
});

test('future graph schema versions are rejected instead of being silently downgraded', () => {
  const future = clone(createSeedSnapshot());
  future.schemaVersion = PRAX_SCHEMA_VERSION + 1;

  assert.throws(() => upgradeGraphSnapshot(future), /unsupported/i);
});

test('addChildWithHierarchy atomically creates child, root membership, and parent edge', () => {
  const store = new GraphStore(createSeedSnapshot());
  const parent = firstContentNode(store);
  const result = store.addChildWithHierarchy(parent.id, {
    originId: 'pux010-child-atomic',
    nodeType: 'note',
    title: 'Direct child',
    body: 'Hierarchy test',
    provenance: { sourceType: 'user', sourceId: 'pux010-test', createdBy: 'test' }
  });

  assert.equal(store.getParent(result.node.id).id, parent.id);
  assert.equal(store.getDefaultRootEdge(result.node.id).id, result.rootEdge.id);
  assert.equal(result.parentEdge.edgeType, PARENT_EDGE_TYPE);
  assert.deepEqual(store.listChildren(parent.id).map(({ id }) => id), [result.node.id]);
  assert.equal(store.getChildCount(parent.id), 1);
  assert.deepEqual(store.listDirectChildren(parent.id).map(({ id }) => id), [result.node.id]);
  assert.equal(store.getDirectChildCount(parent.id), 1);
});

test('hierarchy rejects multiple parents, duplicate relationships, cycles, and root endpoints', () => {
  const store = new GraphStore(createSeedSnapshot());
  const [parent, alternateParent] = store.listNodes().filter(({ nodeType }) => nodeType !== 'universe_root');
  const first = store.addChildWithHierarchy(parent.id, {
    originId: 'pux010-first-child',
    nodeType: 'note',
    title: 'First child',
    body: ''
  }).node;
  const second = store.addChildWithHierarchy(first.id, {
    originId: 'pux010-second-child',
    nodeType: 'note',
    title: 'Second child',
    body: ''
  }).node;

  assert.throws(() => store.addParentEdge(parent.id, first.id), (error) => error.issues?.[0]?.code === 'duplicate_parent_edge');
  assert.throws(() => store.addParentEdge(alternateParent.id, first.id), (error) => error.issues?.[0]?.code === 'multiple_parents');
  assert.throws(() => store.addParentEdge(second.id, parent.id), (error) => error.issues?.[0]?.code === 'hierarchy_cycle');
  assert.throws(() => store.addParentEdge(store.getUniverseRoot().id, alternateParent.id), (error) => error.issues?.[0]?.code === 'invalid_hierarchy_endpoint');
});

test('hierarchy rejects an explicit self-edge as a cycle', () => {
  const store = new GraphStore(createSeedSnapshot());
  const node = firstContentNode(store);

  assert.throws(
    () => store.addParentEdge(node.id, node.id),
    (error) => error.issues?.[0]?.code === 'hierarchy_cycle'
  );
});

test('hierarchy rejects parent and child nodes from different universes', () => {
  const store = new GraphStore(createSeedSnapshot());
  const parent = firstContentNode(store);
  const foreignUniverse = createUniverseRecord({
    id: 'universe_pux010_foreign',
    originId: 'pux010-foreign-universe',
    name: 'Foreign Universe'
  });
  const foreignRoot = createUniverseRootRecord(foreignUniverse);
  const foreignChild = createNodeRecord({
    universeId: foreignUniverse.id,
    originId: 'pux010-foreign-child',
    nodeType: 'note',
    title: 'Foreign child',
    body: ''
  });
  store.universes.set(foreignUniverse.id, foreignUniverse);
  store.nodes.set(foreignRoot.id, foreignRoot);
  store.nodes.set(foreignChild.id, foreignChild);

  assert.throws(
    () => store.addParentEdge(parent.id, foreignChild.id),
    (error) => error.issues?.[0]?.code === 'missing_reference'
  );
});

test('hierarchy permits broad sibling fan-out without a child-count limit', () => {
  const store = new GraphStore(createSeedSnapshot());
  const parent = firstContentNode(store);
  const children = Array.from({ length: 64 }, (_, index) => store.addChildWithHierarchy(parent.id, {
    originId: `pux010-sibling-${index}`,
    nodeType: 'note',
    title: `Sibling ${index}`,
    body: ''
  }).node);

  assert.equal(store.getChildCount(parent.id), children.length);
  assert.deepEqual(store.listChildren(parent.id).map(({ id }) => id), children.map(({ id }) => id));
});

test('composite child creation restores the complete prior snapshot when a later step fails', () => {
  const store = new GraphStore(createSeedSnapshot());
  const parent = firstContentNode(store);
  const before = store.snapshot();
  const originalAddParentEdge = store.addParentEdge;
  store.addParentEdge = () => {
    throw new Error('injected parent edge failure');
  };

  assert.throws(() => store.addChildWithHierarchy(parent.id, {
    originId: 'pux010-rollback-child',
    nodeType: 'note',
    title: 'Rollback child',
    body: ''
  }), /injected parent edge failure/);

  store.addParentEdge = originalAddParentEdge;
  assert.deepEqual(store.snapshot(), before);
});

test('deleting a parent preserves children and root membership while promoting them to top-level', () => {
  const store = new GraphStore(createSeedSnapshot());
  const parent = firstContentNode(store);
  const child = store.addChildWithHierarchy(parent.id, {
    originId: 'pux010-promoted-child',
    nodeType: 'note',
    title: 'Promoted child',
    body: ''
  }).node;

  const deletion = store.deleteNode(parent.id);

  assert.deepEqual(deletion.promotedChildren.map(({ id }) => id), [child.id]);
  assert.equal(store.getNode(child.id).id, child.id);
  assert.equal(store.getParent(child.id), null);
  assert.ok(store.getDefaultRootEdge(child.id));
});

test('projection failure restores and re-persists the previous graph and invokes scene restoration', async () => {
  const indexedDB = new FakeIndexedDbFactory();
  const repository = new PraxIndexedDbRepository({ indexedDB, databaseName: 'pux010-projection-rollback' });
  const seed = await repository.loadOrCreate(createSeedSnapshot());
  const store = new GraphStore(seed);
  const parent = firstContentNode(store);
  const before = store.snapshot();
  let restored = null;

  await assert.rejects(() => commitGraphMutation({
    store,
    repository,
    mutate: () => store.addChildWithHierarchy(parent.id, {
      originId: 'pux010-projection-child',
      nodeType: 'note',
      title: 'Projection child',
      body: ''
    }),
    project: () => {
      throw new Error('scene projection failed');
    },
    restore: (snapshot) => {
      restored = snapshot;
    }
  }), /scene projection failed/);

  assert.deepEqual(store.snapshot(), before);
  assert.deepEqual(await repository.loadSnapshot(), before);
  assert.deepEqual(restored, before);
  repository.close();
});

test('schema v2 hierarchy survives IndexedDB v1 and Prax bundle v1 export/import', async () => {
  assert.equal(PRAX_DATABASE_VERSION, 1);
  assert.equal(PRAX_BUNDLE_VERSION, 1);
  const store = new GraphStore(createSeedSnapshot());
  const parent = firstContentNode(store);
  const child = store.addChildWithHierarchy(parent.id, {
    originId: 'pux010-roundtrip-child',
    nodeType: 'link',
    title: 'Roundtrip child',
    url: 'https://example.com/pux010'
  }).node;

  const indexedDB = new FakeIndexedDbFactory();
  const repository = new PraxIndexedDbRepository({ indexedDB, databaseName: 'pux010-roundtrip' });
  await repository.saveSnapshot(store.snapshot());
  const persisted = new GraphStore(await repository.loadSnapshot());
  assert.equal(persisted.getParent(child.id).id, parent.id);

  const exported = createPraxExport(persisted.snapshot(), { applicationVersion: '0.2.0-pux.10' });
  const imported = parsePraxBundleText(exported.json, { applicationVersion: '0.2.0-pux.10' });
  const importedStore = new GraphStore(imported.snapshot);
  assert.equal(importedStore.getParent(child.id).id, parent.id);
  assert.ok(importedStore.getDefaultRootEdge(child.id));
  repository.close();
});
