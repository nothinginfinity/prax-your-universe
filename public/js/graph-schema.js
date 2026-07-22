export const PRAX_SCHEMA_VERSION = 2;

export const NODE_TYPES = Object.freeze([
  'universe',
  'universe_root',
  'link',
  'note',
  'project',
  'document',
  'conversation'
]);

export const EDGE_TYPES = Object.freeze([
  'contains',
  'references',
  'belongs_to',
  'related_to',
  'created_from',
  'parent_of'
]);

export const LAYOUT_TYPES = Object.freeze(['sphere', 'grid', 'custom']);
export const PROVENANCE_SOURCE_TYPES = Object.freeze(['system', 'user', 'import']);
export const UNIVERSE_ROOT_NODE_TYPE = 'universe_root';
export const DEFAULT_ROOT_EDGE_TYPE = 'contains';
export const PARENT_EDGE_TYPE = 'parent_of';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const SECOND_SEED = 0x9e3779b97f4a7c15n;
const FORBIDDEN_NODE_LAYOUT_FIELDS = ['x', 'y', 'z', 'position', 'positions', 'coordinates', 'layoutId'];

export class GraphValidationError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = 'GraphValidationError';
    this.issues = Object.freeze(issues.map((issue) => Object.freeze({ ...issue })));
  }
}

const cloneValue = (value) => {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

export const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

const fail = (message, path, code = 'invalid') => {
  throw new GraphValidationError(message, [{ path, code, message }]);
};

const requireObject = (value, path) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be an object.`, path, 'type');
  return value;
};

const requireString = (value, path, { allowEmpty = false, maxLength = 500 } = {}) => {
  if (typeof value !== 'string') fail(`${path} must be a string.`, path, 'type');
  const normalized = value.trim();
  if (!allowEmpty && !normalized) fail(`${path} is required.`, path, 'required');
  if (normalized.length > maxLength) fail(`${path} exceeds ${maxLength} characters.`, path, 'max_length');
  return normalized;
};

const optionalString = (value, path, maxLength = 100000) => {
  if (value === undefined || value === null) return null;
  return requireString(value, path, { allowEmpty: true, maxLength });
};

const normalizeTimestamp = (value, path, fallback) => {
  const timestamp = value ?? fallback;
  if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
    fail(`${path} must be a valid ISO-8601 timestamp.`, path, 'timestamp');
  }
  return new Date(timestamp).toISOString();
};

const validateId = (value, path) => {
  const id = requireString(value, path, { maxLength: 128 });
  if (!ID_PATTERN.test(id)) fail(`${path} contains unsupported characters.`, path, 'id_format');
  return id;
};

const fnv1a64 = (value, seed = FNV_OFFSET) => {
  let hash = seed;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0));
    hash = BigInt.asUintN(64, hash * FNV_PRIME);
  }
  return hash.toString(16).padStart(16, '0');
};

export const createDeterministicId = (prefix, ...parts) => {
  const normalizedPrefix = requireString(prefix, 'prefix', { maxLength: 24 }).toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const material = parts.map((part) => String(part)).join('\u001f');
  return `${normalizedPrefix}_${fnv1a64(material)}${fnv1a64(material, FNV_OFFSET ^ SECOND_SEED)}`;
};

export const createUniverseRootOriginId = (universeId) => `universe-root:${validateId(universeId, 'universeId')}`;

export const createUniverseRootId = (universeId) => {
  const normalizedUniverseId = validateId(universeId, 'universeId');
  return createDeterministicId(
    'node',
    normalizedUniverseId,
    UNIVERSE_ROOT_NODE_TYPE,
    createUniverseRootOriginId(normalizedUniverseId)
  );
};

export const createOriginId = () => {
  if (!globalThis.crypto?.randomUUID) throw new Error('crypto.randomUUID is required to create graph identities.');
  return globalThis.crypto.randomUUID();
};

export const createProvenance = (input = {}) => {
  const sourceType = input.sourceType ?? 'user';
  if (!PROVENANCE_SOURCE_TYPES.includes(sourceType)) fail('provenance.sourceType is unsupported.', 'provenance.sourceType', 'enum');
  return deepFreeze({
    sourceType,
    sourceId: requireString(input.sourceId ?? 'local', 'provenance.sourceId', { maxLength: 500 }),
    createdBy: requireString(input.createdBy ?? 'local-user', 'provenance.createdBy', { maxLength: 200 })
  });
};

const normalizeIdentity = ({ id, originId, prefix, parts, path }) => {
  const normalizedOriginId = requireString(originId ?? id ?? createOriginId(), `${path}.originId`, { maxLength: 500 });
  return {
    id: id ? validateId(id, `${path}.id`) : createDeterministicId(prefix, ...parts, normalizedOriginId),
    originId: normalizedOriginId
  };
};

const normalizeRecordBase = (input, kind, identity, now) => {
  const createdAt = normalizeTimestamp(input.createdAt, `${kind}.createdAt`, now);
  const updatedAt = normalizeTimestamp(input.updatedAt, `${kind}.updatedAt`, createdAt);
  if (Date.parse(updatedAt) < Date.parse(createdAt)) fail(`${kind}.updatedAt cannot precede createdAt.`, `${kind}.updatedAt`, 'timestamp_order');
  const schemaVersion = input.schemaVersion ?? PRAX_SCHEMA_VERSION;
  if (schemaVersion !== PRAX_SCHEMA_VERSION) fail(`${kind}.schemaVersion ${schemaVersion} is unsupported.`, `${kind}.schemaVersion`, 'schema_version');
  return {
    id: identity.id,
    originId: identity.originId,
    kind,
    schemaVersion,
    createdAt,
    updatedAt,
    provenance: createProvenance(input.provenance)
  };
};

export const createUniverseRecord = (input = {}, options = {}) => {
  requireObject(input, 'universe');
  const now = options.now ?? new Date().toISOString();
  const identity = normalizeIdentity({
    id: input.id,
    originId: input.originId ?? 'default-universe',
    prefix: 'universe',
    parts: ['prax'],
    path: 'universe'
  });
  return deepFreeze({
    ...normalizeRecordBase(input, 'universe', identity, now),
    name: requireString(input.name ?? 'My Universe', 'universe.name', { maxLength: 200 })
  });
};

const normalizeHttpUrl = (value, path) => {
  const raw = requireString(value, path, { maxLength: 4096 });
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail(`${path} must be a valid URL.`, path, 'url');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) fail(`${path} must use http or https.`, path, 'url_protocol');
  return parsed.href;
};

export const createNodeRecord = (input = {}, options = {}) => {
  requireObject(input, 'node');
  for (const field of FORBIDDEN_NODE_LAYOUT_FIELDS) {
    if (Object.hasOwn(input, field)) fail(`node.${field} belongs to a layout record, not canonical node data.`, `node.${field}`, 'layout_leak');
  }
  const universeId = validateId(input.universeId, 'node.universeId');
  const nodeType = input.nodeType;
  if (!NODE_TYPES.includes(nodeType)) fail('node.nodeType is unsupported.', 'node.nodeType', 'enum');
  const identity = normalizeIdentity({
    id: input.id,
    originId: input.originId,
    prefix: 'node',
    parts: [universeId, nodeType],
    path: 'node'
  });
  const now = options.now ?? new Date().toISOString();
  const url = nodeType === 'link'
    ? normalizeHttpUrl(input.url, 'node.url')
    : optionalString(input.url, 'node.url', 4096);
  if (nodeType !== 'link' && url !== null) fail('Only link nodes may contain a URL.', 'node.url', 'node_type_field');
  return deepFreeze({
    ...normalizeRecordBase(input, 'node', identity, now),
    universeId,
    nodeType,
    title: requireString(input.title, 'node.title', { maxLength: 500 }),
    body: optionalString(input.body, 'node.body'),
    url
  });
};

export const createEdgeRecord = (input = {}, options = {}) => {
  requireObject(input, 'edge');
  const universeId = validateId(input.universeId, 'edge.universeId');
  const edgeType = input.edgeType;
  if (!EDGE_TYPES.includes(edgeType)) fail('edge.edgeType is unsupported.', 'edge.edgeType', 'enum');
  const fromNodeId = validateId(input.fromNodeId, 'edge.fromNodeId');
  const toNodeId = validateId(input.toNodeId, 'edge.toNodeId');
  if (fromNodeId === toNodeId) fail('Self-referential edges are not allowed.', 'edge.toNodeId', 'self_edge');
  const identity = normalizeIdentity({
    id: input.id,
    originId: input.originId ?? `${edgeType}:${fromNodeId}:${toNodeId}`,
    prefix: 'edge',
    parts: [universeId, edgeType, fromNodeId, toNodeId],
    path: 'edge'
  });
  const now = options.now ?? new Date().toISOString();
  return deepFreeze({
    ...normalizeRecordBase(input, 'edge', identity, now),
    universeId,
    edgeType,
    fromNodeId,
    toNodeId
  });
};

export const createLayoutRecord = (input = {}, options = {}) => {
  requireObject(input, 'layout');
  const universeId = validateId(input.universeId, 'layout.universeId');
  const layoutType = input.layoutType;
  if (!LAYOUT_TYPES.includes(layoutType)) fail('layout.layoutType is unsupported.', 'layout.layoutType', 'enum');
  const identity = normalizeIdentity({
    id: input.id,
    originId: input.originId ?? layoutType,
    prefix: 'layout',
    parts: [universeId, layoutType],
    path: 'layout'
  });
  const now = options.now ?? new Date().toISOString();
  return deepFreeze({
    ...normalizeRecordBase(input, 'layout', identity, now),
    universeId,
    layoutType,
    name: requireString(input.name ?? layoutType, 'layout.name', { maxLength: 200 })
  });
};

const normalizeCoordinate = (value, path) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${path} must be a finite number.`, path, 'number');
  return value;
};

export const createLayoutNodeRecord = (input = {}, options = {}) => {
  requireObject(input, 'layoutNode');
  const universeId = validateId(input.universeId, 'layoutNode.universeId');
  const layoutId = validateId(input.layoutId, 'layoutNode.layoutId');
  const nodeId = validateId(input.nodeId, 'layoutNode.nodeId');
  const position = requireObject(input.position, 'layoutNode.position');
  const identity = normalizeIdentity({
    id: input.id,
    originId: input.originId ?? `${layoutId}:${nodeId}`,
    prefix: 'layout_node',
    parts: [universeId, layoutId, nodeId],
    path: 'layoutNode'
  });
  const now = options.now ?? new Date().toISOString();
  return deepFreeze({
    ...normalizeRecordBase(input, 'layout_node', identity, now),
    universeId,
    layoutId,
    nodeId,
    position: deepFreeze({
      x: normalizeCoordinate(position.x, 'layoutNode.position.x'),
      y: normalizeCoordinate(position.y, 'layoutNode.position.y'),
      z: normalizeCoordinate(position.z, 'layoutNode.position.z')
    })
  });
};

export const createSettingsRecord = (input = {}, options = {}) => {
  requireObject(input, 'settings');
  const universeId = validateId(input.universeId, 'settings.universeId');
  const identity = normalizeIdentity({
    id: input.id,
    originId: input.originId ?? 'default-settings',
    prefix: 'settings',
    parts: [universeId],
    path: 'settings'
  });
  const values = input.values ?? {};
  requireObject(values, 'settings.values');
  const now = options.now ?? new Date().toISOString();
  return deepFreeze({
    ...normalizeRecordBase(input, 'settings', identity, now),
    universeId,
    values: deepFreeze(cloneValue(values))
  });
};

const requireRecordIds = (records, path) => {
  if (!Array.isArray(records)) fail(`${path} must be an array.`, path, 'type');
  records.forEach((record, index) => {
    if (!record?.id) fail(`${path}[${index}].id is required.`, `${path}[${index}].id`, 'required');
  });
};

const assertUnique = (records, path) => {
  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.id)) fail(`Duplicate ID ${record.id}.`, path, 'duplicate_id');
    seen.add(record.id);
  }
};

const validateUniverseRootTopology = (normalized, { requireUniverseRoots = false } = {}) => {
  const rootsByUniverse = new Map(normalized.universes.map(({ id }) => [id, []]));
  const nodeById = new Map(normalized.nodes.map((node) => [node.id, node]));

  normalized.nodes.forEach((node, index) => {
    if (node.nodeType !== UNIVERSE_ROOT_NODE_TYPE) return;
    const expectedId = createUniverseRootId(node.universeId);
    if (node.id !== expectedId) {
      fail(
        'Universe root nodes must use the deterministic root identity.',
        `snapshot.nodes[${index}].id`,
        'root_identity'
      );
    }
    rootsByUniverse.get(node.universeId)?.push(node);
  });

  for (const universe of normalized.universes) {
    const roots = rootsByUniverse.get(universe.id) ?? [];
    if (roots.length > 1) {
      fail(
        `Universe ${universe.id} has more than one root node.`,
        'snapshot.nodes',
        'duplicate_universe_root'
      );
    }
    if (requireUniverseRoots && roots.length !== 1) {
      fail(
        `Universe ${universe.id} requires exactly one root node.`,
        'snapshot.nodes',
        'missing_universe_root'
      );
    }
  }

  const rootIds = new Set([...rootsByUniverse.values()].flat().map(({ id }) => id));
  const rootEdgeCountByNode = new Map();

  normalized.edges.forEach((edge, index) => {
    const fromRoot = rootIds.has(edge.fromNodeId);
    const toRoot = rootIds.has(edge.toNodeId);
    if (!fromRoot && !toRoot) return;
    if (
      edge.edgeType !== DEFAULT_ROOT_EDGE_TYPE
      || !fromRoot
      || toRoot
      || nodeById.get(edge.toNodeId)?.nodeType === UNIVERSE_ROOT_NODE_TYPE
    ) {
      fail(
        'Universe roots may only originate contains edges to non-root nodes.',
        `snapshot.edges[${index}]`,
        'invalid_root_edge'
      );
    }
    const key = `${edge.fromNodeId}\u001f${edge.toNodeId}`;
    const count = (rootEdgeCountByNode.get(key) ?? 0) + 1;
    rootEdgeCountByNode.set(key, count);
    if (count > 1) {
      fail(
        'A node may have only one default edge from its universe root.',
        `snapshot.edges[${index}]`,
        'duplicate_root_edge'
      );
    }
  });

  if (!requireUniverseRoots) return;

  normalized.nodes.forEach((node, index) => {
    if (node.nodeType === UNIVERSE_ROOT_NODE_TYPE) return;
    const root = (rootsByUniverse.get(node.universeId) ?? [])[0];
    const key = `${root.id}\u001f${node.id}`;
    if (rootEdgeCountByNode.get(key) !== 1) {
      fail(
        'Every non-root node requires one contains edge from its universe root.',
        `snapshot.nodes[${index}]`,
        'missing_root_edge'
      );
    }
  });
};

const validateHierarchyTopology = (normalized) => {
  const nodeById = new Map(normalized.nodes.map((node) => [node.id, node]));
  const incomingParentByChild = new Map();
  const relationshipKeys = new Set();

  normalized.edges.forEach((edge, index) => {
    if (edge.edgeType !== PARENT_EDGE_TYPE) return;
    const parent = nodeById.get(edge.fromNodeId);
    const child = nodeById.get(edge.toNodeId);
    if (parent?.nodeType === UNIVERSE_ROOT_NODE_TYPE || child?.nodeType === UNIVERSE_ROOT_NODE_TYPE) {
      fail(
        'Universe roots cannot be hierarchy parents or children.',
        `snapshot.edges[${index}]`,
        'invalid_hierarchy_endpoint'
      );
    }
    const relationshipKey = `${edge.fromNodeId}\u001f${edge.toNodeId}`;
    if (relationshipKeys.has(relationshipKey)) {
      fail(
        'A parent/child relationship may appear only once.',
        `snapshot.edges[${index}]`,
        'duplicate_parent_edge'
      );
    }
    relationshipKeys.add(relationshipKey);
    if (incomingParentByChild.has(edge.toNodeId)) {
      fail(
        'A node may have at most one incoming parent_of edge.',
        `snapshot.edges[${index}]`,
        'multiple_parents'
      );
    }
    incomingParentByChild.set(edge.toNodeId, edge.fromNodeId);
  });

  for (const childId of incomingParentByChild.keys()) {
    const visited = new Set([childId]);
    let cursor = childId;
    while (incomingParentByChild.has(cursor)) {
      cursor = incomingParentByChild.get(cursor);
      if (visited.has(cursor)) {
        fail('Hierarchy parent_of edges must be acyclic.', 'snapshot.edges', 'hierarchy_cycle');
      }
      visited.add(cursor);
    }
  }
};

export const validateGraphSnapshot = (input = {}, options = {}) => {
  requireObject(input, 'snapshot');
  const collections = {
    universes: input.universes ?? [],
    nodes: input.nodes ?? [],
    edges: input.edges ?? [],
    layouts: input.layouts ?? [],
    layoutNodes: input.layoutNodes ?? [],
    settings: input.settings ?? []
  };
  Object.entries(collections).forEach(([name, records]) => requireRecordIds(records, `snapshot.${name}`));
  if (!collections.universes.length) fail('A graph snapshot requires at least one universe.', 'snapshot.universes', 'required');

  const normalized = {
    schemaVersion: input.schemaVersion ?? PRAX_SCHEMA_VERSION,
    universes: collections.universes.map((record) => createUniverseRecord(record)),
    nodes: collections.nodes.map((record) => createNodeRecord(record)),
    edges: collections.edges.map((record) => createEdgeRecord(record)),
    layouts: collections.layouts.map((record) => createLayoutRecord(record)),
    layoutNodes: collections.layoutNodes.map((record) => createLayoutNodeRecord(record)),
    settings: collections.settings.map((record) => createSettingsRecord(record))
  };

  if (normalized.schemaVersion !== PRAX_SCHEMA_VERSION) fail('snapshot.schemaVersion is unsupported.', 'snapshot.schemaVersion', 'schema_version');
  Object.entries(normalized).forEach(([name, records]) => {
    if (Array.isArray(records)) assertUnique(records, `snapshot.${name}`);
  });

  const universeIds = new Set(normalized.universes.map(({ id }) => id));
  const nodeIds = new Set(normalized.nodes.map(({ id }) => id));
  const layoutIds = new Set(normalized.layouts.map(({ id }) => id));
  const assertUniverse = (record, path) => {
    if (!universeIds.has(record.universeId)) fail(`${path} references a missing universe.`, `${path}.universeId`, 'missing_reference');
  };
  normalized.nodes.forEach((record, index) => assertUniverse(record, `snapshot.nodes[${index}]`));
  normalized.edges.forEach((record, index) => {
    assertUniverse(record, `snapshot.edges[${index}]`);
    if (!nodeIds.has(record.fromNodeId) || !nodeIds.has(record.toNodeId)) {
      fail('Edge endpoints must exist in the snapshot.', `snapshot.edges[${index}]`, 'missing_reference');
    }
    const fromNode = normalized.nodes.find(({ id }) => id === record.fromNodeId);
    const toNode = normalized.nodes.find(({ id }) => id === record.toNodeId);
    if (fromNode?.universeId !== record.universeId || toNode?.universeId !== record.universeId) {
      fail('Edge endpoints must belong to the edge universe.', `snapshot.edges[${index}]`, 'cross_universe_edge');
    }
  });
  normalized.layouts.forEach((record, index) => assertUniverse(record, `snapshot.layouts[${index}]`));
  normalized.layoutNodes.forEach((record, index) => {
    assertUniverse(record, `snapshot.layoutNodes[${index}]`);
    if (!layoutIds.has(record.layoutId) || !nodeIds.has(record.nodeId)) {
      fail('Layout-node references must exist in the snapshot.', `snapshot.layoutNodes[${index}]`, 'missing_reference');
    }
  });
  normalized.settings.forEach((record, index) => assertUniverse(record, `snapshot.settings[${index}]`));

  validateUniverseRootTopology(normalized, options);
  validateHierarchyTopology(normalized);
  return deepFreeze(normalized);
};
