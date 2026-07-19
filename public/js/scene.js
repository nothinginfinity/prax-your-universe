const hueFromId = (id) => {
  let hash = 0;
  for (const character of id) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return Math.abs(hash % 360) / 360;
};

const PROJECTION_TYPES = Object.freeze(['sphere', 'grid']);

export class PraxScene {
  constructor(canvas, onSelect) {
    this.canvas = canvas;
    this.onSelect = onSelect;
    this.currentView = 'sphere';
    this.pointsGroup = new THREE.Group();
    this.meshByNodeId = new Map();
    this.projectionPositions = new Map();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(2, 2);
    this.intersected = null;
  }

  init() {
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
    this.scene.add(light, this.pointsGroup);
    this.addStars();
    this.camera.position.set(0, 0, 35);
    addEventListener('resize', () => this.resize());
    this.renderer.domElement.addEventListener('pointermove', (event) => this.movePointer(event));
    this.renderer.domElement.addEventListener('pointerdown', () => this.select());
    this.animate();
  }

  addStars() {
    const vertices = [];
    for (let i = 0; i < 20000; i += 1) vertices.push((Math.random() - 0.5) * 800, (Math.random() - 0.5) * 800, (Math.random() - 0.5) * 800);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    this.scene.add(new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xaaaaaa, size: 0.4, transparent: true, opacity: 0.7 })));
  }

  addNodes(nodes) {
    for (const node of nodes) {
      if (this.meshByNodeId.has(node.id)) {
        this.updateNode(node);
        continue;
      }
      const color = new THREE.Color().setHSL(hueFromId(node.id), 0.8, 0.6);
      const point = new THREE.Mesh(
        new THREE.SphereGeometry(0.4, 16, 16),
        new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.2 })
      );
      point.userData = { nodeId: node.id, nodeType: node.nodeType };
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
    if (this.intersected === point) this.intersected = null;
    this.pointsGroup.remove(point);
    point.geometry.dispose();
    point.material.dispose();
    this.meshByNodeId.delete(nodeId);
    this.projectionPositions.delete(nodeId);
    this.layout();
    return true;
  }

  layout() {
    const points = this.pointsGroup.children;
    const count = points.length;
    if (!count) return;
    const radius = 8 * Math.cbrt(Math.max(count, 2) / 2);
    const phi = Math.PI * (3 - Math.sqrt(5));
    const gridSize = Math.ceil(Math.sqrt(count));
    points.forEach((point, index) => {
      const y = count === 1 ? 0 : 1 - (index / (count - 1)) * 2;
      const theta = phi * index;
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      const sphere = new THREE.Vector3(Math.cos(theta) * ring * radius, y * radius, Math.sin(theta) * ring * radius);
      const grid = new THREE.Vector3(
        (index % gridSize - (gridSize - 1) / 2) * 2.5,
        (Math.floor(index / gridSize) - (Math.ceil(count / gridSize) - 1) / 2) * 2.5,
        -10
      );
      this.projectionPositions.set(point.userData.nodeId, { sphere, grid });
      point.position.copy(this.projectionPositions.get(point.userData.nodeId)[this.currentView]);
    });
    this.camera.position.set(0, 0, this.currentView === 'sphere' ? radius * 2.2 : 25);
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
    if (this.currentView === 'sphere') this.pointsGroup.rotation.y += 0.001;
    else this.pointsGroup.rotation.y = THREE.MathUtils.lerp(this.pointsGroup.rotation.y, 0, 0.05);
    this.renderer.render(this.scene, this.camera);
  }
}
