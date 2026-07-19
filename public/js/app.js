import { readHealth } from './api-client.js';
import { commitGraphMutation } from './graph-mutations.js';
import { GraphValidationError, UNIVERSE_ROOT_NODE_TYPE } from './graph-schema.js';
import { GraphStore, createSeedSnapshot, upgradeGraphSnapshot } from './graph-store.js';
import { IndexedDbRepositoryError, PraxIndexedDbRepository } from './indexeddb-repository.js';
import { PraxScene } from './scene.js';

const infoPanel = document.querySelector('#info-panel');
const modal = document.querySelector('#modal-backdrop');
const titleInput = document.querySelector('#link-title-input');
const urlInput = document.querySelector('#link-url-input');
const statusPill = document.querySelector('#status-pill');
const viewToggleButton = document.querySelector('#view-toggle-btn');
const submitLinkButton = document.querySelector('#submit-link-btn');

let repository = null;
let persistenceLabel = 'Memory only';
let workerLabel = 'Worker checking';

const renderStatus = () => {
  statusPill.textContent = `${workerLabel} · ${persistenceLabel}`;
};

const initializeStore = async () => {
  const seedSnapshot = createSeedSnapshot();
  let loadedSnapshot = seedSnapshot;
  try {
    repository = new PraxIndexedDbRepository();
    loadedSnapshot = await repository.loadOrCreate(seedSnapshot);
    const upgrade = upgradeGraphSnapshot(loadedSnapshot);
    if (upgrade.changed) await repository.saveSnapshot(upgrade.snapshot);
    persistenceLabel = 'Local saved';
    return new GraphStore(upgrade.snapshot);
  } catch (error) {
    console.error('Prax local persistence is unavailable.', error);
    repository?.close();
    repository = null;
    persistenceLabel = 'Memory only';
    return new GraphStore(loadedSnapshot);
  } finally {
    renderStatus();
  }
};

const store = await initializeStore();

const showNode = (node) => {
  infoPanel.classList.toggle('visible', Boolean(node));
  if (!node) return;
  document.querySelector('#info-title').textContent = node.title;
  document.querySelector('#info-details').textContent = node.url ?? node.nodeType;
  const link = document.querySelector('#info-link');
  const visitable = node.nodeType === 'link' && Boolean(node.url);
  link.hidden = !visitable;
  if (visitable) link.href = node.url;
};

const showMutationError = (error) => {
  const firstIssue = error instanceof GraphValidationError ? error.issues[0]?.message : null;
  const persistenceMessage = error instanceof IndexedDbRepositoryError
    ? 'The change was not saved. Your previous local graph is still intact.'
    : null;
  alert(firstIssue ?? persistenceMessage ?? error.message ?? 'The graph could not be updated.');
};

const scene = new PraxScene(document.querySelector('#main-canvas'), (nodeId) => {
  showNode(nodeId ? store.getNode(nodeId) : null);
});
scene.init();
scene.setView(store.getPreferredLayout());
scene.replaceGraph(store.listNodes(), store.listEdges());

const getPuxVerificationState = () => {
  const snapshot = store.snapshot();
  return {
    workerLabel,
    persistenceLabel,
    currentView: scene.getView(),
    viewport: {
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight
    },
    roots: snapshot.nodes
      .filter(({ nodeType }) => nodeType === UNIVERSE_ROOT_NODE_TYPE)
      .map(({ id, universeId }) => ({ id, universeId })),
    nodes: snapshot.nodes.map(({ id, universeId, nodeType, title, url }) => ({
      id,
      universeId,
      nodeType,
      title,
      url
    })),
    edges: snapshot.edges.map(({ id, universeId, edgeType, fromNodeId, toNodeId }) => ({
      id,
      universeId,
      edgeType,
      fromNodeId,
      toNodeId
    })),
    nodePositions: [...scene.meshByNodeId].map(([nodeId, mesh]) => ({
      nodeId,
      position: [mesh.position.x, mesh.position.y, mesh.position.z]
    })),
    renderedEdges: [...scene.edgeObjectById].map(([edgeId, line]) => ({
      edgeId,
      edgeClass: line.userData.edgeClass,
      fromNodeId: line.userData.fromNodeId,
      toNodeId: line.userData.toNodeId,
      segment: [...line.geometry.getAttribute('position').array]
    }))
  };
};

if (new URLSearchParams(location.search).get('puxTest') === '003') {
  Object.defineProperty(globalThis, '__PRAX_TEST__', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({ getState: getPuxVerificationState })
  });
}

const updateViewButton = () => {
  const view = scene.getView();
  viewToggleButton.textContent = `View: ${view[0].toUpperCase()}${view.slice(1)}`;
};
updateViewButton();

viewToggleButton.addEventListener('click', async () => {
  const nextView = scene.getView() === 'sphere' ? 'grid' : 'sphere';
  viewToggleButton.disabled = true;
  try {
    await commitGraphMutation({
      store,
      repository,
      mutate: () => store.setPreferredLayout(nextView),
      project: () => scene.setView(nextView)
    });
    updateViewButton();
  } catch (error) {
    showMutationError(error);
  } finally {
    viewToggleButton.disabled = false;
  }
});

document.querySelector('#add-btn').addEventListener('click', () => modal.classList.add('visible'));
document.querySelectorAll('.modal-cancel-btn').forEach((button) => button.addEventListener('click', () => modal.classList.remove('visible')));

submitLinkButton.addEventListener('click', async () => {
  submitLinkButton.disabled = true;
  try {
    await commitGraphMutation({
      store,
      repository,
      mutate: () => store.addLinkWithDefaultEdge(titleInput.value, urlInput.value),
      project: ({ node, edge }) => {
        scene.addNodes([node]);
        scene.addEdges([edge]);
      }
    });
    titleInput.value = '';
    urlInput.value = '';
    modal.classList.remove('visible');
  } catch (error) {
    showMutationError(error);
  } finally {
    submitLinkButton.disabled = false;
  }
});

addEventListener('beforeunload', () => repository?.close());

readHealth()
  .then((health) => {
    workerLabel = health.ok ? `Worker ${health.version}` : 'Worker unavailable';
    renderStatus();
  })
  .catch(() => {
    workerLabel = 'Static preview';
    renderStatus();
  });
