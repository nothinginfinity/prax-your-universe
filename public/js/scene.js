export class PraxScene {
  constructor(canvas, onSelect) {
    this.canvas = canvas;
    this.onSelect = onSelect;
    this.currentView = 'sphere';
    this.pointsGroup = new THREE.Group();
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
      const color = new THREE.Color().setHSL(Math.random(), 0.8, 0.6);
      const point = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 16), new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.2 }));
      point.userData = { ...node };
      this.pointsGroup.add(point);
    }
    this.layout();
  }

  layout() {
    const count = this.pointsGroup.children.length;
    if (!count) return;
    const radius = 8 * Math.cbrt(Math.max(count, 2) / 2);
    const phi = Math.PI * (3 - Math.sqrt(5));
    const gridSize = Math.ceil(Math.sqrt(count));
    this.pointsGroup.children.forEach((point, index) => {
      const y = count === 1 ? 0 : 1 - (index / (count - 1)) * 2;
      const theta = phi * index;
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      const sphere = new THREE.Vector3(Math.cos(theta) * ring * radius, y * radius, Math.sin(theta) * ring * radius);
      const grid = new THREE.Vector3((index % gridSize - (gridSize - 1) / 2) * 2.5, (Math.floor(index / gridSize) - (Math.ceil(count / gridSize) - 1) / 2) * 2.5, -10);
      point.userData.positions = { sphere, grid };
      point.position.copy(point.userData.positions[this.currentView]);
    });
    this.camera.position.set(0, 0, this.currentView === 'sphere' ? radius * 2.2 : 25);
  }

  toggleView() {
    this.currentView = this.currentView === 'sphere' ? 'grid' : 'sphere';
    this.layout();
    return this.currentView;
  }

  movePointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  select() {
    this.onSelect(this.intersected?.userData ?? null);
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
