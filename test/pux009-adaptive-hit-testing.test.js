import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphStore } from '../public/js/graph-store.js';
import { GalaxyPraxScene } from '../public/js/galaxy-scene.js';
import { PraxScene } from '../public/js/scene.js';
import {
  ADAPTIVE_HIT_POLICY,
  calculateAdaptiveHitRadiusPx,
  calculateProjectedNodeRadiusPx,
  resolveViewportHeightCssPx,
  selectAdaptiveHitCandidate
} from '../public/js/adaptive-hit-testing.js';

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
    camera.projectVector(this);
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
    this.rotation = { x: 0, y: 0, z: 0 };
  }

  add(...objects) {
    this.children.push(...objects);
  }
}

class FakeRaycaster {
  constructor() {
    this.hits = [];
  }

  setFromCamera() {}

  intersectObjects() {
    return this.hits;
  }
}

const THREE = {
  Group: FakeGroup,
  Vector2: FakeVector2,
  Vector3: FakeVector3,
  Raycaster: FakeRaycaster
};

const createPoint = ({ nodeId, x = 0, y = 0, z = 0, radius = 0.5, scale = 1 }) => ({
  position: new FakeVector3(x, y, z),
  geometry: { boundingSphere: { radius } },
  userData: { nodeId, emphasisScale: scale },
  scale: {
    x: scale,
    y: scale,
    z: scale,
    setScalar(value) {
      this.x = value;
      this.y = value;
      this.z = value;
    }
  },
  getWorldPosition(target) {
    return target.copy(this.position);
  },
  getWorldScale(target) {
    return target.set(this.scale.x, this.scale.y, this.scale.z);
  }
});

const createScene = ({ SceneClass = PraxScene, dpr = 1, onSelect = () => {} } = {}) => {
  const canvas = {
    width: 400 * dpr,
    height: 300 * dpr,
    style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 })
  };
  const scene = new SceneClass(canvas, onSelect, { three: THREE });
  scene.camera = {
    fov: 75,
    zoom: 1,
    position: new FakeVector3(0, 0, 10),
    projectVector: (vector) => vector.set(vector.x / 10, vector.y / 10, vector.z / 100)
  };
  scene.renderer = {
    domElement: { height: 300 * dpr },
    getPixelRatio: () => dpr
  };
  return scene;
};

const attachPoint = (scene, point) => {
  scene.meshByNodeId.set(point.userData.nodeId, point);
  scene.pointsGroup.children.push(point);
  return point;
};

test('DPR 1, 2, and 3 normalize to the same CSS-space projected radius', () => {
  const values = [1, 2, 3].map((dpr) => calculateProjectedNodeRadiusPx({
    geometryRadius: 0.5,
    worldScale: 1,
    cameraDistance: 10,
    verticalFovDegrees: 75,
    renderBufferHeightPx: 300 * dpr,
    rendererPixelRatio: dpr,
    devicePixelRatio: dpr
  }));
  assert.equal(resolveViewportHeightCssPx({ renderBufferHeightPx: 900, rendererPixelRatio: 3 }), 300);
  assert.ok(Math.abs(values[0] - values[1]) < 1e-9);
  assert.ok(Math.abs(values[1] - values[2]) < 1e-9);
});

test('small distant nodes retain the touch minimum while large nearby nodes follow rendered size', () => {
  const small = calculateProjectedNodeRadiusPx({
    geometryRadius: 0.2,
    worldScale: 1,
    cameraDistance: 40,
    verticalFovDegrees: 75,
    viewportHeightCssPx: 300
  });
  const large = calculateProjectedNodeRadiusPx({
    geometryRadius: 1.2,
    worldScale: 1.8,
    cameraDistance: 6,
    verticalFovDegrees: 75,
    viewportHeightCssPx: 300
  });
  assert.ok(large > small);
  assert.equal(calculateAdaptiveHitRadiusPx({ projectedRadiusPx: small, pointerType: 'touch' }), ADAPTIVE_HIT_POLICY.touch.minimumRadiusPx);
  assert.ok(calculateAdaptiveHitRadiusPx({ projectedRadiusPx: large, pointerType: 'touch' }) >= large);
});

test('perspective field of view and zoom alter projected size deterministically', () => {
  const common = { geometryRadius: 0.5, worldScale: 1, cameraDistance: 10, viewportHeightCssPx: 300 };
  const narrow = calculateProjectedNodeRadiusPx({ ...common, verticalFovDegrees: 45 });
  const wide = calculateProjectedNodeRadiusPx({ ...common, verticalFovDegrees: 90 });
  const zoomed = calculateProjectedNodeRadiusPx({ ...common, verticalFovDegrees: 75, cameraZoom: 2 });
  const normal = calculateProjectedNodeRadiusPx({ ...common, verticalFovDegrees: 75, cameraZoom: 1 });
  assert.ok(narrow > wide);
  assert.ok(zoomed > normal);
});

test('orthographic zoom increases projected radius without using camera distance', () => {
  const normal = calculateProjectedNodeRadiusPx({
    cameraType: 'orthographic', geometryRadius: 0.5, worldScale: 1,
    orthographicTop: 5, orthographicBottom: -5, cameraZoom: 1, viewportHeightCssPx: 300
  });
  const zoomed = calculateProjectedNodeRadiusPx({
    cameraType: 'orthographic', geometryRadius: 0.5, worldScale: 1,
    orthographicTop: 5, orthographicBottom: -5, cameraZoom: 2, viewportHeightCssPx: 300
  });
  assert.equal(zoomed, normal * 2);
});

test('touch and pen policies remain distinct and never shrink below the visual radius', () => {
  assert.equal(calculateAdaptiveHitRadiusPx({ projectedRadiusPx: 0, pointerType: 'touch' }), 28);
  assert.equal(calculateAdaptiveHitRadiusPx({ projectedRadiusPx: 0, pointerType: 'pen' }), 18);
  assert.equal(calculateAdaptiveHitRadiusPx({ projectedRadiusPx: 60, pointerType: 'touch' }), 60);
  assert.equal(calculateAdaptiveHitRadiusPx({ projectedRadiusPx: 60, pointerType: 'mouse' }), 60);
});

test('overlapping candidates rank by normalized distance from the rendered boundary', () => {
  const selected = selectAdaptiveHitCandidate([
    { nodeId: 'large', centerDistancePx: 25, projectedRadiusPx: 20, effectiveRadiusPx: 40, depth: 0.1 },
    { nodeId: 'small', centerDistancePx: 8, projectedRadiusPx: 5, effectiveRadiusPx: 28, depth: 0.2 }
  ]);
  assert.equal(selected.nodeId, 'small');
});

test('frontmost depth breaks equal adaptive candidate scores', () => {
  const selected = selectAdaptiveHitCandidate([
    { nodeId: 'back', centerDistancePx: 18, projectedRadiusPx: 10, effectiveRadiusPx: 30, depth: 0.4 },
    { nodeId: 'front', centerDistancePx: 18, projectedRadiusPx: 10, effectiveRadiusPx: 30, depth: -0.2 }
  ]);
  assert.equal(selected.nodeId, 'front');
});

test('stable node ID is the final tie-breaker independent of insertion order', () => {
  const candidates = [
    { nodeId: 'node-z', centerDistancePx: 18, projectedRadiusPx: 10, effectiveRadiusPx: 30, depth: 0 },
    { nodeId: 'node-a', centerDistancePx: 18, projectedRadiusPx: 10, effectiveRadiusPx: 30, depth: 0 }
  ];
  assert.equal(selectAdaptiveHitCandidate(candidates).nodeId, 'node-a');
  assert.equal(selectAdaptiveHitCandidate([...candidates].reverse()).nodeId, 'node-a');
});

test('touch fallback runs after a raycast miss and raycast hits retain precedence', () => {
  const scene = createScene({ dpr: 3 });
  const fallback = attachPoint(scene, createPoint({ nodeId: 'fallback' }));
  const raycast = attachPoint(scene, createPoint({ nodeId: 'raycast', x: 5 }));
  scene.updateIntersection({ adaptiveFallback: true, pointerType: 'touch', clientX: 225, clientY: 150 });
  assert.equal(scene.intersected, fallback);
  scene.raycaster.hits = [{ object: raycast }];
  scene.updateIntersection({ adaptiveFallback: true, pointerType: 'touch', clientX: 225, clientY: 150 });
  assert.equal(scene.intersected, raycast);
});

test('fine mouse precision does not inherit adaptive fallback', () => {
  const scene = createScene();
  attachPoint(scene, createPoint({ nodeId: 'mouse-nearby' }));
  scene.updateIntersection({ adaptiveFallback: false, pointerType: 'mouse', clientX: 225, clientY: 150 });
  assert.equal(scene.intersected, null);
});

test('touch drag movement rejection remains separate from hit-radius expansion', () => {
  const selections = [];
  const scene = createScene({ onSelect: (nodeId) => selections.push(nodeId) });
  attachPoint(scene, createPoint({ nodeId: 'drag-target' }));
  scene.handlePointerDown({ isPrimary: true, pointerId: 1, pointerType: 'touch', clientX: 225, clientY: 150 });
  scene.handlePointerMove({ pointerId: 1, pointerType: 'touch', clientX: 245, clientY: 150 });
  assert.equal(scene.handlePointerUp({ pointerId: 1, pointerType: 'touch', clientX: 245, clientY: 150 }), false);
  assert.deepEqual(selections, []);
});

test('adaptive fallback follows current rendered positions in sphere and grid projections', () => {
  const scene = createScene();
  const point = attachPoint(scene, createPoint({ nodeId: 'projection-node' }));
  scene.currentView = 'sphere';
  assert.equal(scene.findAdaptiveTarget(225, 150, 'touch'), point);
  scene.currentView = 'grid';
  point.position.set(2, 0, 0);
  assert.equal(scene.findAdaptiveTarget(245, 150, 'touch'), point);
});

test('Searchlight emphasis scale contributes to the projected visual boundary', () => {
  const scene = createScene();
  const point = attachPoint(scene, createPoint({ nodeId: 'searchlight-node', scale: 1 }));
  const normal = scene.getNodeScreenMetrics('searchlight-node', 'touch');
  point.userData.emphasisScale = 1.7;
  point.scale.setScalar(1.7);
  const emphasized = scene.getNodeScreenMetrics('searchlight-node', 'touch');
  assert.ok(emphasized.projectedRadiusPx > normal.projectedRadiusPx);
  assert.equal(scene.findAdaptiveTarget(200 + emphasized.effectiveRadiusPx - 1, 150, 'touch'), point);
});

test('Galaxy Focus inherits adaptive hit testing and uses focused node scale', () => {
  const scene = createScene({ SceneClass: GalaxyPraxScene });
  const point = attachPoint(scene, createPoint({ nodeId: 'focused-node', scale: 1.85 }));
  const metrics = scene.getNodeScreenMetrics('focused-node', 'touch');
  assert.ok(metrics.projectedRadiusPx > 0);
  assert.equal(scene.findAdaptiveTarget(200 + metrics.effectiveRadiusPx - 1, 150, 'touch'), point);
});

test('adaptive selection changes presentation only and does not mutate canonical graph state', () => {
  const store = new GraphStore();
  const before = JSON.stringify(store.snapshot());
  const scene = createScene();
  const node = store.listNodes().find(({ nodeType }) => nodeType !== 'universe_root');
  attachPoint(scene, createPoint({ nodeId: node.id }));
  scene.updateIntersection({ adaptiveFallback: true, pointerType: 'touch', clientX: 225, clientY: 150 });
  scene.select();
  assert.equal(JSON.stringify(store.snapshot()), before);
});
