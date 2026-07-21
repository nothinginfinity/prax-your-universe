import test from 'node:test';
import assert from 'node:assert/strict';
import { SearchlightSession, searchNodesExact } from '../public/js/searchlight.js';
import { createNodeCameraState, interpolateCameraState } from '../public/js/camera-navigation.js';
import { createNavigationSnapshot, getExplicitNeighborhoodNodeIds } from '../public/js/graph-navigation.js';

const nodes = [
  { id: 'a', title: 'Alpha Project', body: 'First body', url: null, nodeType: 'project' },
  { id: 'b', title: 'Beta', body: 'Contains Nebula Phrase', url: 'https://example.com/path', nodeType: 'link' },
  { id: 'c', title: 'Gamma', body: '', url: null, nodeType: 'conversation_placeholder' }
];

test('exact local search covers title, body, URL, and node type without fuzzy expansion', () => {
  assert.deepEqual(searchNodesExact(nodes, 'alpha').map(({ id }) => id), ['a']);
  assert.deepEqual(searchNodesExact(nodes, 'NEBULA PHRASE').map(({ id }) => id), ['b']);
  assert.deepEqual(searchNodesExact(nodes, 'example.com/path').map(({ id }) => id), ['b']);
  assert.deepEqual(searchNodesExact(nodes, 'conversation placeholder').map(({ id }) => id), ['c']);
  assert.deepEqual(searchNodesExact(nodes, 'unrelated semantic idea'), []);
  assert.deepEqual(searchNodesExact(nodes, '   '), []);
});

test('Searchlight result traversal is deterministic, wraps, and preserves an active match', () => {
  const session = new SearchlightSession();
  let state = session.update(nodes, 'a');
  assert.deepEqual(state.resultIds, ['a', 'b', 'c']);
  assert.equal(state.activeNodeId, 'a');
  state = session.move(-1);
  assert.equal(state.activeNodeId, 'c');
  state = session.move(1);
  assert.equal(state.activeNodeId, 'a');
  assert.equal(session.select('b'), true);
  state = session.update(nodes, 'b');
  assert.equal(state.activeNodeId, 'b');
  assert.equal(session.select('missing'), false);
});

test('explicit neighborhood lookup includes only the selected node and immediate edge endpoints', () => {
  const edges = [
    { fromNodeId: 'root', toNodeId: 'a' },
    { fromNodeId: 'a', toNodeId: 'b' },
    { fromNodeId: 'b', toNodeId: 'c' }
  ];
  assert.deepEqual(getExplicitNeighborhoodNodeIds('a', edges), ['a', 'root', 'b']);
  assert.equal(getExplicitNeighborhoodNodeIds('a', edges).includes('c'), false);
});

test('navigation snapshots clone camera, selection, and projection state', () => {
  const cameraState = {
    position: { x: 1, y: 2, z: 3 },
    target: { x: 4, y: 5, z: 6 },
    graphRotation: { x: 0, y: 0.5, z: 0 }
  };
  const snapshot = createNavigationSnapshot({ cameraState, selectedNodeId: 'a', projection: 'sphere' });
  cameraState.position.x = 99;
  assert.equal(snapshot.cameraState.position.x, 1);
  assert.equal(snapshot.selectedNodeId, 'a');
  assert.equal(snapshot.projection, 'sphere');
});

test('camera destination and interpolation preserve approach direction deterministically', () => {
  const current = {
    position: { x: 0, y: 0, z: 20 },
    target: { x: 0, y: 0, z: 0 },
    graphRotation: { x: 0, y: 0.25, z: 0 }
  };
  const destination = createNodeCameraState({ x: 3, y: 4, z: 5 }, current, { distance: 8 });
  assert.deepEqual(destination.target, { x: 3, y: 4, z: 5 });
  assert.deepEqual(destination.position, { x: 3, y: 4, z: 13 });
  assert.deepEqual(destination.graphRotation, current.graphRotation);
  const halfway = interpolateCameraState(current, destination, 0.5);
  assert.deepEqual(halfway.target, { x: 1.5, y: 2, z: 2.5 });
  assert.deepEqual(halfway.position, { x: 1.5, y: 2, z: 16.5 });
});
