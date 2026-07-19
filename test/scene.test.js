import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphStore } from '../public/js/graph-store.js';
import {
  PraxScene,
  calculateEdgeSegment,
  calculateProjectionPositions
} from '../public/js/scene.js';

class FakeVector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.set(x, y, z);
  }

  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(value) {
    return this.set(value.x, value.y, value.z);
  }
}

class FakeVector2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }
}

class FakeGroup {
  constructor() {
    this.children = [];
    this.rotation = { y: 0 };
  }

  add(...objects) {
    this.children.push(...objects);
  }

  remove(object) {
    this.children = this.children.filter((candidate) => candidate !== object);
  }
}

class FakeColor {
  constructor(value = null) {
    this.value = value;
  }

  setHSL(h, s, l) {
    this.hsl = { h, s, l };
    return this;
  }
}

class FakeBufferGeometry {
  constructor() {
    this.attributes = new Map();
    this.disposed = false;
  }

  setAttribute(name, attribute) {
    this.attributes.set(name, attribute);
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }

  computeBoundingSphere() {
    this.boundingSphereComputed = true;
  }

  dispose() {
    this.disposed = true;
  }
}

class FakeFloat32BufferAttribute {
  constructor(values, itemSize) {
    this.array = Float32Array.from(values);
    this.itemSize = itemSize;
    this.needsUpdate = false;
  }

  setXYZ(index, x, y, z) {
    const offset = index * this.itemSize;
    this.array[offset] = x;
    this.array[offset + 1] = y;
    this.array[offset + 2] = z;
  }
}

class FakeMaterial {
  constructor(options = {}) {
    this.options = options;
    this.disposed = false;
  }

  dispose() {
    this.disposed = true;
  }
}

class FakeObject3D {
  constructor(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.position = new FakeVector3();
    this.userData = {};
    this.scale = { setScalar: (value) => { this.scale.value = value; } };
  }
}

class FakeMesh extends FakeObject3D {}
class FakeLine extends FakeObject3D {}
class FakeSphereGeometry extends FakeBufferGeometry {}

class FakeRaycaster {
  setFromCamera() {}
  intersectObjects() {
    return [];
  }
}

const THREE = {
  Group: FakeGroup,
  Vector2: FakeVector2,
  Color: FakeColor,
  BufferGeometry: FakeBufferGeometry,
  Float32BufferAttribute: FakeFloat32BufferAttribute,
  LineBasicMaterial: FakeMaterial,
  MeshLambertMaterial: FakeMaterial,
  SphereGeometry: FakeSphereGeometry,
  Mesh: FakeMesh,
  Line: FakeLine,
  Raycaster: FakeRaycaster,
  MathUtils: {
    lerp: (from, to, amount) => from + (to - from) * amount
  }
};

const edgeEndpoints = (scene, edgeId) => {
  const line = scene.edgeObjectById.get(edgeId);
  return [...line.geometry.getAttribute('position').array];
};

test('projection geometry keeps the universe root central and calculates both layouts deterministically', () => {
  const store = new GraphStore();
  const nodes = store.listNodes();
  const first = calculateProjectionPositions(nodes);
  const second = calculateProjectionPositions(nodes);
  const root = store.getUniverseRoot();
  assert.deepEqual(first.positions.get(root.id).sphere, { x: 0, y: 0, z: 0 });
  assert.deepEqual([...first.positions], [...second.positions]);
  assert.notDeepEqual(first.positions.get(nodes.find(({ id }) => id !== root.id).id).sphere, first.positions.get(root.id).sphere);
});

test('edge segment calculations follow sphere and grid endpoint positions', () => {
  const store = new GraphStore();
  const edge = store.listEdges()[0];
  const { positions } = calculateProjectionPositions(store.listNodes());
  const sphere = calculateEdgeSegment(edge, positions, 'sphere');
  const grid = calculateEdgeSegment(edge, positions, 'grid');
  assert.deepEqual(sphere.slice(0, 3), Object.values(positions.get(edge.fromNodeId).sphere));
  assert.deepEqual(sphere.slice(3), Object.values(positions.get(edge.toNodeId).sphere));
  assert.deepEqual(grid.slice(0, 3), Object.values(positions.get(edge.fromNodeId).grid));
  assert.deepEqual(grid.slice(3), Object.values(positions.get(edge.toNodeId).grid));
});

test('scene edge registry reuses stable edge IDs and synchronizes endpoints across sphere and grid', () => {
  const store = new GraphStore();
  const scene = new PraxScene({ style: {} }, () => {}, { three: THREE });
  scene.camera = { position: new FakeVector3() };
  scene.addNodes(store.listNodes());
  scene.addEdges(store.listEdges());

  const edge = store.listEdges()[0];
  const firstObject = scene.edgeObjectById.get(edge.id);
  const sphereEndpoints = edgeEndpoints(scene, edge.id);
  assert.equal(scene.edgeObjectById.size, store.listEdges().length);
  assert.equal(firstObject.userData.edgeClass, 'explicit');

  scene.addEdges([edge]);
  assert.equal(scene.edgeObjectById.get(edge.id), firstObject);
  assert.equal(scene.edgeObjectById.size, store.listEdges().length);

  scene.setView('grid');
  const gridEndpoints = edgeEndpoints(scene, edge.id);
  const from = scene.meshByNodeId.get(edge.fromNodeId).position;
  const to = scene.meshByNodeId.get(edge.toNodeId).position;
  assert.notDeepEqual(gridEndpoints, sphereEndpoints);
  assert.deepEqual(gridEndpoints, [from.x, from.y, from.z, to.x, to.y, to.z]);

  scene.setView('sphere');
  assert.deepEqual(edgeEndpoints(scene, edge.id), sphereEndpoints);
});

test('scene edge removal disposes render resources and supports future deletion', () => {
  const store = new GraphStore();
  const scene = new PraxScene({ style: {} }, () => {}, { three: THREE });
  scene.camera = { position: new FakeVector3() };
  scene.addNodes(store.listNodes());
  const edge = store.listEdges()[0];
  scene.addEdges([edge]);
  const line = scene.edgeObjectById.get(edge.id);
  assert.equal(scene.removeEdge(edge.id), true);
  assert.equal(scene.edgeObjectById.has(edge.id), false);
  assert.equal(line.geometry.disposed, true);
  assert.equal(line.material.disposed, true);
});
