import { readHealth } from './api-client.js';
import { commitGraphMutation } from './graph-mutations.js';
import { GraphValidationError, UNIVERSE_ROOT_NODE_TYPE } from './graph-schema.js';
import { GraphStore, createSeedSnapshot, upgradeGraphSnapshot } from './graph-store.js';
import { IndexedDbRepositoryError, PraxIndexedDbRepository } from './indexeddb-repository.js';
import { PraxScene, getNodeVisualMetadata } from './scene.js';

const infoPanel = document.querySelector('#info-panel');
const infoTitle = document.querySelector('#info-title');
const infoType = document.querySelector('#info-type');
const infoDetails = document.querySelector('#info-details');
const infoBody = document.querySelector('#info-body');
const infoLink = document.querySelector('#info-link');
const infoActions = document.querySelector('#info-actions');
const editNodeButton = document.querySelector('#edit-node-btn');
const deleteNodeButton = document.querySelector('#delete-node-btn');
const modal = document.querySelector('#modal-backdrop');
const modalTitle = document.querySelector('#modal-title');
const nodeTypeInput = document.querySelector('#node-type-input');
const titleInput = document.querySelector('#node-title-input');
const urlInput = document.querySelector('#node-url-input');
const bodyInput = document.querySelector('#node-body-input');
const urlField = document.querySelector('#node-url-field');
const bodyField = document.querySelector('#node-body-field');
const statusPill = document.querySelector('#status-pill');
const viewToggleButton = document.querySelector('#view-toggle-btn');
const submitNodeButton = document.querySelector('#submit-node-btn');

let repository = null;
let persistenceLabel = 'Memory only';
let workerLabel = 'Worker checking';
let selectedNodeId = null;
let editingNodeId = null;
let modalMode = 'create';

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
  selectedNodeId = node?.id ?? null;
  infoPanel.classList.toggle('visible', Boolean(node));
  if (!node) return;
  const visual = getNodeVisualMetadata(node.nodeType);
  const editable = node.nodeType !== UNIVERSE_ROOT_NODE_TYPE;
  infoTitle.textContent = node.title;
  infoType.textContent = visual.label;
  infoType.dataset.nodeType = node.nodeType;
  infoDetails.textContent = node.nodeType === 'link' ? node.url : `Local ${visual.label.toLowerCase()} node`;
  infoBody.textContent = node.body ?? '';
  infoBody.hidden = !node.body;
  const visitable = node.nodeType === 'link' && Boolean(node.url);
  infoLink.hidden = !visitable;
  if (visitable) infoLink.href = node.url;
  infoActions.hidden = !editable;
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
    selectedNodeId,
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
    nodes: snapshot.nodes.map(({ id, universeId, nodeType, title, body, url, createdAt, updatedAt }) => ({
      id,
      universeId,
      nodeType,
      title,
      body,
      url,
      createdAt,
      updatedAt
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
    renderedNodes: [...scene.meshByNodeId].map(([nodeId, mesh]) => ({
      nodeId,
      nodeType: mesh.userData.nodeType,
      title: mesh.userData.nodeTitle,
      visualKey: mesh.userData.visualKey,
      visualLabel: mesh.userData.visualLabel
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

const testMilestone = new URLSearchParams(location.search).get('puxTest');
if (['003', '004'].includes(testMilestone)) {
  Object.defineProperty(globalThis, '__PRAX_TEST__', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      getState: getPuxVerificationState,
      selectNode: (nodeId) => {
        const node = store.getNode(nodeId);
        showNode(node);
        return Boolean(node);
      }
    })
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

const syncNodeTypeFields = () => {
  const nodeType = nodeTypeInput.value;
  urlField.hidden = nodeType !== 'link';
  bodyField.hidden = nodeType !== 'note';
};

const closeModal = () => {
  modal.classList.remove('visible');
  editingNodeId = null;
  modalMode = 'create';
};

const openCreateModal = () => {
  modalMode = 'create';
  editingNodeId = null;
  modalTitle.textContent = 'Add a new node';
  submitNodeButton.textContent = 'Add Node';
  nodeTypeInput.disabled = false;
  nodeTypeInput.value = 'link';
  titleInput.value = '';
  urlInput.value = '';
  bodyInput.value = '';
  syncNodeTypeFields();
  modal.classList.add('visible');
  titleInput.focus();
};

const openEditModal = (node) => {
  if (!node || node.nodeType === UNIVERSE_ROOT_NODE_TYPE) return;
  modalMode = 'edit';
  editingNodeId = node.id;
  modalTitle.textContent = `Edit ${getNodeVisualMetadata(node.nodeType).label}`;
  submitNodeButton.textContent = 'Save Changes';
  nodeTypeInput.value = node.nodeType;
  nodeTypeInput.disabled = true;
  titleInput.value = node.title;
  urlInput.value = node.url ?? '';
  bodyInput.value = node.body ?? '';
  syncNodeTypeFields();
  modal.classList.add('visible');
  titleInput.focus();
};

document.querySelector('#add-btn').addEventListener('click', openCreateModal);
document.querySelectorAll('.modal-cancel-btn').forEach((button) => button.addEventListener('click', closeModal));
nodeTypeInput.addEventListener('change', syncNodeTypeFields);

submitNodeButton.addEventListener('click', async () => {
  submitNodeButton.disabled = true;
  try {
    if (modalMode === 'edit') {
      const node = store.getNode(editingNodeId);
      if (!node) throw new Error('The selected node no longer exists.');
      const changes = node.nodeType === 'link'
        ? { title: titleInput.value, url: urlInput.value }
        : { title: titleInput.value, body: bodyInput.value };
      const updated = await commitGraphMutation({
        store,
        repository,
        mutate: () => store.updateNode(node.id, changes),
        project: (record) => scene.updateNode(record)
      });
      showNode(updated);
    } else {
      const result = await commitGraphMutation({
        store,
        repository,
        mutate: () => nodeTypeInput.value === 'note'
          ? store.addNoteWithDefaultEdge(titleInput.value, bodyInput.value)
          : store.addLinkWithDefaultEdge(titleInput.value, urlInput.value),
        project: ({ node, edge }) => {
          scene.addNodes([node]);
          scene.addEdges([edge]);
        }
      });
      showNode(result.node);
    }
    closeModal();
  } catch (error) {
    showMutationError(error);
  } finally {
    submitNodeButton.disabled = false;
  }
});

editNodeButton.addEventListener('click', () => openEditModal(store.getNode(selectedNodeId)));

deleteNodeButton.addEventListener('click', async () => {
  const node = store.getNode(selectedNodeId);
  if (!node || node.nodeType === UNIVERSE_ROOT_NODE_TYPE) return;
  if (!confirm(`Delete “${node.title}” and all of its connected edges?`)) return;
  deleteNodeButton.disabled = true;
  try {
    await commitGraphMutation({
      store,
      repository,
      mutate: () => store.deleteNode(node.id),
      project: ({ node: deleted }) => {
        scene.removeNode(deleted.id);
        showNode(null);
      }
    });
  } catch (error) {
    showMutationError(error);
  } finally {
    deleteNodeButton.disabled = false;
  }
});

addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && modal.classList.contains('visible')) closeModal();
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
