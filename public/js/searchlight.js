const SEARCHABLE_NODE_FIELDS = Object.freeze(['title', 'body', 'url', 'nodeType']);

export const normalizeSearchQuery = (value) => String(value ?? '')
  .normalize('NFKC')
  .trim()
  .toLocaleLowerCase();

export const getNodeSearchFields = (node) => Object.freeze([
  ...SEARCHABLE_NODE_FIELDS.map((field) => normalizeSearchQuery(node?.[field])),
  normalizeSearchQuery(node?.nodeType).replaceAll('_', ' ')
]);

export const searchNodesExact = (nodes, query) => {
  const normalizedQuery = normalizeSearchQuery(query);
  if (!normalizedQuery) return Object.freeze([]);
  return Object.freeze(nodes.filter((node) => (
    getNodeSearchFields(node).some((value) => value.includes(normalizedQuery))
  )));
};

export class SearchlightSession {
  constructor() {
    this.clear();
  }

  update(nodes, query) {
    const previousActiveNodeId = this.getActiveNodeId();
    const matches = searchNodesExact(nodes, query);
    this.query = normalizeSearchQuery(query);
    this.resultIds = matches.map(({ id }) => id);
    const preservedIndex = previousActiveNodeId ? this.resultIds.indexOf(previousActiveNodeId) : -1;
    this.currentIndex = preservedIndex >= 0 ? preservedIndex : (this.resultIds.length ? 0 : -1);
    return this.snapshot();
  }

  move(delta) {
    if (!this.resultIds.length) return this.snapshot();
    const step = Number.isFinite(delta) ? Math.trunc(delta) : 0;
    this.currentIndex = (this.currentIndex + step + this.resultIds.length) % this.resultIds.length;
    return this.snapshot();
  }

  select(nodeId) {
    const index = this.resultIds.indexOf(nodeId);
    if (index < 0) return false;
    this.currentIndex = index;
    return true;
  }

  getActiveNodeId() {
    return this.currentIndex >= 0 ? this.resultIds[this.currentIndex] ?? null : null;
  }

  clear() {
    this.query = '';
    this.resultIds = [];
    this.currentIndex = -1;
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      query: this.query,
      resultIds: Object.freeze([...this.resultIds]),
      currentIndex: this.currentIndex,
      total: this.resultIds.length,
      activeNodeId: this.getActiveNodeId()
    });
  }
}
