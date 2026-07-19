import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphValidationError } from '../public/js/graph-schema.js';
import { GraphStore, createSeedSnapshot } from '../public/js/graph-store.js';

test('seed graph identities are deterministic across store instances', () => {
  const first = new GraphStore();
  const second = new GraphStore();
  assert.equal(first.getUniverse().id, second.getUniverse().id);
  assert.deepEqual(first.listNodes().map(({ id }) => id), second.listNodes().map(({ id }) => id));
});

test('addLink returns a validated immutable canonical node', () => {
  const store = new GraphStore();
  const node = store.addLink('Example', 'https://example.com');
  assert.equal(node.nodeType, 'link');
  assert.equal(node.url, 'https://example.com/');
  assert.equal(store.getNode(node.id), node);
  assert.equal(Object.isFrozen(node), true);
  assert.throws(() => {
    node.title = 'Mutated';
  }, TypeError);
});

test('duplicate deterministic node identities fail safely', () => {
  const store = new GraphStore();
  const input = { originId: 'duplicate-origin', nodeType: 'note', title: 'First' };
  store.addNode(input);
  assert.throws(
    () => store.addNode({ ...input, title: 'Second' }),
    (error) => error instanceof GraphValidationError && error.issues[0].code === 'duplicate_id'
  );
});

test('edges require endpoints in the current universe', () => {
  const store = new GraphStore();
  const node = store.addNode({ nodeType: 'note', title: 'Connected node' });
  assert.throws(
    () => store.addEdge({ edgeType: 'references', fromNodeId: node.id, toNodeId: 'missing:node:123' }),
    (error) => error instanceof GraphValidationError && error.issues[0].code === 'missing_reference'
  );
});

test('snapshot round trips preserve IDs and relationships', () => {
  const store = new GraphStore();
  const first = store.addNode({ originId: 'roundtrip-1', nodeType: 'note', title: 'First' });
  const second = store.addNode({ originId: 'roundtrip-2', nodeType: 'project', title: 'Second' });
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
