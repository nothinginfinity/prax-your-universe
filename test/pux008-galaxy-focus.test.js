import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GALAXY_FOCUS_STATES,
  GalaxyFocusSession,
  calculateGalaxyFocusPositions,
  captureNodePositionSnapshot,
  getGalaxyFocusNodeGroups,
  positionSnapshotsEqual
} from '../public/js/galaxy-focus.js';

const nodes = [
  { id: 'root' },
  { id: 'alpha' },
  { id: 'beta' },
  { id: 'gamma' },
  { id: 'delta' }
];
const edges = [
  { id: 'e2', fromNodeId: 'root', toNodeId: 'beta' },
  { id: 'e1', fromNodeId: 'alpha', toNodeId: 'root' }
];

test('deterministic one-hop groups are sorted and leave unrelated nodes in the halo', () => {
  const groups = getGalaxyFocusNodeGroups('root', nodes, edges);
  assert.deepEqual(groups.neighborNodeIds, ['alpha', 'beta']);
  assert.deepEqual(groups.unrelatedNodeIds, ['delta', 'gamma']);
  assert.deepEqual(getGalaxyFocusNodeGroups('root', [...nodes].reverse(), [...edges].reverse()), groups);
});

test('sphere and grid focus layouts are deterministic without mutating canonical records', () => {
  const canonical = structuredClone({ nodes, edges });
  const sphere = calculateGalaxyFocusPositions({ focusedNodeId: 'root', nodes, edges, view: 'sphere' });
  const grid = calculateGalaxyFocusPositions({ focusedNodeId: 'root', nodes, edges, view: 'grid' });
  assert.deepEqual(structuredClone({ nodes, edges }), canonical);
  assert.deepEqual(sphere.positions.get('root'), { x: 0, y: 0, z: 0 });
  assert.deepEqual(grid.positions.get('root'), { x: 0, y: 0, z: -10 });
  assert.notDeepEqual(sphere.positions.get('alpha'), grid.positions.get('alpha'));
  assert.deepEqual(
    [...calculateGalaxyFocusPositions({ focusedNodeId: 'root', nodes, edges, view: 'sphere' }).positions],
    [...sphere.positions]
  );
});

test('position snapshots and state transitions support exact restoration', () => {
  const meshByNodeId = new Map([
    ['a', { position: { x: 1, y: 2, z: 3 } }],
    ['b', { position: { x: -4, y: 5, z: 6 } }]
  ]);
  const before = captureNodePositionSnapshot(meshByNodeId);
  meshByNodeId.get('a').position.x = 99;
  const changed = captureNodePositionSnapshot(meshByNodeId);
  assert.equal(positionSnapshotsEqual(before, changed), false);
  meshByNodeId.get('a').position.x = 1;
  assert.equal(positionSnapshotsEqual(before, captureNodePositionSnapshot(meshByNodeId)), true);
  const session = new GalaxyFocusSession();
  assert.equal(session.getState().state, GALAXY_FOCUS_STATES.IDLE);
  session.begin('a', { before });
  assert.equal(session.getState().state, GALAXY_FOCUS_STATES.ENTERING);
  session.activate();
  assert.equal(session.getState().state, GALAXY_FOCUS_STATES.ACTIVE);
  session.beginExit();
  assert.equal(session.getState().state, GALAXY_FOCUS_STATES.EXITING);
  session.clear();
  assert.equal(session.getState().state, GALAXY_FOCUS_STATES.IDLE);
});
