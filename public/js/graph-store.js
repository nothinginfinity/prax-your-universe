import {
  GraphValidationError,
  PRAX_SCHEMA_VERSION,
  createEdgeRecord,
  createLayoutRecord,
  createNodeRecord,
  createSettingsRecord,
  createUniverseRecord,
  validateGraphSnapshot
} from './graph-schema.js';

const SEED_TIMESTAMP = '2026-07-19T00:00:00.000Z';
const PREFERRED_LAYOUT_TYPES = Object.freeze(['sphere', 'grid']);

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
  return validateGraphSnapshot({
    schemaVersion: PRAX_SCHEMA_VERSION,
    universes: [universe],
    nodes,
    edges: [],
    layouts,
    layoutNodes: [],
    settings
  });
};

const mapById = (records) => new Map(records.map((record) => [record.id, record]));

export class GraphStore {
  constructor(snapshot = createSeedSnapshot()) {
    this.replaceSnapshot(snapshot);
  }

  replaceSnapshot(snapshot) {
    const normalized = validateGraphSnapshot(snapshot);
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
    });
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

  getEdge(id) {
    return this.edges.get(id) ?? null;
  }

  listEdges() {
    return [...this.edges.values()];
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
    this.nodes.set(node.id, node);
    return node;
  }

  addLink(title, url, provenance = {}) {
    return this.addNode({
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
    this.edges.set(edge.id, edge);
    return edge;
  }
}
