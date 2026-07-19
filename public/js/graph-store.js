import {
  DEFAULT_ROOT_EDGE_TYPE,
  GraphValidationError,
  PRAX_SCHEMA_VERSION,
  UNIVERSE_ROOT_NODE_TYPE,
  createEdgeRecord,
  createLayoutRecord,
  createNodeRecord,
  createSettingsRecord,
  createUniverseRecord,
  createUniverseRootOriginId,
  validateGraphSnapshot
} from './graph-schema.js';

const SEED_TIMESTAMP = '2026-07-19T00:00:00.000Z';
const PREFERRED_LAYOUT_TYPES = Object.freeze(['sphere', 'grid']);
const ROOT_PROVENANCE = Object.freeze({
  sourceType: 'system',
  sourceId: 'prax-universe-root-v1',
  createdBy: 'prax'
});
const ROOT_EDGE_PROVENANCE = Object.freeze({
  sourceType: 'system',
  sourceId: 'prax-default-root-edge-v1',
  createdBy: 'prax'
});

export const createUniverseRootRecord = (universe) => createNodeRecord({
  universeId: universe.id,
  originId: createUniverseRootOriginId(universe.id),
  nodeType: UNIVERSE_ROOT_NODE_TYPE,
  title: universe.name,
  body: 'Canonical root for this universe.',
  createdAt: universe.createdAt,
  updatedAt: universe.updatedAt,
  provenance: ROOT_PROVENANCE
});

export const createDefaultRootEdgeRecord = (root, node) => createEdgeRecord({
  universeId: node.universeId,
  edgeType: DEFAULT_ROOT_EDGE_TYPE,
  fromNodeId: root.id,
  toNodeId: node.id,
  createdAt: node.createdAt,
  updatedAt: node.updatedAt,
  provenance: ROOT_EDGE_PROVENANCE
});

export const upgradeGraphSnapshot = (snapshot) => {
  const normalized = validateGraphSnapshot(snapshot);
  const nodes = [...normalized.nodes];
  const edges = [...normalized.edges];
  let changed = false;

  for (const universe of normalized.universes) {
    let root = nodes.find((node) => (
      node.universeId === universe.id
      && node.nodeType === UNIVERSE_ROOT_NODE_TYPE
    ));

    if (!root) {
      root = createUniverseRootRecord(universe);
      nodes.push(root);
      changed = true;
    }

    for (const node of nodes) {
      if (node.universeId !== universe.id || node.nodeType === UNIVERSE_ROOT_NODE_TYPE) continue;
      const existing = edges.find((edge) => (
        edge.universeId === universe.id
        && edge.edgeType === DEFAULT_ROOT_EDGE_TYPE
        && edge.fromNodeId === root.id
        && edge.toNodeId === node.id
      ));
      if (existing) continue;
      edges.push(createDefaultRootEdgeRecord(root, node));
      changed = true;
    }
  }

  return Object.freeze({
    changed,
    snapshot: validateGraphSnapshot({
      ...normalized,
      nodes,
      edges
    }, { requireUniverseRoots: true })
  });
};

export const createSeedSnapshot = () => {
  const provenance = { sourceType: 'system', sourceId: 'prax-seed-v1', createdBy: 'prax' };
  const universe = createUniverseRecord({
    originId: 'prax-default-universe',
    name: 'My Universe',
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
    provenance
  });
  const nodes = [
    ['welcome', 'note', 'Welcome to Prax!', 'Your spatial knowledge universe begins here.'],
    ['add-first-link', 'note', 'Add your first link', 'Use the plus button to add a validated HTTP or HTTPS link.'],
    ['toggle-view', 'note', 'Toggle View', 'Switch between sphere and grid projections without changing graph truth.']
  ].map(([originId, nodeType, title, body]) => createNodeRecord({
    universeId: universe.id,
    originId,
    nodeType,
    title,
    body,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
    provenance
  }));
  const layouts = ['sphere', 'grid'].map((layoutType) => createLayoutRecord({
    universeId: universe.id,
    originId: `default-${layoutType}`,
    layoutType,
    name: `${layoutType[0].toUpperCase()}${layoutType.slice(1)}`,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
    provenance
  }));
  const settings = [createSettingsRecord({
    universeId: universe.id,
    originId: 'default-settings',
    values: { preferredLayout: 'sphere' },
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
    provenance
  })];
  return upgradeGraphSnapshot({
    schemaVersion: PRAX_SCHEMA_VERSION,
    universes: [universe],
    nodes,
    edges: [],
    layouts,
    layoutNodes: [],
    settings
  }).snapshot;
};

const mapById = (records) => new Map(records.map((record) => [record.id, record]));

export class GraphStore {
  constructor(snapshot = createSeedSnapshot()) {
    this.replaceSnapshot(snapshot);
  }

  replaceSnapshot(snapshot) {
    const normalized = upgradeGraphSnapshot(snapshot).snapshot;
    this.schemaVersion = normalized.schemaVersion;
    this.universes = mapById(normalized.universes);
    this.nodes = mapById(normalized.nodes);
    this.edges = mapById(normalized.edges);
    this.layouts = mapById(normalized.layouts);
    this.layoutNodes = mapById(normalized.layoutNodes);
    this.settings = mapById(normalized.settings);
    this.primaryUniverseId = normalized.universes[0].id;
    return this.snapshot();
  }

  snapshot() {
    return validateGraphSnapshot({
      schemaVersion: this.schemaVersion,
      universes: this.listUniverses(),
      nodes: this.listNodes(),
      edges: this.listEdges(),
      layouts: this.listLayouts(),
      layoutNodes: this.listLayoutNodes(),
      settings: this.listSettings()
    }, { requireUniverseRoots: true });
  }

  getUniverse(id = this.primaryUniverseId) {
    return this.universes.get(id) ?? null;
  }

  listUniverses() {
    return [...this.universes.values()];
  }

  getNode(id) {
    return this.nodes.get(id) ?? null;
  }

  listNodes() {
    return [...this.nodes.values()];
  }

  getUniverseRoot(universeId = this.primaryUniverseId) {
    return this.listNodes().find((node) => (
      node.universeId === universeId
      && node.nodeType === UNIVERSE_ROOT_NODE_TYPE
    )) ?? null;
  }

  getEdge(id) {
    return this.edges.get(id) ?? null;
  }

  listEdges() {
    return [...this.edges.values()];
  }

  getDefaultRootEdge(nodeId) {
    const node = this.getNode(nodeId);
    if (!node || node.nodeType === UNIVERSE_ROOT_NODE_TYPE) return null;
    const root = this.getUniverseRoot(node.universeId);
    if (!root) return null;
    return this.listEdges().find((edge) => (
      edge.edgeType === DEFAULT_ROOT_EDGE_TYPE
      && edge.fromNodeId === root.id
      && edge.toNodeId === node.id
    )) ?? null;
  }

  listLayouts() {
    return [...this.layouts.values()];
  }

  listLayoutNodes() {
    return [...this.layoutNodes.values()];
  }

  getSettings(id) {
    if (id) return this.settings.get(id) ?? null;
    return this.listSettings().find((record) => record.universeId === this.primaryUniverseId) ?? null;
  }

  listSettings() {
    return [...this.settings.values()];
  }

  getPreferredLayout() {
    const preferredLayout = this.getSettings()?.values.preferredLayout;
    return PREFERRED_LAYOUT_TYPES.includes(preferredLayout) ? preferredLayout : 'sphere';
  }

  updateSettings(values, updatedAt = new Date().toISOString()) {
    const current = this.getSettings();
    if (!current) {
      throw new GraphValidationError('The current universe has no settings record.', [{
        path: 'settings',
        code: 'missing_reference',
        message: 'The current universe has no settings record.'
      }]);
    }
    const settings = createSettingsRecord({
      ...current,
      values: { ...current.values, ...values },
      updatedAt
    });
    this.settings.set(settings.id, settings);
    return settings;
  }

  setPreferredLayout(layoutType, updatedAt) {
    if (!PREFERRED_LAYOUT_TYPES.includes(layoutType)) {
      throw new GraphValidationError('The preferred layout is unsupported.', [{
        path: 'settings.values.preferredLayout',
        code: 'enum',
        message: 'The preferred layout is unsupported.'
      }]);
    }
    return this.updateSettings({ preferredLayout: layoutType }, updatedAt);
  }

  addNode(input) {
    const node = createNodeRecord({ universeId: this.primaryUniverseId, ...input });
    if (!this.universes.has(node.universeId)) {
      throw new GraphValidationError('Node references a missing universe.', [{
        path: 'node.universeId',
        code: 'missing_reference',
        message: 'Node references a missing universe.'
      }]);
    }
    if (this.nodes.has(node.id)) {
      throw new GraphValidationError(`Node ${node.id} already exists.`, [{
        path: 'node.id',
        code: 'duplicate_id',
        message: `Node ${node.id} already exists.`
      }]);
    }
    if (node.nodeType === UNIVERSE_ROOT_NODE_TYPE) {
      throw new GraphValidationError('Universe roots are managed by the graph upgrade policy.', [{
        path: 'node.nodeType',
        code: 'managed_root',
        message: 'Universe roots are managed by the graph upgrade policy.'
      }]);
    }
    this.nodes.set(node.id, node);
    return node;
  }

  ensureDefaultRootEdge(nodeId) {
    const node = this.getNode(nodeId);
    if (!node || node.nodeType === UNIVERSE_ROOT_NODE_TYPE) {
      throw new GraphValidationError('A default root edge requires a non-root node.', [{
        path: 'nodeId',
        code: 'missing_reference',
        message: 'A default root edge requires a non-root node.'
      }]);
    }
    const existing = this.getDefaultRootEdge(node.id);
    if (existing) return existing;
    const root = this.getUniverseRoot(node.universeId);
    if (!root) {
      throw new GraphValidationError('The current universe has no root node.', [{
        path: 'root',
        code: 'missing_universe_root',
        message: 'The current universe has no root node.'
      }]);
    }
    return this.addEdge(createDefaultRootEdgeRecord(root, node));
  }

  addNodeWithDefaultEdge(input) {
    const previousSnapshot = this.snapshot();
    try {
      const node = this.addNode(input);
      const edge = this.ensureDefaultRootEdge(node.id);
      this.snapshot();
      return Object.freeze({ node, edge });
    } catch (error) {
      this.replaceSnapshot(previousSnapshot);
      throw error;
    }
  }

  addLinkWithDefaultEdge(title, url, provenance = {}) {
    return this.addNodeWithDefaultEdge({
      nodeType: 'link',
      title,
      url,
      provenance: {
        sourceType: 'user',
        sourceId: provenance.sourceId ?? 'local-link-form',
        createdBy: provenance.createdBy ?? 'local-user'
      }
    });
  }

  addLink(title, url, provenance = {}) {
    return this.addLinkWithDefaultEdge(title, url, provenance).node;
  }

  addEdge(input) {
    const edge = createEdgeRecord({ universeId: this.primaryUniverseId, ...input });
    const fromNode = this.nodes.get(edge.fromNodeId);
    const toNode = this.nodes.get(edge.toNodeId);
    if (!fromNode || !toNode || fromNode.universeId !== edge.universeId || toNode.universeId !== edge.universeId) {
      throw new GraphValidationError('Edge endpoints must exist in the same universe.', [{
        path: 'edge',
        code: 'missing_reference',
        message: 'Edge endpoints must exist in the same universe.'
      }]);
    }
    if (this.edges.has(edge.id)) {
      throw new GraphValidationError(`Edge ${edge.id} already exists.`, [{
        path: 'edge.id',
        code: 'duplicate_id',
        message: `Edge ${edge.id} already exists.`
      }]);
    }
    const root = this.getUniverseRoot(edge.universeId);
    if (root && edge.edgeType === DEFAULT_ROOT_EDGE_TYPE && edge.fromNodeId === root.id) {
      const duplicate = this.getDefaultRootEdge(edge.toNodeId);
      if (duplicate) {
        throw new GraphValidationError('A default root edge already exists for this node.', [{
          path: 'edge',
          code: 'duplicate_root_edge',
          message: 'A default root edge already exists for this node.'
        }]);
      }
    }
    this.edges.set(edge.id, edge);
    return edge;
  }
}
