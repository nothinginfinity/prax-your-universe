const clone = (value) => {
  if (value === undefined) return undefined;
  return structuredClone(value);
};

class FakeNameList {
  constructor(values) {
    this.values = values;
  }

  contains(name) {
    return this.values().includes(name);
  }

  item(index) {
    return this.values()[index] ?? null;
  }

  get length() {
    return this.values().length;
  }

  [Symbol.iterator]() {
    return this.values()[Symbol.iterator]();
  }
}

class FakeRequest {
  constructor() {
    this.result = undefined;
    this.error = null;
    this.onsuccess = null;
    this.onerror = null;
    this.onblocked = null;
    this.onupgradeneeded = null;
    this.transaction = null;
  }
}

class FakeUpgradeObjectStore {
  constructor(definition) {
    this.definition = definition;
    this.indexNames = new FakeNameList(() => [...definition.indexes.keys()]);
  }

  createIndex(name, keyPath, options = {}) {
    this.definition.indexes.set(name, { keyPath, unique: Boolean(options.unique) });
    return { name, keyPath, unique: Boolean(options.unique) };
  }
}

class FakeUpgradeTransaction {
  constructor(database) {
    this.database = database;
    this.error = null;
    this.aborted = false;
  }

  objectStore(name) {
    const definition = this.database.state.definitions.get(name);
    if (!definition) throw new Error(`Missing object store: ${name}`);
    return new FakeUpgradeObjectStore(definition);
  }

  abort() {
    this.aborted = true;
    this.error = this.error ?? new Error('Upgrade transaction aborted.');
  }
}

class FakeTransactionObjectStore {
  constructor(transaction, name) {
    this.transaction = transaction;
    this.name = name;
    this.definition = transaction.state.definitions.get(name);
    this.indexNames = new FakeNameList(() => [...this.definition.indexes.keys()]);
  }

  createIndex(name, keyPath, options = {}) {
    this.definition.indexes.set(name, { keyPath, unique: Boolean(options.unique) });
    return { name, keyPath, unique: Boolean(options.unique) };
  }

  clear() {
    return this.transaction.enqueue(() => {
      this.transaction.data.get(this.name).clear();
      return undefined;
    }, true);
  }

  put(value) {
    return this.transaction.enqueue(() => {
      const keyPath = this.definition.keyPath;
      const key = value?.[keyPath];
      if (key === undefined || key === null) throw new Error(`Missing keyPath ${keyPath}.`);
      this.transaction.data.get(this.name).set(key, clone(value));
      return key;
    }, true);
  }

  getAll() {
    return this.transaction.enqueue(() => [...this.transaction.data.get(this.name).values()].map(clone), false);
  }
}

class FakeTransaction {
  constructor(factory, state, storeNames, mode) {
    this.factory = factory;
    this.state = state;
    this.storeNames = [...storeNames];
    this.mode = mode;
    this.error = null;
    this.oncomplete = null;
    this.onabort = null;
    this.onerror = null;
    this.pending = 0;
    this.failed = false;
    this.finished = false;
    this.completionScheduled = false;
    this.data = mode === 'readwrite'
      ? new Map(this.storeNames.map((name) => [name, new Map([...state.data.get(name).entries()].map(([key, value]) => [key, clone(value)]))]))
      : state.data;
  }

  objectStore(name) {
    if (!this.storeNames.includes(name)) throw new Error(`Store ${name} is outside this transaction.`);
    return new FakeTransactionObjectStore(this, name);
  }

  enqueue(operation, isWrite) {
    const request = new FakeRequest();
    this.pending += 1;
    setTimeout(() => {
      if (this.failed || this.finished) return;
      if (isWrite && this.factory.nextWriteFailure) {
        const error = this.factory.nextWriteFailure;
        this.factory.nextWriteFailure = null;
        request.error = error;
        request.onerror?.({ target: request });
        this.abort(error);
        return;
      }
      try {
        request.result = operation();
        request.onsuccess?.({ target: request });
      } catch (error) {
        request.error = error;
        request.onerror?.({ target: request });
        this.abort(error);
        return;
      }
      this.pending -= 1;
      this.scheduleCompletion();
    }, 0);
    return request;
  }

  scheduleCompletion() {
    if (this.pending !== 0 || this.failed || this.finished || this.completionScheduled) return;
    this.completionScheduled = true;
    setTimeout(() => {
      this.completionScheduled = false;
      if (this.pending !== 0 || this.failed || this.finished) return;
      if (this.mode === 'readwrite') {
        for (const [name, records] of this.data) this.state.data.set(name, records);
      }
      this.finished = true;
      this.oncomplete?.({ target: this });
    }, 0);
  }

  abort(error = new Error('Transaction aborted.')) {
    if (this.failed || this.finished) return;
    this.failed = true;
    this.error = error;
    setTimeout(() => {
      this.onerror?.({ target: this });
      this.onabort?.({ target: this });
    }, 0);
  }
}

class FakeDatabase {
  constructor(factory, state) {
    this.factory = factory;
    this.state = state;
    this.name = state.name;
    this.version = state.version;
    this.onversionchange = null;
    this.closed = false;
    this.objectStoreNames = new FakeNameList(() => [...state.definitions.keys()]);
  }

  createObjectStore(name, options = {}) {
    if (this.state.definitions.has(name)) throw new Error(`Object store ${name} already exists.`);
    this.state.definitions.set(name, { keyPath: options.keyPath ?? null, indexes: new Map() });
    this.state.data.set(name, new Map());
    return new FakeUpgradeObjectStore(this.state.definitions.get(name));
  }

  transaction(storeNames, mode = 'readonly') {
    if (this.closed) throw new Error('Database is closed.');
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    for (const name of names) {
      if (!this.state.definitions.has(name)) throw new Error(`Missing object store: ${name}`);
    }
    return new FakeTransaction(this.factory, this.state, names, mode);
  }

  close() {
    this.closed = true;
  }
}

export class FakeIndexedDbFactory {
  constructor() {
    this.databases = new Map();
    this.nextWriteFailure = null;
  }

  open(name, requestedVersion = 1) {
    const request = new FakeRequest();
    setTimeout(() => {
      let state = this.databases.get(name);
      if (!state) {
        state = {
          name,
          version: 0,
          definitions: new Map(),
          data: new Map()
        };
        this.databases.set(name, state);
      }
      if (requestedVersion < state.version) {
        request.error = new Error('VersionError');
        request.onerror?.({ target: request });
        return;
      }
      const oldVersion = state.version;
      const database = new FakeDatabase(this, state);
      request.result = database;
      if (requestedVersion > oldVersion) {
        const transaction = new FakeUpgradeTransaction(database);
        request.transaction = transaction;
        request.onupgradeneeded?.({
          oldVersion,
          newVersion: requestedVersion,
          target: request
        });
        if (transaction.aborted) {
          request.error = transaction.error;
          request.onerror?.({ target: request });
          return;
        }
        state.version = requestedVersion;
        database.version = requestedVersion;
      }
      request.onsuccess?.({ target: request });
    }, 0);
    return request;
  }

  failNextWrite(error = new Error('Injected write failure.')) {
    this.nextWriteFailure = error;
  }

  seedRecords(name, recordsByStore) {
    const state = this.databases.get(name);
    if (!state) throw new Error(`Database ${name} has not been initialized.`);
    for (const [storeName, records] of Object.entries(recordsByStore)) {
      const definition = state.definitions.get(storeName);
      if (!definition) throw new Error(`Missing object store: ${storeName}`);
      const values = new Map();
      for (const record of records) {
        const key = record?.[definition.keyPath];
        if (key === undefined || key === null) throw new Error(`Missing keyPath ${definition.keyPath}.`);
        values.set(key, clone(record));
      }
      state.data.set(storeName, values);
    }
  }

  inspect(name) {
    const state = this.databases.get(name);
    if (!state) return null;
    return {
      version: state.version,
      stores: [...state.definitions.keys()],
      records: Object.fromEntries([...state.data].map(([store, entries]) => [store, [...entries.values()].map(clone)]))
    };
  }
}
