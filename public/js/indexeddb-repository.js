import { GraphValidationError, PRAX_SCHEMA_VERSION, validateGraphSnapshot } from './graph-schema.js';

export const PRAX_DATABASE_NAME = 'prax-your-universe';
export const PRAX_DATABASE_VERSION = 1;

export const GRAPH_OBJECT_STORES = Object.freeze({
  universes: 'universes',
  nodes: 'nodes',
  edges: 'edges',
  layouts: 'layouts',
  layoutNodes: 'layout_nodes',
  settings: 'settings'
});

const META_STORE = 'meta';
const GRAPH_STORE_ENTRIES = Object.freeze(Object.entries(GRAPH_OBJECT_STORES));
const ALL_STORE_NAMES = Object.freeze([...Object.values(GRAPH_OBJECT_STORES), META_STORE]);

export class IndexedDbRepositoryError extends Error {
  constructor(message, { code = 'indexeddb_error', operation = 'unknown', cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'IndexedDbRepositoryError';
    this.code = code;
    this.operation = operation;
  }
}

const repositoryError = (operation, error, code = 'indexeddb_error') => {
  if (error instanceof GraphValidationError) return error;
  if (error instanceof IndexedDbRepositoryError && error.operation === operation) return error;
  return new IndexedDbRepositoryError(`IndexedDB ${operation} failed.`, { code, operation, cause: error });
};

const requestToPromise = (request, operation) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(repositoryError(operation, request.error, 'request_failed'));
});

const transactionToPromise = (transaction, operation) => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onabort = () => reject(repositoryError(operation, transaction.error, 'transaction_aborted'));
  transaction.onerror = () => reject(repositoryError(operation, transaction.error, 'transaction_failed'));
});

const ensureIndex = (store, name, keyPath) => {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, { unique: false });
};

const createGraphStore = (database, name) => {
  const store = database.objectStoreNames.contains(name)
    ? null
    : database.createObjectStore(name, { keyPath: 'id' });
  return store;
};

const migrationV1 = (database, transaction) => {
  createGraphStore(database, GRAPH_OBJECT_STORES.universes);
  createGraphStore(database, GRAPH_OBJECT_STORES.nodes);
  createGraphStore(database, GRAPH_OBJECT_STORES.edges);
  createGraphStore(database, GRAPH_OBJECT_STORES.layouts);
  createGraphStore(database, GRAPH_OBJECT_STORES.layoutNodes);
  createGraphStore(database, GRAPH_OBJECT_STORES.settings);
  if (!database.objectStoreNames.contains(META_STORE)) database.createObjectStore(META_STORE, { keyPath: 'key' });

  for (const storeName of Object.values(GRAPH_OBJECT_STORES)) {
    const store = transaction.objectStore(storeName);
    if (storeName !== GRAPH_OBJECT_STORES.universes) ensureIndex(store, 'by_universe', 'universeId');
    if (storeName === GRAPH_OBJECT_STORES.edges) {
      ensureIndex(store, 'by_from_node', 'fromNodeId');
      ensureIndex(store, 'by_to_node', 'toNodeId');
    }
    if (storeName === GRAPH_OBJECT_STORES.layoutNodes) {
      ensureIndex(store, 'by_layout', 'layoutId');
      ensureIndex(store, 'by_node', 'nodeId');
    }
  }
};

const MIGRATIONS = Object.freeze({ 1: migrationV1 });

export const upgradePraxDatabase = (database, transaction, oldVersion, newVersion) => {
  const targetVersion = newVersion ?? PRAX_DATABASE_VERSION;
  for (let version = oldVersion + 1; version <= targetVersion; version += 1) {
    const migrate = MIGRATIONS[version];
    if (!migrate) {
      throw new IndexedDbRepositoryError(`No IndexedDB migration exists for version ${version}.`, {
        code: 'missing_migration',
        operation: 'upgrade'
      });
    }
    migrate(database, transaction);
  }
};

const openDatabase = ({ indexedDB, databaseName, databaseVersion }) => new Promise((resolve, reject) => {
  let upgradeError = null;
  let settled = false;
  const request = indexedDB.open(databaseName, databaseVersion);
  const finish = (callback, value) => {
    if (settled) return;
    settled = true;
    callback(value);
  };

  request.onupgradeneeded = (event) => {
    try {
      upgradePraxDatabase(request.result, request.transaction, event.oldVersion, event.newVersion);
    } catch (error) {
      upgradeError = repositoryError('upgrade', error, 'upgrade_failed');
      request.transaction?.abort();
    }
  };
  request.onblocked = () => finish(reject, new IndexedDbRepositoryError('IndexedDB upgrade is blocked by another open tab.', {
    code: 'upgrade_blocked',
    operation: 'open'
  }));
  request.onerror = () => finish(reject, upgradeError ?? repositoryError('open', request.error, 'open_failed'));
  request.onsuccess = () => {
    const database = request.result;
    database.onversionchange = () => database.close();
    finish(resolve, database);
  };
});

const cloneRecord = (record) => {
  if (typeof structuredClone === 'function') return structuredClone(record);
  return JSON.parse(JSON.stringify(record));
};

export class PraxIndexedDbRepository {
  constructor({
    indexedDB = globalThis.indexedDB,
    databaseName = PRAX_DATABASE_NAME,
    databaseVersion = PRAX_DATABASE_VERSION
  } = {}) {
    this.indexedDB = indexedDB;
    this.databaseName = databaseName;
    this.databaseVersion = databaseVersion;
    this.databasePromise = null;
    this.database = null;
  }

  async open() {
    if (!this.indexedDB?.open) {
      throw new IndexedDbRepositoryError('IndexedDB is unavailable in this browser context.', {
        code: 'unavailable',
        operation: 'open'
      });
    }
    if (!this.databasePromise) {
      this.databasePromise = openDatabase({
        indexedDB: this.indexedDB,
        databaseName: this.databaseName,
        databaseVersion: this.databaseVersion
      }).then((database) => {
        this.database = database;
        return database;
      }).catch((error) => {
        this.databasePromise = null;
        throw error;
      });
    }
    return this.databasePromise;
  }

  async loadSnapshot() {
    const database = await this.open();
    let transaction;
    try {
      transaction = database.transaction(ALL_STORE_NAMES, 'readonly');
      const completion = transactionToPromise(transaction, 'load');
      const readRequests = GRAPH_STORE_ENTRIES.map(([collection, storeName]) => [
        collection,
        requestToPromise(transaction.objectStore(storeName).getAll(), `load ${collection}`)
      ]);
      const [values] = await Promise.all([
        Promise.all(readRequests.map(async ([collection, promise]) => [collection, await promise])),
        completion
      ]);
      const collections = Object.fromEntries(values);
      if (!collections.universes.length) return null;
      return validateGraphSnapshot({ schemaVersion: PRAX_SCHEMA_VERSION, ...collections });
    } catch (error) {
      throw repositoryError('load', error, 'load_failed');
    }
  }

  async saveSnapshot(snapshot) {
    const normalized = validateGraphSnapshot(snapshot);
    const database = await this.open();
    let transaction;
    try {
      transaction = database.transaction(ALL_STORE_NAMES, 'readwrite');
      const completion = transactionToPromise(transaction, 'save');
      const requests = [];
      for (const [collection, storeName] of GRAPH_STORE_ENTRIES) {
        const store = transaction.objectStore(storeName);
        requests.push(requestToPromise(store.clear(), `clear ${collection}`));
        for (const record of normalized[collection]) {
          requests.push(requestToPromise(store.put(cloneRecord(record)), `write ${collection}`));
        }
      }
      requests.push(requestToPromise(transaction.objectStore(META_STORE).put({
        key: 'graph',
        schemaVersion: normalized.schemaVersion,
        databaseVersion: this.databaseVersion,
        savedAt: new Date().toISOString()
      }), 'write metadata'));
      await Promise.all([Promise.all(requests), completion]);
      return normalized;
    } catch (error) {
      try {
        transaction?.abort();
      } catch {
        // The transaction may already be committed or aborted.
      }
      throw repositoryError('save', error, 'save_failed');
    }
  }

  async loadOrCreate(seedSnapshot) {
    const existing = await this.loadSnapshot();
    if (existing) return existing;
    return this.saveSnapshot(seedSnapshot);
  }

  close() {
    this.database?.close();
    this.database = null;
    this.databasePromise = null;
  }
}
