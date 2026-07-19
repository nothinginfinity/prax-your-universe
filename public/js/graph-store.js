const seedNodes = [
  { id: 'welcome', type: 'link', title: 'Welcome to Prax!', url: '#' },
  { id: 'add-first-link', type: 'link', title: 'Add your first link', url: '#' },
  { id: 'toggle-view', type: 'link', title: 'Toggle View', url: '#' }
];

export class GraphStore {
  constructor(nodes = seedNodes) {
    this.nodes = new Map(nodes.map((node) => [node.id, Object.freeze({ ...node })]));
  }

  listNodes() {
    return [...this.nodes.values()];
  }

  addLink(title, url) {
    const id = crypto.randomUUID();
    const node = Object.freeze({ id, type: 'link', title, url });
    this.nodes.set(id, node);
    return node;
  }
}
