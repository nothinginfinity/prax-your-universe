import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphStore } from '../public/js/graph-store.js';
import {
  NODE_TYPE_VISUAL_METADATA,
  PraxScene,
  calculateEdgeSegment,
  calculateProjectionPositions,
  getNodeVisualMetadata
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

  project(camera) {
    camera?.projectVector?.(this);
    return this;
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

  copy(value) {
    this.value = value.value;
    this.hsl = value.hsl;
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
    Object.assign(this, options);
    this.options = options;
    this.disposed = false;
    this.needsUpdate = false;
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

  getWorldPosition(target) {
    return target.copy(this.position);
  }
}

class FakeMesh extends FakeObject3D {}
class FakeLine extends FakeObject3D {}
class FakeSphereGeometry extends FakeBufferGeometry {
  constructor(radius, widthSegments, heightSegments) {
    super();
    this.radius = radius;
    this.widthSegments = widthSegments;
    this.heightSegments = heightSegments;
  }
}

class FakeRaycaster {
  setFromCamera() {}
  intersectObjects() {
    return [];
  }
}

const THREE = {
  Group: FakeGroup,
  Vector2: FakeVector2,
  Vector3: FakeVector3,
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

const positionOf = (scene, nodeId) => {
  const { x, y, z } = scene.meshByNodeId.get(nodeId).position;
  return { x, y, z };
};

const distanceBetween = (left, right) => Math.hypot(
  left.x - right.x,
  left.y - right.y,
  left.z - right.z
);

const assertRenderedEdgeMatchesMeshes = (scene, edge) => {
  const from = positionOf(scene, edge.fromNodeId);
  const to = positionOf(scene, edge.toNodeId);
  assert.deepEqual(
    edgeEndpoints(scene, edge.id),
    [from.x, from.y, from.z, to.x, to.y, to.z].map(Math.fround)
  );
};

const assertNoRendererCoordinates = (records) => {
  const forbiddenKeys = ['position', 'positions', 'projectionPositions', 'renderCoordinates', 'sphere', 'grid', 'x', 'y', 'z'];
  for (const record of records) {
    for (const key of forbiddenKeys) assert.equal(Object.hasOwn(record, key), false, `${record.id} contains ${key}`);
  }
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

test('hierarchy children stay near their immediate parent and parent edges follow both projections', () => {
  const store = new GraphStore();
  const parent = store.listNodes().find(({ nodeType }) => nodeType !== 'universe_root');
  const childResult = store.addChildWithHierarchy(parent.id, {
    originId: 'scene-direct-child',
    nodeType: 'note',
    title: 'Direct child',
    body: 'Transient renderer placement'
  });
  const scene = new PraxScene({ style: {} }, () => {}, { three: THREE });
  scene.camera = { position: new FakeVector3() };
  scene.addNodes(store.listNodes());
  const baseChildPosition = positionOf(scene, childResult.node.id);
  scene.addEdges(store.listEdges());

  const sphereParent = positionOf(scene, parent.id);
  const sphereChild = positionOf(scene, childResult.node.id);
  assert.notDeepEqual(sphereChild, baseChildPosition);
  assert.ok(distanceBetween(sphereParent, sphereChild) > 0);
  assert.ok(distanceBetween(sphereParent, sphereChild) < 2.6);
  assertRenderedEdgeMatchesMeshes(scene, childResult.parentEdge);

  const firstSpherePosition = positionOf(scene, childResult.node.id);
  scene.layout({ resetCamera: false });
  assert.deepEqual(positionOf(scene, childResult.node.id), firstSpherePosition);
  assertRenderedEdgeMatchesMeshes(scene, childResult.parentEdge);

  scene.setView('grid', { resetCamera: false });
  const gridParent = positionOf(scene, parent.id);
  const gridChild = positionOf(scene, childResult.node.id);
  assert.ok(distanceBetween(gridParent, gridChild) > 0);
  assert.ok(distanceBetween(gridParent, gridChild) < 2);
  assertRenderedEdgeMatchesMeshes(scene, childResult.parentEdge);

  scene.setView('sphere', { resetCamera: false });
  assert.deepEqual(positionOf(scene, childResult.node.id), firstSpherePosition);
  assertRenderedEdgeMatchesMeshes(scene, childResult.parentEdge);
  assertNoRendererCoordinates([childResult.node, childResult.rootEdge, childResult.parentEdge]);
  assert.equal(store.snapshot().layoutNodes.some(({ nodeId }) => nodeId === childResult.node.id), false);
});

test('hierarchy projection spreads siblings by stable IDs and processes nested children parent-first', () => {
  const store = new GraphStore();
  const parent = store.listNodes().find(({ nodeType }) => nodeType !== 'universe_root');
  const children = ['zeta', 'alpha', 'middle'].map((originId) => store.addChildWithHierarchy(parent.id, {
    originId: `scene-sibling-${originId}`,
    nodeType: 'note',
    title: originId,
    body: ''
  }).node);
  const grandchild = store.addChildWithHierarchy(children[1].id, {
    originId: 'scene-nested-grandchild',
    nodeType: 'note',
    title: 'Grandchild',
    body: ''
  }).node;
  const nodes = store.listNodes();
  const edges = store.listEdges();
  const base = calculateProjectionPositions(nodes);
  const first = calculateProjectionPositions(nodes, edges);
  const reordered = calculateProjectionPositions(nodes, [...edges].reverse());
  const childSpherePositions = children.map(({ id }) => first.positions.get(id).sphere);

  assert.equal(new Set(childSpherePositions.map((position) => JSON.stringify(position))).size, children.length);
  for (const child of children) {
    assert.deepEqual(first.positions.get(child.id), reordered.positions.get(child.id));
  }
  assert.deepEqual(first.positions.get(grandchild.id), reordered.positions.get(grandchild.id));
  assert.ok(distanceBetween(
    first.positions.get(children[1].id).sphere,
    first.positions.get(grandchild.id).sphere
  ) < 2.6);
  assert.ok(distanceBetween(
    first.positions.get(children[1].id).grid,
    first.positions.get(grandchild.id).grid
  ) < 2);

  const hierarchyIds = new Set([parent.id, ...children.map(({ id }) => id), grandchild.id]);
  const unrelated = nodes.find(({ id, nodeType }) => nodeType !== 'universe_root' && !hierarchyIds.has(id));
  assert.deepEqual(first.positions.get(unrelated.id), base.positions.get(unrelated.id));
});

test('full graph replacement reconstructs identical transient hierarchy placement without persisted coordinates', () => {
  const store = new GraphStore();
  const parent = store.listNodes().find(({ nodeType }) => nodeType !== 'universe_root');
  const child = store.addChildWithHierarchy(parent.id, {
    originId: 'scene-import-child',
    nodeType: 'link',
    title: 'Imported child',
    url: 'https://example.com/imported-child'
  }).node;
  const grandchild = store.addChildWithHierarchy(child.id, {
    originId: 'scene-import-grandchild',
    nodeType: 'note',
    title: 'Imported grandchild',
    body: ''
  }).node;
  const canonicalSnapshot = store.snapshot();
  const importedStore = new GraphStore(JSON.parse(JSON.stringify(canonicalSnapshot)));
  const firstScene = new PraxScene({ style: {} }, () => {}, { three: THREE });
  const secondScene = new PraxScene({ style: {} }, () => {}, { three: THREE });
  firstScene.camera = { position: new FakeVector3() };
  secondScene.camera = { position: new FakeVector3() };
  firstScene.replaceGraph(store.listNodes(), store.listEdges());
  secondScene.replaceGraph(importedStore.listNodes(), importedStore.listEdges());

  for (const nodeId of [parent.id, child.id, grandchild.id]) {
    assert.deepEqual(positionOf(secondScene, nodeId), positionOf(firstScene, nodeId));
  }
  firstScene.setView('grid', { resetCamera: false });
  secondScene.setView('grid', { resetCamera: false });
  for (const nodeId of [parent.id, child.id, grandchild.id]) {
    assert.deepEqual(positionOf(secondScene, nodeId), positionOf(firstScene, nodeId));
  }
  assertNoRendererCoordinates([
    ...canonicalSnapshot.nodes,
    ...canonicalSnapshot.edges
  ]);
});

test('node-type visual metadata is stable and distinguishes links, notes, and roots', () => {
  assert.equal(Object.isFrozen(NODE_TYPE_VISUAL_METADATA), true);
  assert.notEqual(getNodeVisualMetadata('link').color, getNodeVisualMetadata('note').color);
  assert.notEqual(getNodeVisualMetadata('link').label, getNodeVisualMetadata('note').label);
  assert.ok(getNodeVisualMetadata('universe_root').radius > getNodeVisualMetadata('link').radius);
});

test('scene node objects carry type visual metadata and edits refresh displayed titles without replacing meshes', () => {
  const store = new GraphStore();
  const { node: link } = store.addLinkWithDefaultEdge('Link title', 'https://example.com/visual-link');
  const { node: note } = store.addNoteWithDefaultEdge('Note title', 'Body');
  const scene = new PraxScene({ style: {} }, () => {}, { three: THREE });
  scene.camera = { position: new FakeVector3() };
  scene.addNodes([link, note]);
  const linkMesh = scene.meshByNodeId.get(link.id);
  const noteMesh = scene.meshByNodeId.get(note.id);
  assert.equal(linkMesh.userData.visualKey, 'link');
  assert.equal(noteMesh.userData.visualKey, 'note');
  assert.notEqual(linkMesh.material.color.value, noteMesh.material.color.value);
  assert.equal(linkMesh.geometry.radius, getNodeVisualMetadata('link').radius);

  const edited = store.updateNode(note.id, { title: 'Edited note', body: 'Edited body' });
  assert.equal(scene.updateNode(edited), true);
  assert.equal(scene.meshByNodeId.get(note.id), noteMesh);
  assert.equal(noteMesh.userData.nodeTitle, 'Edited note');
  assert.equal(noteMesh.userData.visualLabel, 'Note');
  assert.equal(noteMesh.material.needsUpdate, true);
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

test('scene node removal disposes the node and every connected rendered edge', () => {
  const store = new GraphStore();
  const { node: first } = store.addNoteWithDefaultEdge('First', 'Body');
  const { node: second } = store.addNoteWithDefaultEdge('Second', 'Body');
  store.addEdge({ edgeType: 'related_to', fromNodeId: first.id, toNodeId: second.id });
  const connectedEdges = store.listConnectedEdges(first.id);
  const scene = new PraxScene({ style: {} }, () => {}, { three: THREE });
  scene.camera = { position: new FakeVector3() };
  scene.addNodes(store.listNodes());
  scene.addEdges(store.listEdges());
  const point = scene.meshByNodeId.get(first.id);
  const lines = connectedEdges.map(({ id }) => scene.edgeObjectById.get(id));

  assert.equal(scene.removeNode(first.id), true);
  assert.equal(scene.meshByNodeId.has(first.id), false);
  assert.equal(point.geometry.disposed, true);
  assert.equal(point.material.disposed, true);
  for (const line of lines) {
    assert.equal(line.geometry.disposed, true);
    assert.equal(line.material.disposed, true);
    assert.equal(scene.edgeObjectById.has(line.userData.edgeId), false);
  }
  assert.equal(scene.meshByNodeId.has(second.id), true);
});

test('touch selection refreshes tap coordinates, expands the hit target, and rejects orbit drags', () => {
  const selections = [];
  const canvas = {
    style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 })
  };
  const scene = new PraxScene(canvas, (nodeId) => selections.push(nodeId), { three: THREE });
  scene.camera = {
    position: new FakeVector3(),
    projectVector: (vector) => vector.set(vector.x / 10, vector.y / 10, 0)
  };
  const store = new GraphStore();
  const node = store.listNodes().find(({ nodeType }) => nodeType !== 'universe_root');
  scene.addNodes([node]);
  scene.meshByNodeId.get(node.id).position.set(0, 0, 0);

  assert.equal(scene.findTouchTarget(124, 100)?.userData.nodeId, node.id);
  assert.equal(scene.findTouchTarget(130, 100), null);

  scene.handlePointerDown({ isPrimary: true, pointerId: 1, pointerType: 'touch', clientX: 124, clientY: 100 });
  scene.handlePointerUp({ pointerId: 1, pointerType: 'touch', clientX: 124, clientY: 100 });
  assert.deepEqual(selections, [node.id]);

  scene.handlePointerDown({ isPrimary: true, pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 100 });
  scene.handlePointerMove({ pointerId: 2, pointerType: 'touch', clientX: 130, clientY: 100 });
  scene.handlePointerUp({ pointerId: 2, pointerType: 'touch', clientX: 130, clientY: 100 });
  assert.deepEqual(selections, [node.id]);
});

test('full scene replacement disposes removed resources and creates no duplicate meshes or lines', () => {
  const firstStore = new GraphStore();
  firstStore.addNoteWithDefaultEdge('Removed by import', 'Old body');
  const replacementStore = new GraphStore();
  replacementStore.addLinkWithDefaultEdge('Imported link', 'https://example.com/imported-scene');
  replacementStore.addNoteWithDefaultEdge('Imported note', 'New body');

  const scene = new PraxScene({ style: {} }, () => {}, { three: THREE });
  scene.camera = { position: new FakeVector3() };
  scene.replaceGraph(firstStore.listNodes(), firstStore.listEdges());
  const oldMeshes = [...scene.meshByNodeId.values()];
  const oldLines = [...scene.edgeObjectById.values()];

  scene.replaceGraph(replacementStore.listNodes(), replacementStore.listEdges());
  scene.replaceGraph(replacementStore.listNodes(), replacementStore.listEdges());

  for (const mesh of oldMeshes) {
    assert.equal(mesh.geometry.disposed, true);
    assert.equal(mesh.material.disposed, true);
  }
  for (const line of oldLines) {
    assert.equal(line.geometry.disposed, true);
    assert.equal(line.material.disposed, true);
  }
  assert.equal(scene.meshByNodeId.size, replacementStore.listNodes().length);
  assert.equal(scene.edgeObjectById.size, replacementStore.listEdges().length);
  assert.equal(new Set(scene.meshByNodeId.keys()).size, scene.meshByNodeId.size);
  assert.equal(new Set(scene.edgeObjectById.keys()).size, scene.edgeObjectById.size);
});
