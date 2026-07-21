import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateGalaxyFocusPositions, captureNodePositionSnapshot, positionSnapshotsEqual } from '../public/js/galaxy-focus.js';

const source = await readFile(new URL('../public/js/galaxy-scene.js', import.meta.url), 'utf8');

test('GalaxyPraxScene extends the accepted renderer and creates no replacement render objects', () => {
  assert.match(source, /class GalaxyPraxScene extends PraxScene/);
  assert.doesNotMatch(source, /new\s+this\.THREE\.(Mesh|Line|Group|SphereGeometry|BufferGeometry)/);
  assert.match(source, /nodeObjectCount/);
  assert.match(source, /edgeObjectCount/);
});

test('scene implementation snapshots then restores exact positions and camera', () => {
  assert.match(source, /captureGalaxySnapshot\(\)/);
  assert.match(source, /captureNodePositionSnapshot\(this\.meshByNodeId\)/);
  assert.match(source, /restoreCameraState\(snapshot\.cameraState/);
  assert.match(source, /positionSnapshotsEqual\(snapshot\.nodePositions, restoredPositions\)/);
  const meshes = new Map([
    ['focus', { position: { x: 1, y: 2, z: 3 } }],
    ['neighbor', { position: { x: 4, y: 5, z: 6 } }]
  ]);
  const before = captureNodePositionSnapshot(meshes);
  const layout = calculateGalaxyFocusPositions({
    focusedNodeId: 'focus',
    nodes: [{ id: 'focus' }, { id: 'neighbor' }],
    edges: [{ fromNodeId: 'focus', toNodeId: 'neighbor' }],
    view: 'sphere'
  });
  for (const [id, position] of layout.positions) Object.assign(meshes.get(id).position, position);
  assert.equal(positionSnapshotsEqual(before, captureNodePositionSnapshot(meshes)), false);
  for (const [id, position] of before) Object.assign(meshes.get(id).position, position);
  assert.equal(positionSnapshotsEqual(before, captureNodePositionSnapshot(meshes)), true);
});

test('scene supports both projection variants and pauses automatic rotation during focus', () => {
  assert.match(source, /view:\s*this\.getView\(\)/);
  assert.match(source, /setView\(view, options = \{\}\)/);
  assert.match(source, /this\.rotationPaused = true/);
  assert.match(source, /applyGalaxyFocusPositions\(this\.galaxyFocusSession\.focusedNodeId\)/);
  assert.doesNotMatch(source, /store\.|repository\.|layoutNodes|canonical/);
});
