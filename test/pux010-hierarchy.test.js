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
import {
  commitChildHierarchyMutation,
  createChildNodeInput,
  createHierarchyViewModel,
  selectHierarchyNode
} from '../public/js/hierarchy-ui.js';
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

  assert.throws(
    () => upgradeGraphSnapshot(future),
    (error) => /unsupported/i.test(error.message) && error.issues?.[0]?.code === 'schema_version'
  );
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

test('Phase 7 hierarchy UI model exposes the immediate parent and stable-ID ordered direct children only', () => {
  const store = new GraphStore(createSeedSnapshot());
  const parent = firstContentNode(store);
  const children = [
    store.addChildWithHierarchy(parent.id, {
      originId: 'pux010-ui-child-z',
      nodeType: 'note',
      title: 'Z child',
      body: ''
    }).node,
    store.addChildWithHierarchy(parent.id, {
      originId: 'pux010-ui-child-a',
      nodeType: 'note',
      title: 'A child',
      body: ''
    }).node
  ];
  const grandchild = store.addChildWithHierarchy(children[0].id, {
    originId: 'pux010-ui-grandchild',
    nodeType: 'note',
    title: 'Grandchild',
    body: ''
  }).node;

  const parentView = createHierarchyViewModel(store, parent.id);
  const expectedChildIds = children.map(({ id }) => id).sort();
  assert.equal(parentView.parent, null);
  assert.equal(parentView.childCount, 2);
  assert.deepEqual(parentView.children.map(({ id }) => id), expectedChildIds);
  assert.equal(parentView.children.some(({ id }) => id === grandchild.id), false);

  const childView = createHierarchyViewModel(store, children[0].id);
  assert.equal(childView.parent.id, parent.id);
  assert.equal(childView.childCount, 1);
  assert.deepEqual(childView.children.map(({ id }) => id), [grandchild.id]);

  const rootView = createHierarchyViewModel(store, store.getUniverseRoot().id);
  assert.equal(rootView.parent, null);
  assert.equal(rootView.childCount, 0);
  assert.deepEqual(rootView.children, []);
});

test('Phase 7 Add Child uses the composite command, projects both edges, and preserves camera state', async () => {
  const store = new GraphStore(createSeedSnapshot());
  const parent = firstContentNode(store);
  const cameraState = Object.freeze({
    position: Object.freeze({ x: 4, y: 5, z: 19 }),
    target: Object.freeze({ x: 1, y: 2, z: 3 }),
    graphRotation: Object.freeze({ x: 0.1, y: 0.2, z: 0.3 })
  });
  const projectedNodes = [];
  const projectedEdges = [];
  const restoredCameras = [];
  let compositeCalls = 0;
  const originalAddChildWithHierarchy = store.addChildWithHierarchy.bind(store);
  store.addChildWithHierarchy = (parentId, input) => {
    compositeCalls += 1;
    return originalAddChildWithHierarchy(parentId, input);
  };
  const scene = {
    captureCameraState: () => cameraState,
    addNodes: (nodes) => projectedNodes.push(...nodes),
    addEdges: (edges) => projectedEdges.push(...edges),
    restoreCameraState: (state, options) => restoredCameras.push({ state, options }),
    replaceGraph: () => {},
    setView: () => {}
  };

  const result = await commitChildHierarchyMutation({
    store,
    scene,
    parentId: parent.id,
    input: createChildNodeInput({
      nodeType: 'note',
      title: 'UI child',
      body: 'Created from selected-node UI'
    })
  });

  assert.equal(compositeCalls, 1);
  assert.deepEqual(projectedNodes.map(({ id }) => id), [result.node.id]);
  assert.deepEqual(projectedEdges.map(({ id }) => id), [result.rootEdge.id, result.parentEdge.id]);
  assert.deepEqual(projectedEdges.map(({ edgeType }) => edgeType), ['contains', PARENT_EDGE_TYPE]);
  assert.equal(restoredCameras.length, 1);
  assert.strictEqual(restoredCameras[0].state, cameraState);
  assert.deepEqual(restoredCameras[0].options, { immediate: true });
  assert.equal(store.getParent(result.node.id).id, parent.id);
  assert.ok(store.getDefaultRootEdge(result.node.id));

  const parentView = createHierarchyViewModel(store, parent.id);
  assert.equal(parentView.childCount, 1);
  assert.deepEqual(parentView.children.map(({ id }) => id), [result.node.id]);
  for (const record of [...store.snapshot().nodes, ...store.snapshot().edges]) {
    assert.equal('position' in record, false);
    assert.equal('x' in record, false);
    assert.equal('y' in record, false);
    assert.equal('z' in record, false);
  }
});

test('Phase 7 hierarchy navigation selects and navigates to the exact parent or child while rejecting root navigation', () => {
  const store = new GraphStore(createSeedSnapshot());
  const parent = firstContentNode(store);
  const child = store.addChildWithHierarchy(parent.id, {
    originId: 'pux010-ui-navigation-child',
    nodeType: 'link',
    title: 'Navigation child',
    url: 'https://example.com/navigation'
  }).node;
  const selected = [];
  const navigated = [];
  const scene = {
    navigateToNode: (nodeId, options) => navigated.push({ nodeId, options })
  };

  const selectedChild = selectHierarchyNode({
    store,
    scene,
    nodeId: child.id,
    onSelect: (node) => selected.push(node.id),
    immediate: true
  });
  const selectedParent = selectHierarchyNode({
    store,
    scene,
    nodeId: parent.id,
    onSelect: (node) => selected.push(node.id),
    immediate: false
  });
  const selectedRoot = selectHierarchyNode({
    store,
    scene,
    nodeId: store.getUniverseRoot().id,
    onSelect: (node) => selected.push(node.id)
  });

  assert.equal(selectedChild.id, child.id);
  assert.equal(selectedParent.id, parent.id);
  assert.equal(selectedRoot, null);
  assert.deepEqual(selected, [child.id, parent.id]);
  assert.deepEqual(navigated, [
    { nodeId: child.id, options: { immediate: true } },
    { nodeId: parent.id, options: { immediate: false } }
  ]);
});

test('Phase 7 child creation restores canonical and scene state after projection failure', async () => {
  const store = new GraphStore(createSeedSnapshot());
  const parent = firstContentNode(store);
  const before = store.snapshot();
  const cameraState = Object.freeze({
    position: Object.freeze({ x: 2, y: 3, z: 17 }),
    target: Object.freeze({ x: 0, y: 0, z: 0 }),
    graphRotation: Object.freeze({ x: 0, y: 0.4, z: 0 })
  });
  let restoredGraph = null;
  let restoredView = null;
  let restoredCamera = null;
  const scene = {
    captureCameraState: () => cameraState,
    addNodes: () => {},
    addEdges: () => {
      throw new Error('Phase 7 injected projection failure');
    },
    replaceGraph: (nodes, edges) => {
      restoredGraph = { nodes, edges };
    },
    setView: (view, options) => {
      restoredView = { view, options };
    },
    restoreCameraState: (state, options) => {
      restoredCamera = { state, options };
    }
  };

  await assert.rejects(() => commitChildHierarchyMutation({
    store,
    scene,
    parentId: parent.id,
    input: createChildNodeInput({ nodeType: 'note', title: 'Rollback UI child', body: '' })
  }), /Phase 7 injected projection failure/);

  assert.deepEqual(store.snapshot(), before);
  assert.deepEqual(restoredGraph, { nodes: before.nodes, edges: before.edges });
  assert.deepEqual(restoredView, { view: store.getPreferredLayout(), options: { resetCamera: false } });
  assert.strictEqual(restoredCamera.state, cameraState);
  assert.deepEqual(restoredCamera.options, { immediate: true });
});

test('Phase 7 child creation stops before scene projection and restores the graph after persistence failure', async () => {
  const store = new GraphStore(createSeedSnapshot());
  const parent = firstContentNode(store);
  const before = store.snapshot();
  let projected = false;
  const repository = {
    saveSnapshot: async () => {
      throw new Error('Phase 7 injected persistence failure');
    }
  };
  const scene = {
    captureCameraState: () => ({
      position: { x: 0, y: 0, z: 20 },
      target: { x: 0, y: 0, z: 0 },
      graphRotation: { x: 0, y: 0, z: 0 }
    }),
    addNodes: () => {
      projected = true;
    },
    addEdges: () => {
      projected = true;
    },
    restoreCameraState: () => {},
    replaceGraph: () => {},
    setView: () => {}
  };

  await assert.rejects(() => commitChildHierarchyMutation({
    store,
    repository,
    scene,
    parentId: parent.id,
    input: createChildNodeInput({ nodeType: 'link', title: 'Unsaved UI child', url: 'https://example.com/unsaved' })
  }), /Phase 7 injected persistence failure/);

  assert.deepEqual(store.snapshot(), before);
  assert.equal(projected, false);
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

  // Schema validation rejects the trivial one-node cycle before the store's
  // multi-node cycle walk, so the public contract is the specific self_edge code.
  assert.throws(
    () => store.addParentEdge(node.id, node.id),
    (error) => error.issues?.[0]?.code === 'self_edge'
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

test('projection rollback aggregates a scene restore failure after persistence is restored', async () => {
  const indexedDB = new FakeIndexedDbFactory();
  const repository = new PraxIndexedDbRepository({ indexedDB, databaseName: 'pux010-aggregate-rollback' });
  const seed = await repository.loadOrCreate(createSeedSnapshot());
  const store = new GraphStore(seed);
  const parent = firstContentNode(store);
  const before = store.snapshot();
  const projectionError = new Error('scene projection failed before aggregate rollback');
  const restoreError = new Error('scene restore failed during aggregate rollback');
  let restoreSnapshot = null;
  let restoreContext = null;

  await assert.rejects(
    () => commitGraphMutation({
      store,
      repository,
      mutate: () => store.addChildWithHierarchy(parent.id, {
        originId: 'pux010-aggregate-rollback-child',
        nodeType: 'note',
        title: 'Aggregate rollback child',
        body: ''
      }),
      project: () => {
        throw projectionError;
      },
      restore: (snapshot, context) => {
        restoreSnapshot = snapshot;
        restoreContext = context;
        throw restoreError;
      }
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.message, 'Graph mutation projection failed and rollback was incomplete.');
      assert.equal(error.errors.length, 2);
      assert.strictEqual(error.errors[0], projectionError);
      assert.strictEqual(error.errors[1], restoreError);
      return true;
    }
  );

  assert.deepEqual(store.snapshot(), before);
  assert.deepEqual(await repository.loadSnapshot(), before);
  assert.deepEqual(restoreSnapshot, before);
  assert.equal(restoreContext.phase, 'rollback');
  assert.strictEqual(restoreContext.projectionError, projectionError);
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
  const importedHierarchyView = createHierarchyViewModel(importedStore, parent.id);
  assert.equal(importedHierarchyView.childCount, 1);
  assert.deepEqual(importedHierarchyView.children.map(({ id }) => id), [child.id]);
  repository.close();
});
