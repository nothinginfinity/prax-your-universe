export const GALAXY_FOCUS_STATES = Object.freeze({
  IDLE: 'idle',
  ENTERING: 'entering',
  ACTIVE: 'active',
  EXITING: 'exiting'
});

const SUPPORTED_VIEWS = new Set(['sphere', 'grid']);
const freezeVector = ({ x = 0, y = 0, z = 0 } = {}) => Object.freeze({
  x: Number(x) || 0,
  y: Number(y) || 0,
  z: Number(z) || 0
});
const compareIds = (left, right) => String(left).localeCompare(String(right));

export const getGalaxyFocusNodeGroups = (focusedNodeId, nodes = [], edges = []) => {
  if (!focusedNodeId || !nodes.some(({ id }) => id === focusedNodeId)) {
    throw new Error('Galaxy Focus requires an existing focused node.');
  }
  const directNeighborIds = new Set();
  for (const edge of edges) {
    if (edge.fromNodeId === focusedNodeId) directNeighborIds.add(edge.toNodeId);
    if (edge.toNodeId === focusedNodeId) directNeighborIds.add(edge.fromNodeId);
  }
  directNeighborIds.delete(focusedNodeId);
  const knownIds = new Set(nodes.map(({ id }) => id));
  const neighbors = [...directNeighborIds].filter((id) => knownIds.has(id)).sort(compareIds);
  const neighborSet = new Set(neighbors);
  const unrelated = nodes
    .map(({ id }) => id)
    .filter((id) => id !== focusedNodeId && !neighborSet.has(id))
    .sort(compareIds);
  return Object.freeze({
    focusedNodeId,
    neighborNodeIds: Object.freeze(neighbors),
    unrelatedNodeIds: Object.freeze(unrelated)
  });
};

const sphereOrbitPosition = (index, count, radius) => {
  if (count <= 1) return freezeVector({ x: radius, y: 0, z: 0 });
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (index / (count - 1)) * 2;
  const ring = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = index * goldenAngle;
  return freezeVector({
    x: Math.cos(theta) * ring * radius,
    y: y * radius,
    z: Math.sin(theta) * ring * radius
  });
};

const gridOrbitPosition = (index, count, radius) => {
  const safeCount = Math.max(count, 1);
  const angle = (index / safeCount) * Math.PI * 2 - Math.PI / 2;
  return freezeVector({
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    z: -10
  });
};

export const calculateGalaxyFocusPositions = ({
  focusedNodeId,
  nodes = [],
  edges = [],
  view = 'sphere',
  neighborRadius = 4.5,
  haloRadius = 12
} = {}) => {
  if (!SUPPORTED_VIEWS.has(view)) throw new Error(`Unsupported Galaxy Focus view: ${view}`);
  const groups = getGalaxyFocusNodeGroups(focusedNodeId, nodes, edges);
  const positions = new Map();
  positions.set(focusedNodeId, freezeVector({ x: 0, y: 0, z: view === 'grid' ? -10 : 0 }));
  const positionFor = view === 'sphere' ? sphereOrbitPosition : gridOrbitPosition;
  groups.neighborNodeIds.forEach((nodeId, index) => {
    positions.set(nodeId, positionFor(index, groups.neighborNodeIds.length, neighborRadius));
  });
  groups.unrelatedNodeIds.forEach((nodeId, index) => {
    positions.set(nodeId, positionFor(index, groups.unrelatedNodeIds.length, haloRadius));
  });
  return Object.freeze({ groups, positions });
};

export const captureNodePositionSnapshot = (meshByNodeId) => {
  const snapshot = new Map();
  for (const [nodeId, mesh] of meshByNodeId ?? []) {
    snapshot.set(nodeId, freezeVector(mesh.position));
  }
  return snapshot;
};

export const positionSnapshotsEqual = (left, right) => {
  if (!(left instanceof Map) || !(right instanceof Map) || left.size !== right.size) return false;
  for (const [nodeId, leftPosition] of left) {
    const rightPosition = right.get(nodeId);
    if (!rightPosition) return false;
    if (leftPosition.x !== rightPosition.x || leftPosition.y !== rightPosition.y || leftPosition.z !== rightPosition.z) return false;
  }
  return true;
};

export class GalaxyFocusSession {
  constructor() {
    this.state = GALAXY_FOCUS_STATES.IDLE;
    this.focusedNodeId = null;
    this.snapshot = null;
  }

  begin(focusedNodeId, snapshot) {
    if (this.state !== GALAXY_FOCUS_STATES.IDLE) throw new Error('Galaxy Focus is already active.');
    if (!focusedNodeId) throw new Error('Galaxy Focus requires a focused node.');
    this.state = GALAXY_FOCUS_STATES.ENTERING;
    this.focusedNodeId = focusedNodeId;
    this.snapshot = snapshot;
    return this.getState();
  }

  activate() {
    if (this.state !== GALAXY_FOCUS_STATES.ENTERING) throw new Error('Galaxy Focus is not entering.');
    this.state = GALAXY_FOCUS_STATES.ACTIVE;
    return this.getState();
  }

  beginExit() {
    if (this.state === GALAXY_FOCUS_STATES.IDLE) return this.getState();
    this.state = GALAXY_FOCUS_STATES.EXITING;
    return this.getState();
  }

  clear() {
    this.state = GALAXY_FOCUS_STATES.IDLE;
    this.focusedNodeId = null;
    this.snapshot = null;
    return this.getState();
  }

  getState() {
    return Object.freeze({
      state: this.state,
      focusedNodeId: this.focusedNodeId,
      active: this.state !== GALAXY_FOCUS_STATES.IDLE
    });
  }
}
