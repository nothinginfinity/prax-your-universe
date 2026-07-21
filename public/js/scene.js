import { UNIVERSE_ROOT_NODE_TYPE } from './graph-schema.js';
import {
  captureCameraState,
  cloneCameraState,
  createNodeCameraState,
  interpolateCameraState
} from './camera-navigation.js';

const PROJECTION_TYPES = Object.freeze(['sphere', 'grid']);

export const NODE_TYPE_VISUAL_METADATA = Object.freeze({
  universe_root: Object.freeze({ label: 'Universe root', color: 0xffffff, radius: 0.8, emissiveIntensity: 0.65 }),
  link: Object.freeze({ label: 'Link', color: 0x38bdf8, radius: 0.46, emissiveIntensity: 0.35 }),
  note: Object.freeze({ label: 'Note', color: 0xfbbf24, radius: 0.46, emissiveIntensity: 0.32 }),
  project: Object.freeze({ label: 'Project', color: 0xa78bfa, radius: 0.5, emissiveIntensity: 0.32 }),
  document: Object.freeze({ label: 'Document', color: 0x34d399, radius: 0.46, emissiveIntensity: 0.3 }),
  conversation: Object.freeze({ label: 'Conversation', color: 0xfb7185, radius: 0.46, emissiveIntensity: 0.3 }),
  universe: Object.freeze({ label: 'Universe', color: 0xe5e7eb, radius: 0.55, emissiveIntensity: 0.4 })
});

export const getNodeVisualMetadata = (nodeType) => NODE_TYPE_VISUAL_METADATA[nodeType]
  ?? Object.freeze({ label: 'Node', color: 0x94a3b8, radius: 0.44, emissiveIntensity: 0.25 });

export const calculateProjectionPositions = (nodes) => {
  const positions = new Map();
  const root = nodes.find(({ nodeType }) => nodeType === UNIVERSE_ROOT_NODE_TYPE) ?? null;
  const regularNodes = nodes.filter(({ nodeType }) => nodeType !== UNIVERSE_ROOT_NODE_TYPE);
  const count = regularNodes.length;
  const radius = 8 * Math.cbrt(Math.max(count, 2) / 2);
  const phi = Math.PI * (3 - Math.sqrt(5));
  const gridSize = Math.ceil(Math.sqrt(Math.max(count, 1)));
  const gridRows = Math.ceil(Math.max(count, 1) / gridSize);

  if (root) {
    positions.set(root.id, {
      sphere: { x: 0, y: 0, z: 0 },
      grid: { x: 0, y: ((gridRows - 1) * 2.5) / 2 + 4, z: -10 }
    });
  }

  regularNodes.forEach((node, index) => {
    const y = count === 1 ? 0 : 1 - (index / (count - 1)) * 2;
    const theta = phi * index;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    positions.set(node.id, {
      sphere: {
        x: Math.cos(theta) * ring * radius,
        y: y * radius,
        z: Math.sin(theta) * ring * radius
      },
      grid: {
        x: (index % gridSize - (gridSize - 1) / 2) * 2.5,
        y: (Math.floor(index / gridSize) - (gridRows - 1) / 2) * 2.5,
        z: -10
      }
    });
  });

  return Object.freeze({ positions, radius });
};

export const calculateEdgeSegment = (edge, projectionPositions, view) => {
  if (!PROJECTION_TYPES.includes(view)) throw new Error(`Unsupported projection: ${view}`);
  const from = projectionPositions.get(edge.fromNodeId)?.[view];
  const to = projectionPositions.get(edge.toNodeId)?.[view];
  if (!from || !to) throw new Error(`Edge ${edge.id} references a node without a ${view} position.`);
  return [from.x, from.y, from.z, to.x, to.y, to.z];
};

const setMaterialColor = (target, value) => {
  if (target?.copy) target.copy(value);
  else return value;
  return target;
};

export class PraxScene {
  constructor(canvas, onSelect, { three = globalThis.THREE } = {}) {
    if (!three) throw new Error('THREE is required to create the Prax scene.');
    this.THREE = three;
    this.canvas = canvas;
    this.onSelect = onSelect;
    this.currentView = 'sphere';
    this.graphGroup = new three.Group();
    this.edgeGroup = new three.Group();
    this.pointsGroup = new three.Group();
    this.graphGroup.add(this.edgeGroup, this.pointsGroup);
    this.meshByNodeId = new Map();
    this.edgeObjectById = new Map();
    this.projectionPositions = new Map();
    this.raycaster = new three.Raycaster();
    this.pointer = new three.Vector2(2, 2);
    this.intersected = null;
    this.layoutRadius = 8;
    this.cameraTransition = null;
    this.rotationPaused = false;
    this.emphasis = {
      matchedNodeIds: new Set(),
      neighborhoodNodeIds: new Set(),
      activeNodeId: null
    };
  }

  init() {
    const THREE = this.THREE;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(10, 20, 15);
    this.scene.add(light, this.graphGroup);
    this.addStars();
    this.camera.position.set(0, 0, 35);
    addEventListener('resize', () => this.resize());
    this.renderer.domElement.addEventListener('pointermove', (event) => this.movePointer(event));
    this.renderer.domElement.addEventListener('pointerdown', () => this.select());
    this.animate();
  }

  addStars() {
    const THREE = this.THREE;
    const vertices = [];
    for (let i = 0; i < 20000; i += 1) vertices.push((Math.random() - 0.5) * 800, (Math.random() - 0.5) * 800, (Math.random() - 0.5) * 800);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    this.scene.add(new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xaaaaaa, size: 0.4, transparent: true, opacity: 0.7 })));
  }

  createNodeObject(node) {
    const THREE = this.THREE;
    const visual = getNodeVisualMetadata(node.nodeType);
    const color = new THREE.Color(visual.color);
    const point = new THREE.Mesh(
      new THREE.SphereGeometry(visual.radius, node.nodeType === UNIVERSE_ROOT_NODE_TYPE ? 24 : 16, node.nodeType === UNIVERSE_ROOT_NODE_TYPE ? 24 : 16),
      new THREE.MeshLambertMaterial({
        color,
        emissive: color,
        emissiveIntensity: visual.emissiveIntensity,
        transparent: true,
        opacity: 1
      })
    );
    point.userData = {
      nodeId: node.id,
      nodeType: node.nodeType,
      nodeTitle: node.title,
      visualKey: node.nodeType,
      visualLabel: visual.label,
      baseEmissiveIntensity: visual.emissiveIntensity,
      emphasisScale: 1
    };
    return point;
  }

  addNodes(nodes) {
    for (const node of nodes) {
      if (this.meshByNodeId.has(node.id)) {
        this.updateNode(node);
        continue;
      }
      const point = this.createNodeObject(node);
      this.meshByNodeId.set(node.id, point);
      this.pointsGroup.add(point);
    }
    this.layout();
  }

  updateNode(node) {
    const point = this.meshByNodeId.get(node.id);
    if (!point) return false;
    const visual = getNodeVisualMetadata(node.nodeType);
    const color = new this.THREE.Color(visual.color);
    point.userData.nodeType = node.nodeType;
    point.userData.nodeTitle = node.title;
    point.userData.visualKey = node.nodeType;
    point.userData.visualLabel = visual.label;
    point.material.color = setMaterialColor(point.material.color, color);
    point.material.emissive = setMaterialColor(point.material.emissive, color);
    point.material.emissiveIntensity = visual.emissiveIntensity;
    point.userData.baseEmissiveIntensity = visual.emissiveIntensity;
    point.material.needsUpdate = true;
    this.applyEmphasis();
    return true;
  }

  removeNode(nodeId) {
    const point = this.meshByNodeId.get(nodeId);
    if (!point) return false;
    const connectedEdgeIds = [...this.edgeObjectById.values()]
      .filter((line) => line.userData.fromNodeId === nodeId || line.userData.toNodeId === nodeId)
      .map((line) => line.userData.edgeId);
    connectedEdgeIds.forEach((edgeId) => this.removeEdge(edgeId));
    if (this.intersected === point) this.intersected = null;
    this.pointsGroup.remove(point);
    point.geometry.dispose();
    point.material.dispose();
    this.meshByNodeId.delete(nodeId);
    this.projectionPositions.delete(nodeId);
    this.layout();
    return true;
  }

  createEdgeObject(edge) {
    const THREE = this.THREE;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.42,
        depthWrite: false
      })
    );
    line.userData = {
      edgeId: edge.id,
      edgeType: edge.edgeType,
      edgeClass: 'explicit',
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId
    };
    return line;
  }

  addEdges(edges) {
    for (const edge of edges) {
      if (!this.meshByNodeId.has(edge.fromNodeId) || !this.meshByNodeId.has(edge.toNodeId)) {
        throw new Error(`Cannot render edge ${edge.id} before both endpoint nodes exist.`);
      }
      const existing = this.edgeObjectById.get(edge.id);
      if (existing) {
        existing.userData.edgeType = edge.edgeType;
        existing.userData.fromNodeId = edge.fromNodeId;
        existing.userData.toNodeId = edge.toNodeId;
        continue;
      }
      const line = this.createEdgeObject(edge);
      this.edgeObjectById.set(edge.id, line);
      this.edgeGroup.add(line);
    }
    this.syncEdgePositions();
  }

  removeEdge(edgeId) {
    const line = this.edgeObjectById.get(edgeId);
    if (!line) return false;
    this.edgeGroup.remove(line);
    line.geometry.dispose();
    line.material.dispose();
    this.edgeObjectById.delete(edgeId);
    return true;
  }

  syncEdgePositions(edgeIds = this.edgeObjectById.keys()) {
    for (const edgeId of edgeIds) {
      const line = this.edgeObjectById.get(edgeId);
      if (!line) continue;
      const from = this.meshByNodeId.get(line.userData.fromNodeId);
      const to = this.meshByNodeId.get(line.userData.toNodeId);
      if (!from || !to) continue;
      const positions = line.geometry.getAttribute('position');
      positions.setXYZ(0, from.position.x, from.position.y, from.position.z);
      positions.setXYZ(1, to.position.x, to.position.y, to.position.z);
      positions.needsUpdate = true;
      line.geometry.computeBoundingSphere?.();
    }
  }

  replaceGraph(nodes, edges) {
    for (const edgeId of [...this.edgeObjectById.keys()]) this.removeEdge(edgeId);
    for (const nodeId of [...this.meshByNodeId.keys()]) this.removeNode(nodeId);
    this.addNodes(nodes);
    this.addEdges(edges);
  }

  layout({ resetCamera = true } = {}) {
    const nodeDescriptors = this.pointsGroup.children.map((point) => ({
      id: point.userData.nodeId,
      nodeType: point.userData.nodeType
    }));
    const { positions, radius } = calculateProjectionPositions(nodeDescriptors);
    this.projectionPositions = positions;
    this.layoutRadius = radius;
    for (const point of this.pointsGroup.children) {
      const target = positions.get(point.userData.nodeId)?.[this.currentView];
      if (target) point.position.set(target.x, target.y, target.z);
    }
    if (this.camera && resetCamera) this.applyCameraState(this.getDefaultCameraState());
    this.syncEdgePositions();
    this.applyEmphasis();
  }

  getDefaultCameraState(view = this.currentView) {
    return cloneCameraState({
      position: { x: 0, y: 0, z: view === 'sphere' ? this.layoutRadius * 2.2 : 25 },
      target: { x: 0, y: 0, z: 0 },
      graphRotation: { x: 0, y: 0, z: 0 }
    });
  }

  captureCameraState() {
    return captureCameraState(this.camera, this.controls, this.graphGroup);
  }

  applyCameraState(state, { cancelTransition = true } = {}) {
    const next = cloneCameraState(state);
    if (cancelTransition) this.cameraTransition = null;
    this.camera?.position?.set(next.position.x, next.position.y, next.position.z);
    this.controls?.target?.set?.(next.target.x, next.target.y, next.target.z);
    if (this.graphGroup?.rotation) {
      if ('x' in this.graphGroup.rotation) this.graphGroup.rotation.x = next.graphRotation.x;
      this.graphGroup.rotation.y = next.graphRotation.y;
      if ('z' in this.graphGroup.rotation) this.graphGroup.rotation.z = next.graphRotation.z;
    }
    this.controls?.update?.();
    return next;
  }

  beginCameraTransition(targetState, { immediate = false, duration = 450 } = {}) {
    const target = cloneCameraState(targetState);
    if (immediate || duration <= 0 || !this.camera) return this.applyCameraState(target);
    this.cameraTransition = {
      from: this.captureCameraState(),
      to: target,
      startedAt: globalThis.performance?.now?.() ?? Date.now(),
      duration
    };
    return target;
  }

  updateCameraTransition(now = globalThis.performance?.now?.() ?? Date.now()) {
    if (!this.cameraTransition) return false;
    const elapsed = now - this.cameraTransition.startedAt;
    const progress = Math.min(1, Math.max(0, elapsed / this.cameraTransition.duration));
    const eased = 1 - ((1 - progress) ** 3);
    this.applyCameraState(
      interpolateCameraState(this.cameraTransition.from, this.cameraTransition.to, eased),
      { cancelTransition: false }
    );
    if (progress >= 1) this.cameraTransition = null;
    return true;
  }

  restoreCameraState(state, options = {}) {
    return this.beginCameraTransition(state, options);
  }

  getNodeWorldPosition(nodeId) {
    const point = this.meshByNodeId.get(nodeId);
    if (!point) return null;
    const world = this.THREE.Vector3 ? new this.THREE.Vector3() : { x: 0, y: 0, z: 0 };
    if (point.getWorldPosition) point.getWorldPosition(world);
    else {
      world.x = point.position.x;
      world.y = point.position.y;
      world.z = point.position.z;
    }
    return world;
  }

  navigateToNode(nodeId, { immediate = false, duration = 450, distance = 8 } = {}) {
    const nodePosition = this.getNodeWorldPosition(nodeId);
    if (!nodePosition) return false;
    const destination = createNodeCameraState(nodePosition, this.captureCameraState(), { distance });
    this.beginCameraTransition(destination, { immediate, duration });
    return true;
  }

  resetCamera(options = {}) {
    this.rotationPaused = false;
    return this.beginCameraTransition(this.getDefaultCameraState(), options);
  }

  getView() {
    return this.currentView;
  }

  setView(view, { resetCamera = true } = {}) {
    if (!PROJECTION_TYPES.includes(view)) throw new Error(`Unsupported projection: ${view}`);
    this.currentView = view;
    this.layout({ resetCamera });
    return this.currentView;
  }

  toggleView(options = {}) {
    return this.setView(this.currentView === 'sphere' ? 'grid' : 'sphere', options);
  }

  setSearchEmphasis({ matchedNodeIds = [], activeNodeId = null, neighborhoodNodeIds = [] } = {}) {
    this.emphasis = {
      matchedNodeIds: new Set(matchedNodeIds),
      neighborhoodNodeIds: new Set(neighborhoodNodeIds),
      activeNodeId
    };
    this.rotationPaused = Boolean(activeNodeId);
    this.applyEmphasis();
    return this.getEmphasisState();
  }

  clearSearchEmphasis() {
    this.emphasis = {
      matchedNodeIds: new Set(),
      neighborhoodNodeIds: new Set(),
      activeNodeId: null
    };
    this.rotationPaused = false;
    this.applyEmphasis();
    return this.getEmphasisState();
  }

  applyEmphasis() {
    const { matchedNodeIds, neighborhoodNodeIds, activeNodeId } = this.emphasis;
    const active = Boolean(activeNodeId);
    for (const [nodeId, point] of this.meshByNodeId) {
      const visual = getNodeVisualMetadata(point.userData.nodeType);
      let opacity = 1;
      let scale = 1;
      let emissiveIntensity = visual.emissiveIntensity;
      if (active) {
        if (nodeId === activeNodeId) {
          scale = 1.7;
          emissiveIntensity = visual.emissiveIntensity * 1.9;
        } else if (neighborhoodNodeIds.has(nodeId)) {
          scale = 1.25;
          emissiveIntensity = visual.emissiveIntensity * 1.35;
        } else if (matchedNodeIds.has(nodeId)) {
          scale = 1.08;
          opacity = 0.72;
        } else {
          opacity = 0.14;
          emissiveIntensity = visual.emissiveIntensity * 0.2;
        }
      }
      point.userData.emphasisScale = scale;
      point.material.transparent = true;
      point.material.opacity = opacity;
      point.material.emissiveIntensity = emissiveIntensity;
      point.material.needsUpdate = true;
      point.scale.setScalar(point === this.intersected ? scale * 1.2 : scale);
    }

    for (const line of this.edgeObjectById.values()) {
      let opacity = 0.42;
      if (active) {
        const directlyConnected = line.userData.fromNodeId === activeNodeId || line.userData.toNodeId === activeNodeId;
        const insideNeighborhood = neighborhoodNodeIds.has(line.userData.fromNodeId)
          && neighborhoodNodeIds.has(line.userData.toNodeId);
        opacity = directlyConnected ? 0.9 : (insideNeighborhood ? 0.32 : 0.06);
      }
      line.material.opacity = opacity;
      line.material.needsUpdate = true;
    }
  }

  getEmphasisState() {
    return Object.freeze({
      matchedNodeIds: Object.freeze([...this.emphasis.matchedNodeIds]),
      neighborhoodNodeIds: Object.freeze([...this.emphasis.neighborhoodNodeIds]),
      activeNodeId: this.emphasis.activeNodeId
    });
  }

  movePointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  select() {
    this.onSelect(this.intersected?.userData.nodeId ?? null);
  }

  updateIntersection() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.pointsGroup.children)[0]?.object ?? null;
    if (hit === this.intersected) return;
    if (this.intersected) this.intersected.scale.setScalar(this.intersected.userData.emphasisScale ?? 1);
    this.intersected = hit;
    if (hit) hit.scale.setScalar((hit.userData.emphasisScale ?? 1) * 1.2);
    this.canvas.style.cursor = hit ? 'pointer' : 'default';
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.updateCameraTransition();
    this.controls.update();
    this.updateIntersection();
    if (this.currentView === 'sphere' && !this.rotationPaused) this.graphGroup.rotation.y += 0.001;
    else this.graphGroup.rotation.y = this.THREE.MathUtils.lerp(this.graphGroup.rotation.y, 0, 0.05);
    this.renderer.render(this.scene, this.camera);
  }
}
