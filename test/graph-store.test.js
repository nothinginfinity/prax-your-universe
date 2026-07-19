import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GraphValidationError,
  UNIVERSE_ROOT_NODE_TYPE,
  createLayoutNodeRecord,
  validateGraphSnapshot
} from '../public/js/graph-schema.js';
import {
  GraphStore,
  createSeedSnapshot,
  upgradeGraphSnapshot
} from '../public/js/graph-store.js';

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

test('seed graph identities and the universe root are deterministic across store instances', () => {
  const first = new GraphStore();
  const second = new GraphStore();
  assert.equal(first.getUniverse().id, second.getUniverse().id);
  assert.equal(first.getUniverseRoot().id, second.getUniverseRoot().id);
  assert.deepEqual(first.listNodes().map(({ id }) => id), second.listNodes().map(({ id }) => id));
  assert.equal(first.listNodes().filter(({ nodeType }) => nodeType === UNIVERSE_ROOT_NODE_TYPE).length, 1);
});

test('seed instruction nodes receive explicit root contains edges', () => {
  const store = new GraphStore();
  const root = store.getUniverseRoot();
  const nonRootNodes = store.listNodes().filter(({ id }) => id !== root.id);
  assert.equal(store.listEdges().length, nonRootNodes.length);
  for (const node of nonRootNodes) {
    const edge = store.getDefaultRootEdge(node.id);
    assert.equal(edge.fromNodeId, root.id);
    assert.equal(edge.toNodeId, node.id);
    assert.equal(edge.edgeType, 'contains');
  }
});

test('PUX-002 snapshots upgrade without losing nodes, layouts, settings, or provenance', () => {
  const pux2 = asPux2Snapshot();
  const originalNodeIds = pux2.nodes.map(({ id }) => id);
  const originalLayoutIds = pux2.layouts.map(({ id }) => id);
  const originalSettings = pux2.settings;
  const upgraded = upgradeGraphSnapshot(pux2);
  assert.equal(upgraded.changed, true);
  assert.deepEqual(
    upgraded.snapshot.nodes.filter(({ nodeType }) => nodeType !== UNIVERSE_ROOT_NODE_TYPE).map(({ id }) => id),
    originalNodeIds
  );
  assert.deepEqual(upgraded.snapshot.layouts.map(({ id }) => id), originalLayoutIds);
  assert.deepEqual(upgraded.snapshot.settings, originalSettings);
  assert.deepEqual(
    upgraded.snapshot.nodes.filter(({ nodeType }) => nodeType !== UNIVERSE_ROOT_NODE_TYPE).map(({ provenance }) => provenance),
    pux2.nodes.map(({ provenance }) => provenance)
  );
});

test('an existing deterministic root is reused after reload', () => {
  const first = new GraphStore();
  const rootId = first.getUniverseRoot().id;
  const restored = new GraphStore(first.snapshot());
  assert.equal(restored.getUniverseRoot().id, rootId);
  assert.equal(restored.listNodes().filter(({ nodeType }) => nodeType === UNIVERSE_ROOT_NODE_TYPE).length, 1);
});

test('addLink creates one immutable node and one default root edge atomically', () => {
  const store = new GraphStore();
  const beforeNodes = store.listNodes().length;
  const beforeEdges = store.listEdges().length;
  const { node, edge } = store.addLinkWithDefaultEdge('Example', 'https://example.com');
  assert.equal(node.nodeType, 'link');
  assert.equal(node.url, 'https://example.com/');
  assert.equal(store.getNode(node.id), node);
  assert.equal(store.getDefaultRootEdge(node.id), edge);
  assert.equal(store.listNodes().length, beforeNodes + 1);
  assert.equal(store.listEdges().length, beforeEdges + 1);
  assert.equal(Object.isFrozen(node), true);
  assert.equal(Object.isFrozen(edge), true);
  assert.throws(() => {
    node.title = 'Mutated';
  }, TypeError);
});

test('addNote creates a durable note record and one default root edge', () => {
  const store = new GraphStore();
  const { node, edge } = store.addNoteWithDefaultEdge('Prax note', 'Captured body');
  assert.equal(node.nodeType, 'note');
  assert.equal(node.body, 'Captured body');
  assert.equal(node.url, null);
  assert.equal(store.getDefaultRootEdge(node.id).id, edge.id);
});

test('duplicate default root edges are not created', () => {
  const store = new GraphStore();
  const { node, edge } = store.addLinkWithDefaultEdge('Example', 'https://example.com/duplicate-check');
  const countBefore = store.listEdges().length;
  const reused = store.ensureDefaultRootEdge(node.id);
  assert.equal(reused.id, edge.id);
  assert.equal(store.listEdges().length, countBefore);
  assert.throws(
    () => store.addEdge({ ...edge, id: 'edge:imported:duplicate-root-edge' }),
    (error) => error instanceof GraphValidationError && ['duplicate_root_edge', 'duplicate_id'].includes(error.issues[0].code)
  );
});

test('failed edge creation rolls back the newly created node', () => {
  const store = new GraphStore();
  const before = store.snapshot();
  const originalAddEdge = store.addEdge;
  store.addEdge = () => {
    throw new GraphValidationError('Injected edge failure.', [{
      path: 'edge',
      code: 'injected_edge_failure',
      message: 'Injected edge failure.'
    }]);
  };
  assert.throws(
    () => store.addLinkWithDefaultEdge('Rollback', 'https://example.com/rollback-edge'),
    (error) => error instanceof GraphValidationError && error.issues[0].code === 'injected_edge_failure'
  );
  store.addEdge = originalAddEdge;
  assert.deepEqual(store.snapshot(), before);
});

test('duplicate deterministic node identities fail safely', () => {
  const store = new GraphStore();
  const input = { originId: 'duplicate-origin', nodeType: 'note', title: 'First' };
  store.addNodeWithDefaultEdge(input);
  assert.throws(
    () => store.addNodeWithDefaultEdge({ ...input, title: 'Second' }),
    (error) => error instanceof GraphValidationError && error.issues[0].code === 'duplicate_id'
  );
});

test('edges require endpoints in the current universe', () => {
  const store = new GraphStore();
  const { node } = store.addNodeWithDefaultEdge({ nodeType: 'note', title: 'Connected node' });
  assert.throws(
    () => store.addEdge({ edgeType: 'references', fromNodeId: node.id, toNodeId: 'missing:node:123' }),
    (error) => error instanceof GraphValidationError && error.issues[0].code === 'missing_reference'
  );
});

test('node edits preserve identity, type, creation metadata, provenance, and edges', () => {
  const store = new GraphStore();
  const { node, edge } = store.addNoteWithDefaultEdge('Original', 'Original body');
  const editTime = new Date(Date.parse(node.createdAt) + 1000).toISOString();
  const edited = store.updateNode(node.id, { title: 'Edited', body: 'Edited body' }, editTime);
  assert.equal(edited.id, node.id);
  assert.equal(edited.originId, node.originId);
  assert.equal(edited.nodeType, node.nodeType);
  assert.equal(edited.createdAt, node.createdAt);
  assert.deepEqual(edited.provenance, node.provenance);
  assert.equal(edited.updatedAt, editTime);
  assert.equal(edited.title, 'Edited');
  assert.equal(edited.body, 'Edited body');
  assert.equal(store.getDefaultRootEdge(node.id).id, edge.id);
});

test('invalid edits and immutable field changes roll back without mutating the node', () => {
  const store = new GraphStore();
  const { node } = store.addNoteWithDefaultEdge('Original', 'Body');
  const before = store.snapshot();
  assert.throws(
    () => store.updateNode(node.id, { url: 'https://example.com/not-allowed' }),
    (error) => error instanceof GraphValidationError && error.issues[0].code === 'node_type_field'
  );
  assert.deepEqual(store.snapshot(), before);
  assert.throws(
    () => store.updateNode(node.id, { nodeType: 'link' }),
    (error) => error instanceof GraphValidationError && error.issues[0].code === 'immutable_field'
  );
  assert.deepEqual(store.snapshot(), before);
});

test('deleting a node removes every connected edge and dependent layout-node record', () => {
  const store = new GraphStore();
  const { node: first } = store.addNoteWithDefaultEdge('First', 'Body');
  const { node: second } = store.addNoteWithDefaultEdge('Second', 'Body');
  const related = store.addEdge({ edgeType: 'related_to', fromNodeId: first.id, toNodeId: second.id });
  const layout = store.listLayouts()[0];
  const layoutNode = createLayoutNodeRecord({
    universeId: first.universeId,
    layoutId: layout.id,
    nodeId: first.id,
    position: { x: 1, y: 2, z: 3 },
    provenance: { sourceType: 'user', sourceId: 'delete-test', createdBy: 'test' }
  });
  const snapshot = store.snapshot();
  store.replaceSnapshot({ ...snapshot, layoutNodes: [layoutNode] });
  const connectedIds = new Set(store.listConnectedEdges(first.id).map(({ id }) => id));
  assert.equal(connectedIds.has(related.id), true);

  const deleted = store.deleteNode(first.id);
  assert.equal(deleted.node.id, first.id);
  assert.deepEqual(new Set(deleted.edges.map(({ id }) => id)), connectedIds);
  assert.equal(deleted.layoutNodes[0].id, layoutNode.id);
  assert.equal(store.getNode(first.id), null);
  assert.equal(store.listEdges().some(({ fromNodeId, toNodeId }) => fromNodeId === first.id || toNodeId === first.id), false);
  assert.equal(store.listLayoutNodes().some(({ nodeId }) => nodeId === first.id), false);
  assert.ok(store.getDefaultRootEdge(second.id));
  assert.doesNotThrow(() => store.snapshot());
});

test('universe root edit and delete operations are rejected without mutation', () => {
  const store = new GraphStore();
  const root = store.getUniverseRoot();
  const before = store.snapshot();
  assert.throws(
    () => store.updateNode(root.id, { title: 'Changed root' }),
    (error) => error instanceof GraphValidationError && error.issues[0].code === 'managed_root'
  );
  assert.throws(
    () => store.deleteNode(root.id),
    (error) => error instanceof GraphValidationError && error.issues[0].code === 'managed_root'
  );
  assert.deepEqual(store.snapshot(), before);
});

test('snapshot round trips preserve IDs and relationships', () => {
  const store = new GraphStore();
  const { node: first } = store.addNodeWithDefaultEdge({ originId: 'roundtrip-1', nodeType: 'note', title: 'First' });
  const { node: second } = store.addNodeWithDefaultEdge({ originId: 'roundtrip-2', nodeType: 'project', title: 'Second' });
  const edge = store.addEdge({ edgeType: 'related_to', fromNodeId: first.id, toNodeId: second.id });
  const restored = new GraphStore(store.snapshot());
  assert.equal(restored.getNode(first.id).id, first.id);
  assert.equal(restored.getNode(second.id).id, second.id);
  assert.equal(restored.getEdge(edge.id).fromNodeId, first.id);
  assert.equal(restored.getEdge(edge.id).toNodeId, second.id);
});

test('replaceSnapshot validates before mutating store state', () => {
  const store = new GraphStore();
  const before = store.listNodes().map(({ id }) => id);
  const malformed = createSeedSnapshot();
  assert.throws(
    () => store.replaceSnapshot({ ...malformed, nodes: [...malformed.nodes, malformed.nodes[0]] }),
    GraphValidationError
  );
  assert.deepEqual(store.listNodes().map(({ id }) => id), before);
});

test('preferred layout is stored in the canonical settings record', () => {
  const store = new GraphStore();
  const original = store.getSettings();
  const updated = store.setPreferredLayout('grid', '2026-07-19T02:00:00.000Z');
  assert.equal(store.getPreferredLayout(), 'grid');
  assert.equal(updated.id, original.id);
  assert.equal(updated.createdAt, original.createdAt);
  assert.equal(updated.updatedAt, '2026-07-19T02:00:00.000Z');
  assert.equal(Object.isFrozen(updated.values), true);
});

test('unsupported preferred layouts fail without mutating settings', () => {
  const store = new GraphStore();
  const before = store.getSettings();
  assert.throws(() => store.setPreferredLayout('galaxy'), GraphValidationError);
  assert.equal(store.getSettings(), before);
});
