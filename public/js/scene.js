import { UNIVERSE_ROOT_NODE_TYPE } from './graph-schema.js';

const hueFromId = (id) => {
  let hash = 0;
  for (const character of id) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return Math.abs(hash % 360) / 360;
};

const PROJECTION_TYPES = Object.freeze(['sphere', 'grid']);

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
    const isRoot = node.nodeType === UNIVERSE_ROOT_NODE_TYPE;
    const color = isRoot
      ? new THREE.Color(0xffffff)
      : new THREE.Color().setHSL(hueFromId(node.id), 0.8, 0.6);
    const point = new THREE.Mesh(
      new THREE.SphereGeometry(isRoot ? 0.8 : 0.4, isRoot ? 24 : 16, isRoot ? 24 : 16),
      new THREE.MeshLambertMaterial({
        color,
        emissive: color,
        emissiveIntensity: isRoot ? 0.65 : 0.2
      })
    );
    point.userData = { nodeId: node.id, nodeType: node.nodeType };
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
    point.userData.nodeType = node.nodeType;
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

  layout() {
    const nodeDescriptors = this.pointsGroup.children.map((point) => ({
      id: point.userData.nodeId,
      nodeType: point.userData.nodeType
    }));
    const { positions, radius } = calculateProjectionPositions(nodeDescriptors);
    this.projectionPositions = positions;
    for (const point of this.pointsGroup.children) {
      const target = positions.get(point.userData.nodeId)?.[this.currentView];
      if (target) point.position.set(target.x, target.y, target.z);
    }
    if (this.camera) this.camera.position.set(0, 0, this.currentView === 'sphere' ? radius * 2.2 : 25);
    this.syncEdgePositions();
  }

  getView() {
    return this.currentView;
  }

  setView(view) {
    if (!PROJECTION_TYPES.includes(view)) throw new Error(`Unsupported projection: ${view}`);
    this.currentView = view;
    this.layout();
    return this.currentView;
  }

  toggleView() {
    return this.setView(this.currentView === 'sphere' ? 'grid' : 'sphere');
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
    if (this.intersected) this.intersected.scale.setScalar(1);
    this.intersected = hit;
    if (hit) hit.scale.setScalar(1.5);
    this.canvas.style.cursor = hit ? 'pointer' : 'default';
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.updateIntersection();
    if (this.currentView === 'sphere') this.graphGroup.rotation.y += 0.001;
    else this.graphGroup.rotation.y = this.THREE.MathUtils.lerp(this.graphGroup.rotation.y, 0, 0.05);
    this.renderer.render(this.scene, this.camera);
  }
}
