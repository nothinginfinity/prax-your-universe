import {
  DEFAULT_ROOT_EDGE_TYPE,
  GraphValidationError,
  PARENT_EDGE_TYPE,
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
const MUTABLE_NODE_FIELDS = Object.freeze(['title', 'body', 'url']);
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
const GRAPH_COLLECTION_NAMES = Object.freeze(['universes', 'nodes', 'edges', 'layouts', 'layoutNodes', 'settings']);
const LEGACY_SCHEMA_VERSION = 1;

const graphIssue = (message, path, code) => new GraphValidationError(message, [{ path, code, message }]);

export const migrateGraphSnapshotToCurrent = (snapshot = {}) => {
  const sourceVersion = snapshot.schemaVersion ?? LEGACY_SCHEMA_VERSION;
  if (sourceVersion === PRAX_SCHEMA_VERSION) {
    return Object.freeze({ changed: false, snapshot });
  }
  if (sourceVersion !== LEGACY_SCHEMA_VERSION) {
    throw graphIssue(`Graph schema version ${sourceVersion} is unsupported.`, 'snapshot.schemaVersion', 'schema_version');
  }
  const migrated = { ...snapshot, schemaVersion: PRAX_SCHEMA_VERSION };
  for (const collectionName of GRAPH_COLLECTION_NAMES) {
    migrated[collectionName] = (snapshot[collectionName] ?? []).map((record) => ({
      ...record,
      schemaVersion: PRAX_SCHEMA_VERSION
    }));
  }
  return Object.freeze({ changed: true, snapshot: migrated });
};

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

export const createParentEdgeRecord = (parent, child, provenance = {}) => createEdgeRecord({
  universeId: child.universeId,
  edgeType: PARENT_EDGE_TYPE,
  fromNodeId: parent.id,
  toNodeId: child.id,
  createdAt: child.createdAt,
  updatedAt: child.updatedAt,
  provenance: {
    sourceType: 'user',
    sourceId: provenance.sourceId ?? 'local-add-child',
    createdBy: provenance.createdBy ?? 'local-user'
  }
});

export const upgradeGraphSnapshot = (snapshot) => {
  const migration = migrateGraphSnapshotToCurrent(snapshot);
  const normalized = validateGraphSnapshot(migration.snapshot);
  const nodes = [...normalized.nodes];
  const edges = [...normalized.edges];
  let changed = migration.changed;

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

  listConnectedEdges(nodeId) {
    return this.listEdges().filter(({ fromNodeId, toNodeId }) => fromNodeId === nodeId || toNodeId === nodeId);
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

  getParentEdge(nodeId) {
    return this.listEdges().find((edge) => edge.edgeType === PARENT_EDGE_TYPE && edge.toNodeId === nodeId) ?? null;
  }

  getParent(nodeId) {
    const edge = this.getParentEdge(nodeId);
    return edge ? this.getNode(edge.fromNodeId) : null;
  }

  listDirectChildren(nodeId) {
    return this.listEdges()
      .filter((edge) => edge.edgeType === PARENT_EDGE_TYPE && edge.fromNodeId === nodeId)
      .map((edge) => this.getNode(edge.toNodeId))
      .filter(Boolean);
  }

  getDirectChildCount(nodeId) {
    return this.listDirectChildren(nodeId).length;
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
    if (!current) throw graphIssue('The current universe has no settings record.', 'settings', 'missing_reference');
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
      throw graphIssue('The preferred layout is unsupported.', 'settings.values.preferredLayout', 'enum');
    }
    return this.updateSettings({ preferredLayout: layoutType }, updatedAt);
  }

  addNode(input) {
    const node = createNodeRecord({ universeId: this.primaryUniverseId, ...input });
    if (!this.universes.has(node.universeId)) {
      throw graphIssue('Node references a missing universe.', 'node.universeId', 'missing_reference');
    }
    if (this.nodes.has(node.id)) {
      throw graphIssue(`Node ${node.id} already exists.`, 'node.id', 'duplicate_id');
    }
    if (node.nodeType === UNIVERSE_ROOT_NODE_TYPE) {
      throw graphIssue('Universe roots are managed by the graph upgrade policy.', 'node.nodeType', 'managed_root');
    }
    this.nodes.set(node.id, node);
    return node;
  }

  ensureDefaultRootEdge(nodeId) {
    const node = this.getNode(nodeId);
    if (!node || node.nodeType === UNIVERSE_ROOT_NODE_TYPE) {
      throw graphIssue('A default root edge requires a non-root node.', 'nodeId', 'missing_reference');
    }
    const existing = this.getDefaultRootEdge(node.id);
    if (existing) return existing;
    const root = this.getUniverseRoot(node.universeId);
    if (!root) throw graphIssue('The current universe has no root node.', 'root', 'missing_universe_root');
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

  addChildWithHierarchy(parentId, input) {
    const previousSnapshot = this.snapshot();
    try {
      const parent = this.getNode(parentId);
      if (!parent) throw graphIssue(`Parent node ${parentId} does not exist.`, 'parentId', 'missing_reference');
      if (parent.nodeType === UNIVERSE_ROOT_NODE_TYPE) {
        throw graphIssue('Universe roots cannot participate in hierarchy.', 'parentId', 'invalid_hierarchy_endpoint');
      }
      const node = this.addNode({ ...input, universeId: parent.universeId });
      const rootEdge = this.ensureDefaultRootEdge(node.id);
      const parentEdge = this.addParentEdge(parent.id, node.id, input?.provenance);
      this.snapshot();
      return Object.freeze({ parent, node, rootEdge, parentEdge });
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

  addNoteWithDefaultEdge(title, body, provenance = {}) {
    return this.addNodeWithDefaultEdge({
      nodeType: 'note',
      title,
      body,
      provenance: {
        sourceType: 'user',
        sourceId: provenance.sourceId ?? 'local-note-form',
        createdBy: provenance.createdBy ?? 'local-user'
      }
    });
  }

  addNote(title, body, provenance = {}) {
    return this.addNoteWithDefaultEdge(title, body, provenance).node;
  }

  updateNode(nodeId, changes = {}, updatedAt = new Date().toISOString()) {
    const previousSnapshot = this.snapshot();
    try {
      const current = this.getNode(nodeId);
      if (!current) throw graphIssue(`Node ${nodeId} does not exist.`, 'nodeId', 'missing_reference');
      if (current.nodeType === UNIVERSE_ROOT_NODE_TYPE) {
        throw graphIssue('Universe roots cannot be edited through node CRUD.', 'node.nodeType', 'managed_root');
      }
      if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
        throw graphIssue('Node changes must be an object.', 'changes', 'type');
      }
      const unsupportedField = Object.keys(changes).find((field) => !MUTABLE_NODE_FIELDS.includes(field));
      if (unsupportedField) {
        throw graphIssue(`node.${unsupportedField} is immutable.`, `node.${unsupportedField}`, 'immutable_field');
      }
      const updated = createNodeRecord({
        ...current,
        ...changes,
        id: current.id,
        originId: current.originId,
        universeId: current.universeId,
        nodeType: current.nodeType,
        schemaVersion: current.schemaVersion,
        createdAt: current.createdAt,
        updatedAt,
        provenance: current.provenance
      });
      this.nodes.set(updated.id, updated);
      this.snapshot();
      return updated;
    } catch (error) {
      this.replaceSnapshot(previousSnapshot);
      throw error;
    }
  }

  deleteNode(nodeId) {
    const previousSnapshot = this.snapshot();
    try {
      const node = this.getNode(nodeId);
      if (!node) throw graphIssue(`Node ${nodeId} does not exist.`, 'nodeId', 'missing_reference');
      if (node.nodeType === UNIVERSE_ROOT_NODE_TYPE) {
        throw graphIssue('Universe roots cannot be deleted.', 'node.nodeType', 'managed_root');
      }
      const promotedChildren = this.listDirectChildren(nodeId);
      const edges = this.listConnectedEdges(nodeId);
      const layoutNodes = this.listLayoutNodes().filter((record) => record.nodeId === nodeId);
      edges.forEach(({ id }) => this.edges.delete(id));
      layoutNodes.forEach(({ id }) => this.layoutNodes.delete(id));
      this.nodes.delete(nodeId);
      this.snapshot();
      return Object.freeze({
        node,
        edges: Object.freeze([...edges]),
        layoutNodes: Object.freeze([...layoutNodes]),
        promotedChildren: Object.freeze([...promotedChildren])
      });
    } catch (error) {
      this.replaceSnapshot(previousSnapshot);
      throw error;
    }
  }

  assertParentEdgeCandidate(edge, parent, child) {
    if (parent.nodeType === UNIVERSE_ROOT_NODE_TYPE || child.nodeType === UNIVERSE_ROOT_NODE_TYPE) {
      throw graphIssue('Universe roots cannot participate in hierarchy.', 'edge', 'invalid_hierarchy_endpoint');
    }
    const duplicate = this.listEdges().find((record) => (
      record.edgeType === PARENT_EDGE_TYPE
      && record.fromNodeId === edge.fromNodeId
      && record.toNodeId === edge.toNodeId
    ));
    if (duplicate) throw graphIssue('This parent/child relationship already exists.', 'edge', 'duplicate_parent_edge');
    if (this.getParentEdge(child.id)) {
      throw graphIssue('A node may have at most one parent.', 'edge.toNodeId', 'multiple_parents');
    }
    const visited = new Set([child.id]);
    let cursor = parent.id;
    while (cursor) {
      if (visited.has(cursor)) throw graphIssue('Hierarchy edges must be acyclic.', 'edge', 'hierarchy_cycle');
      visited.add(cursor);
      cursor = this.getParentEdge(cursor)?.fromNodeId ?? null;
    }
  }

  addParentEdge(parentId, childId, provenance = {}) {
    const parent = this.getNode(parentId);
    const child = this.getNode(childId);
    if (!parent || !child) throw graphIssue('Parent and child nodes must exist.', 'edge', 'missing_reference');
    return this.addEdge(createParentEdgeRecord(parent, child, provenance));
  }

  addEdge(input) {
    const edge = createEdgeRecord({ universeId: this.primaryUniverseId, ...input });
    const fromNode = this.nodes.get(edge.fromNodeId);
    const toNode = this.nodes.get(edge.toNodeId);
    if (!fromNode || !toNode || fromNode.universeId !== edge.universeId || toNode.universeId !== edge.universeId) {
      throw graphIssue('Edge endpoints must exist in the same universe.', 'edge', 'missing_reference');
    }
    if (edge.edgeType === PARENT_EDGE_TYPE) this.assertParentEdgeCandidate(edge, fromNode, toNode);
    if (this.edges.has(edge.id)) {
      throw graphIssue(`Edge ${edge.id} already exists.`, 'edge.id', 'duplicate_id');
    }
    const root = this.getUniverseRoot(edge.universeId);
    if (root && edge.edgeType === DEFAULT_ROOT_EDGE_TYPE && edge.fromNodeId === root.id) {
      const duplicate = this.getDefaultRootEdge(edge.toNodeId);
      if (duplicate) {
        throw graphIssue('A default root edge already exists for this node.', 'edge', 'duplicate_root_edge');
      }
    }
    this.edges.set(edge.id, edge);
    return edge;
  }
}
