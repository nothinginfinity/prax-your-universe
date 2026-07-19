import { GraphValidationError, PRAX_SCHEMA_VERSION, validateGraphSnapshot } from './graph-schema.js';
import { upgradeGraphSnapshot } from './graph-store.js';

export const PRAX_BUNDLE_FORMAT = 'prax-json';
export const PRAX_BUNDLE_VERSION = 1;
export const PRAX_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const PRAX_BUNDLE_MIME_TYPE = 'application/json;charset=utf-8';

const ENVELOPE_KEYS = Object.freeze(['format', 'bundleVersion', 'graphSchemaVersion', 'metadata', 'graph']);
const GRAPH_KEYS = Object.freeze(['schemaVersion', 'universes', 'nodes', 'edges', 'layouts', 'layoutNodes', 'settings']);
const RESERVED_METADATA_KEYS = new Set(['application', 'applicationVersion', 'exportedAt', 'universeId', 'universeName']);
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export class PraxBundleError extends Error {
  constructor(message, { code = 'bundle_invalid', path = 'bundle', cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PraxBundleError';
    this.code = code;
    this.path = path;
  }
}

const fail = (message, code, path, cause = null) => {
  throw new PraxBundleError(message, { code, path, cause });
};

const requirePlainObject = (value, path) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${path} must be an object.`, 'type', path);
  }
  return value;
};

const requireExactKeys = (value, allowedKeys, path) => {
  const unknown = Object.keys(value).find((key) => !allowedKeys.includes(key));
  if (unknown) fail(`${path}.${unknown} is unsupported.`, 'unknown_structural_field', `${path}.${unknown}`);
};

const inspectJsonSafety = (value, path = 'metadata', depth = 0) => {
  if (depth > 30) fail(`${path} exceeds the supported nesting depth.`, 'metadata_depth', path);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${path} contains a non-finite number.`, 'metadata_number', path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectJsonSafety(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== 'object') fail(`${path} must be JSON-compatible.`, 'metadata_type', path);
  for (const [key, item] of Object.entries(value)) {
    if (DANGEROUS_KEYS.has(key)) fail(`${path}.${key} is unsafe.`, 'metadata_key', `${path}.${key}`);
    inspectJsonSafety(item, `${path}.${key}`, depth + 1);
  }
};

const cloneJsonValue = (value, path = 'metadata') => {
  inspectJsonSafety(value, path);
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    fail(`${path} must be JSON-compatible.`, 'metadata_json', path, error);
  }
};

const sortObjectKeys = (value) => {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObjectKeys(value[key])]));
};

const sortRecords = (records) => [...records].sort((left, right) => left.id.localeCompare(right.id));

const normalizeExportedAt = (value) => {
  const timestamp = value ?? new Date().toISOString();
  if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
    fail('metadata.exportedAt must be a valid ISO-8601 timestamp.', 'timestamp', 'metadata.exportedAt');
  }
  return new Date(timestamp).toISOString();
};

const sanitizeFilenamePart = (value) => {
  const normalized = String(value ?? 'universe')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || 'universe';
};

const normalizeGraph = (graph) => {
  requirePlainObject(graph, 'bundle.graph');
  requireExactKeys(graph, GRAPH_KEYS, 'bundle.graph');
  try {
    const initial = validateGraphSnapshot(graph);
    if (initial.universes.length !== 1) {
      fail('PUX-005 bundles require exactly one universe.', 'universe_count', 'bundle.graph.universes');
    }
    const upgrade = upgradeGraphSnapshot(initial);
    return Object.freeze({ initial, ...upgrade });
  } catch (error) {
    if (error instanceof PraxBundleError) throw error;
    if (error instanceof GraphValidationError) {
      throw new PraxBundleError(error.message, {
        code: 'graph_validation',
        path: error.issues[0]?.path ?? 'bundle.graph',
        cause: error
      });
    }
    throw error;
  }
};

const createMetadata = ({ snapshot, applicationVersion, exportedAt, metadata = {} }) => {
  const supplied = cloneJsonValue(requirePlainObject(metadata, 'metadata'), 'metadata');
  const universe = snapshot.universes[0];
  const extensions = Object.fromEntries(Object.keys(supplied)
    .filter((key) => !RESERVED_METADATA_KEYS.has(key))
    .sort()
    .map((key) => [key, sortObjectKeys(supplied[key])]));
  return {
    application: 'prax-your-universe',
    applicationVersion: String(applicationVersion ?? 'unknown'),
    exportedAt: normalizeExportedAt(exportedAt ?? supplied.exportedAt),
    universeId: universe.id,
    universeName: universe.name,
    ...extensions
  };
};

export const createPraxBundle = (snapshot, options = {}) => {
  const normalized = normalizeGraph(snapshot).snapshot;
  const graph = {
    schemaVersion: normalized.schemaVersion,
    universes: sortRecords(normalized.universes),
    nodes: sortRecords(normalized.nodes),
    edges: sortRecords(normalized.edges),
    layouts: sortRecords(normalized.layouts),
    layoutNodes: sortRecords(normalized.layoutNodes),
    settings: sortRecords(normalized.settings)
  };
  return Object.freeze({
    format: PRAX_BUNDLE_FORMAT,
    bundleVersion: PRAX_BUNDLE_VERSION,
    graphSchemaVersion: PRAX_SCHEMA_VERSION,
    metadata: Object.freeze(createMetadata({ snapshot: normalized, ...options })),
    graph: Object.freeze(graph)
  });
};

export const serializePraxBundle = (bundle) => `${JSON.stringify(bundle, null, 2)}\n`;

export const createPraxExport = (snapshot, options = {}) => {
  const bundle = createPraxBundle(snapshot, options);
  const universe = bundle.graph.universes[0];
  return Object.freeze({
    bundle,
    json: serializePraxBundle(bundle),
    filename: `${sanitizeFilenamePart(universe.name)}-${sanitizeFilenamePart(universe.id.slice(-12))}.prax.json`,
    mimeType: PRAX_BUNDLE_MIME_TYPE
  });
};

const isLegacyGraphSnapshot = (value) => (
  value
  && typeof value === 'object'
  && !Array.isArray(value)
  && value.format === undefined
  && value.bundleVersion === undefined
  && Object.hasOwn(value, 'schemaVersion')
  && Array.isArray(value.universes)
  && Array.isArray(value.nodes)
);

const normalizeEnvelope = (input) => {
  requirePlainObject(input, 'bundle');
  if (isLegacyGraphSnapshot(input)) {
    return {
      legacy: true,
      metadata: {},
      graphSchemaVersion: input.schemaVersion,
      graph: input
    };
  }
  requireExactKeys(input, ENVELOPE_KEYS, 'bundle');
  if (input.format !== PRAX_BUNDLE_FORMAT) fail('bundle.format is unsupported.', 'format', 'bundle.format');
  if (input.bundleVersion !== PRAX_BUNDLE_VERSION) {
    fail(`bundle.bundleVersion ${input.bundleVersion} is unsupported.`, 'bundle_version', 'bundle.bundleVersion');
  }
  if (input.graphSchemaVersion !== PRAX_SCHEMA_VERSION) {
    fail(`bundle.graphSchemaVersion ${input.graphSchemaVersion} is unsupported.`, 'graph_schema_version', 'bundle.graphSchemaVersion');
  }
  const metadata = input.metadata ?? {};
  requirePlainObject(metadata, 'bundle.metadata');
  return {
    legacy: false,
    metadata: cloneJsonValue(metadata, 'bundle.metadata'),
    graphSchemaVersion: input.graphSchemaVersion,
    graph: input.graph
  };
};

export const parsePraxBundleText = (text, options = {}) => {
  if (typeof text !== 'string') fail('Import content must be text.', 'type', 'file');
  const byteLength = new TextEncoder().encode(text).byteLength;
  const maxBytes = options.maxBytes ?? PRAX_IMPORT_MAX_BYTES;
  if (byteLength > maxBytes) fail(`Import exceeds the ${maxBytes}-byte limit.`, 'file_too_large', 'file');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail('Import is not valid JSON.', 'malformed_json', 'file', error);
  }
  const envelope = normalizeEnvelope(parsed);
  if (envelope.graphSchemaVersion !== PRAX_SCHEMA_VERSION) {
    fail(`Graph schema version ${envelope.graphSchemaVersion} is unsupported.`, 'graph_schema_version', 'bundle.graphSchemaVersion');
  }
  const normalized = normalizeGraph(envelope.graph);
  const rootCountBefore = normalized.initial.nodes.filter(({ nodeType }) => nodeType === 'universe_root').length;
  const beforeRootIds = new Set(normalized.initial.nodes.filter(({ nodeType }) => nodeType === 'universe_root').map(({ id }) => id));
  const defaultEdgeCountBefore = normalized.initial.edges.filter(({ edgeType, fromNodeId }) => edgeType === 'contains' && beforeRootIds.has(fromNodeId)).length;
  const rootCountAfter = normalized.snapshot.nodes.filter(({ nodeType }) => nodeType === 'universe_root').length;
  const afterRootIds = new Set(normalized.snapshot.nodes.filter(({ nodeType }) => nodeType === 'universe_root').map(({ id }) => id));
  const defaultEdgeCountAfter = normalized.snapshot.edges.filter(({ edgeType, fromNodeId }) => edgeType === 'contains' && afterRootIds.has(fromNodeId)).length;
  const normalizedBundle = createPraxBundle(normalized.snapshot, {
    applicationVersion: envelope.metadata.applicationVersion ?? options.applicationVersion ?? 'unknown',
    exportedAt: envelope.metadata.exportedAt ?? new Date().toISOString(),
    metadata: envelope.metadata
  });
  return Object.freeze({
    bundle: normalizedBundle,
    snapshot: normalized.snapshot,
    summary: Object.freeze({
      legacy: envelope.legacy,
      normalizationChanged: normalized.changed,
      addedRootCount: rootCountAfter - rootCountBefore,
      addedDefaultEdgeCount: defaultEdgeCountAfter - defaultEdgeCountBefore,
      universeId: normalized.snapshot.universes[0].id,
      universeName: normalized.snapshot.universes[0].name,
      nodeCount: normalized.snapshot.nodes.length,
      edgeCount: normalized.snapshot.edges.length,
      layoutCount: normalized.snapshot.layouts.length,
      layoutNodeCount: normalized.snapshot.layoutNodes.length,
      settingsCount: normalized.snapshot.settings.length,
      sourceFilename: options.filename ?? null,
      byteLength
    })
  });
};
