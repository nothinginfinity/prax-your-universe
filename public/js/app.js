import { readHealth } from './api-client.js';
import { commitGraphMutation, commitGraphReplacement } from './graph-mutations.js';
import { GraphValidationError, UNIVERSE_ROOT_NODE_TYPE } from './graph-schema.js';
import { GraphStore, createSeedSnapshot, upgradeGraphSnapshot } from './graph-store.js';
import { IndexedDbRepositoryError, PraxIndexedDbRepository } from './indexeddb-repository.js';
import {
  PRAX_IMPORT_MAX_BYTES,
  PraxBundleError,
  createPraxExport,
  parsePraxBundleText
} from './prax-bundle.js';
import { createNavigationSnapshot, getExplicitNeighborhoodNodeIds } from './graph-navigation.js';
import { GalaxyPraxScene as PraxScene } from './galaxy-scene.js';
import { GalaxyFocusController } from './galaxy-focus-controller.js';
import { getNodeVisualMetadata } from './scene.js';
import { SearchlightSession } from './searchlight.js';

const APP_VERSION = '0.2.0-pux.8';

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
const transferStatus = document.querySelector('#transfer-status');
const viewToggleButton = document.querySelector('#view-toggle-btn');
const focusButton = document.querySelector('#focus-btn');
const backButton = document.querySelector('#back-btn');
const galaxyResetButton = document.querySelector('#galaxy-reset-btn');
const galaxyFocusStatus = document.querySelector('#galaxy-focus-status');
const submitNodeButton = document.querySelector('#submit-node-btn');
const exportButton = document.querySelector('#export-btn');
const importButton = document.querySelector('#import-btn');
const importFileInput = document.querySelector('#import-file-input');
const importModal = document.querySelector('#import-modal-backdrop');
const importFilename = document.querySelector('#import-filename');
const importUniverseName = document.querySelector('#import-universe-name');
const importCounts = document.querySelector('#import-counts');
const importNormalization = document.querySelector('#import-normalization');
const importPersistenceWarning = document.querySelector('#import-persistence-warning');
const confirmImportButton = document.querySelector('#confirm-import-btn');
const cancelImportButton = document.querySelector('#cancel-import-btn');
const searchlightPanel = document.querySelector('#searchlight');
const searchlightForm = document.querySelector('#searchlight-form');
const searchlightInput = document.querySelector('#searchlight-input');
const searchlightResults = document.querySelector('#searchlight-results');
const searchlightCount = document.querySelector('#searchlight-count');
const searchlightStatus = document.querySelector('#searchlight-status');
const previousSearchResultButton = document.querySelector('#searchlight-previous-btn');
const nextSearchResultButton = document.querySelector('#searchlight-next-btn');
const closeSearchlightButton = document.querySelector('#searchlight-close-btn');
const resetViewButton = document.querySelector('#reset-view-btn');

let repository = null;
let persistenceLabel = 'Memory only';
let workerLabel = 'Worker checking';
let selectedNodeId = null;
let editingNodeId = null;
let modalMode = 'create';
let pendingImport = null;
let transferMessage = 'Import/export ready';
let galaxyFocusController = null;
const searchlightSession = new SearchlightSession();
let searchNavigationSnapshot = null;
const reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');

const renderStatus = () => {
  statusPill.textContent = `${workerLabel} · ${persistenceLabel}`;
  transferStatus.textContent = transferMessage;
};

const setTransferStatus = (message) => {
  transferMessage = message;
  renderStatus();
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
  infoPanel.setAttribute('aria-hidden', String(!node));
  galaxyFocusController?.setSelectedNodeId(selectedNodeId);
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
  const graphIssue = error instanceof GraphValidationError ? error.issues[0]?.message : null;
  const bundleMessage = error instanceof PraxBundleError ? error.message : null;
  const persistenceMessage = error instanceof IndexedDbRepositoryError
    ? 'The change was not saved. Your previous local graph is still intact.'
    : null;
  alert(graphIssue ?? bundleMessage ?? persistenceMessage ?? error.message ?? 'The graph could not be updated.');
};

const scene = new PraxScene(document.querySelector('#main-canvas'), (nodeId) => handleSceneSelection(nodeId));
scene.init();
scene.setView(store.getPreferredLayout());
scene.replaceGraph(store.listNodes(), store.listEdges());

const prefersReducedMotion = () => reducedMotionQuery.matches;

function isSearchlightActive() {
  return Boolean(searchlightSession.snapshot().query);
}

function updateSearchlightUi() {
  const state = searchlightSession.snapshot();
  const active = Boolean(state.query);
  searchlightPanel.classList.toggle('active', active);
  searchlightResults.hidden = !active;
  searchlightCount.textContent = active ? `${state.total ? state.currentIndex + 1 : 0} of ${state.total}` : '';
  previousSearchResultButton.disabled = state.total < 2;
  nextSearchResultButton.disabled = state.total < 2;
  searchlightStatus.textContent = !active
    ? 'Exact local search - Press / to focus'
    : (state.total ? `Exact match ${state.currentIndex + 1} of ${state.total}` : 'No exact local matches');
}

function captureSearchNavigationState() {
  if (searchNavigationSnapshot) return searchNavigationSnapshot;
  searchNavigationSnapshot = createNavigationSnapshot({
    cameraState: scene.captureCameraState(),
    selectedNodeId,
    projection: scene.getView()
  });
  return searchNavigationSnapshot;
}

function selectActiveSearchResult({ navigate = true } = {}) {
  const state = searchlightSession.snapshot();
  const node = state.activeNodeId ? store.getNode(state.activeNodeId) : null;
  if (!node) {
    showNode(null);
    scene.setSearchEmphasis({ matchedNodeIds: state.resultIds });
    updateSearchlightUi();
    return null;
  }
  const neighborhoodNodeIds = getExplicitNeighborhoodNodeIds(node.id, store.listEdges());
  showNode(node);
  scene.setSearchEmphasis({
    matchedNodeIds: state.resultIds,
    activeNodeId: node.id,
    neighborhoodNodeIds
  });
  if (navigate) scene.navigateToNode(node.id, { immediate: prefersReducedMotion() });
  updateSearchlightUi();
  return node;
}

function runSearchlight(query = searchlightInput.value) {
  if (scene.isGalaxyFocusActive()) galaxyFocusController.exit();
  const nextQuery = String(query ?? '');
  searchlightInput.value = nextQuery;
  if (!nextQuery.trim()) {
    dismissSearchlight({ restore: true, clearInput: false });
    return searchlightSession.snapshot();
  }
  captureSearchNavigationState();
  searchlightSession.update(store.listNodes(), nextQuery);
  selectActiveSearchResult();
  return searchlightSession.snapshot();
}

function dismissSearchlight({ restore = true, clearInput = true } = {}) {
  const previousState = searchNavigationSnapshot;
  searchNavigationSnapshot = null;
  searchlightSession.clear();
  if (clearInput) searchlightInput.value = '';
  scene.clearSearchEmphasis();
  updateSearchlightUi();
  if (restore && previousState) {
    if (scene.getView() !== previousState.projection) {
      scene.setView(previousState.projection, { resetCamera: false });
    }
    scene.restoreCameraState(previousState.cameraState, { immediate: prefersReducedMotion() });
    showNode(previousState.selectedNodeId ? store.getNode(previousState.selectedNodeId) : null);
    updateViewButton();
  }
  return previousState;
}

function resetSearchlightView() {
  if (scene.isGalaxyFocusActive()) galaxyFocusController.exit();
  searchNavigationSnapshot = null;
  searchlightSession.clear();
  searchlightInput.value = '';
  scene.clearSearchEmphasis();
  showNode(null);
  scene.resetCamera({ immediate: prefersReducedMotion() });
  updateSearchlightUi();
}

galaxyFocusController = new GalaxyFocusController({
  scene,
  focusButton,
  backButton,
  statusElement: galaxyFocusStatus,
  dismissSearchlight: () => {
    if (isSearchlightActive()) dismissSearchlight({ restore: false });
  },
  prefersReducedMotion,
  onStateChange: (state) => {
    document.body.dataset.galaxyFocus = state.state;
    viewToggleButton.disabled = state.active;
  }
});
galaxyFocusController.setSelectedNodeId(selectedNodeId);

function handleSceneSelection(nodeId) {
  if (scene.isGalaxyFocusActive() && nodeId !== scene.getGalaxyFocusState().focusedNodeId) {
    galaxyFocusController.exit();
  }
  if (isSearchlightActive()) {
    if (nodeId && searchlightSession.select(nodeId)) {
      selectActiveSearchResult();
      return;
    }
    dismissSearchlight({ restore: false });
  }
  showNode(nodeId ? store.getNode(nodeId) : null);
}

const projectSnapshot = (snapshot) => {
  if (scene.isGalaxyFocusActive()) galaxyFocusController.exit();
  scene.replaceGraph(snapshot.nodes, snapshot.edges);
  scene.setView(store.getPreferredLayout());
};

const getPuxVerificationState = () => {
  const snapshot = store.snapshot();
  return {
    applicationVersion: APP_VERSION,
    workerLabel,
    persistenceLabel,
    transferMessage,
    selectedNodeId,
    currentView: scene.getView(),
    cameraState: scene.captureCameraState(),
    searchlight: searchlightSession.snapshot(),
    searchNavigationSnapshot,
    galaxyFocus: scene.getGalaxyFocusState(),
    emphasis: scene.getEmphasisState(),
    reducedMotion: prefersReducedMotion(),
    importModalVisible: importModal.classList.contains('visible'),
    pendingImportSummary: pendingImport?.summary ?? null,
    viewport: {
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight
    },
    roots: snapshot.nodes
      .filter(({ nodeType }) => nodeType === UNIVERSE_ROOT_NODE_TYPE)
      .map(({ id, universeId }) => ({ id, universeId })),
    universes: snapshot.universes.map(({ id, name, originId, provenance }) => ({ id, name, originId, provenance })),
    nodes: snapshot.nodes.map(({ id, originId, universeId, nodeType, title, body, url, createdAt, updatedAt, provenance }) => ({
      id,
      originId,
      universeId,
      nodeType,
      title,
      body,
      url,
      createdAt,
      updatedAt,
      provenance
    })),
    edges: snapshot.edges.map(({ id, originId, universeId, edgeType, fromNodeId, toNodeId, provenance }) => ({
      id,
      originId,
      universeId,
      edgeType,
      fromNodeId,
      toNodeId,
      provenance
    })),
    layouts: snapshot.layouts,
    layoutNodes: snapshot.layoutNodes,
    settings: snapshot.settings,
    nodePositions: [...scene.meshByNodeId].map(([nodeId, mesh]) => ({
      nodeId,
      position: [mesh.position.x, mesh.position.y, mesh.position.z]
    })),
    renderedNodes: [...scene.meshByNodeId].map(([nodeId, mesh]) => ({
      nodeId,
      nodeType: mesh.userData.nodeType,
      title: mesh.userData.nodeTitle,
      visualKey: mesh.userData.visualKey,
      visualLabel: mesh.userData.visualLabel,
      opacity: mesh.material.opacity,
      scale: mesh.scale.x
    })),
    renderedEdges: [...scene.edgeObjectById].map(([edgeId, line]) => ({
      edgeId,
      edgeClass: line.userData.edgeClass,
      fromNodeId: line.userData.fromNodeId,
      toNodeId: line.userData.toNodeId,
      opacity: line.material.opacity,
      segment: [...line.geometry.getAttribute('position').array]
    }))
  };
};

const closeModal = () => {
  modal.classList.remove('visible');
  editingNodeId = null;
  modalMode = 'create';
};

const updateViewButton = () => {
  const view = scene.getView();
  viewToggleButton.textContent = `View: ${view[0].toUpperCase()}${view.slice(1)}`;
};

const replaceUniverse = async (snapshot) => {
  if (scene.isGalaxyFocusActive()) galaxyFocusController.exit();
  dismissSearchlight({ restore: false });
  const committed = await commitGraphReplacement({
    store,
    repository,
    snapshot,
    project: projectSnapshot
  });
  showNode(null);
  closeModal();
  updateViewButton();
  return committed;
};

const testMilestone = new URLSearchParams(location.search).get('puxTest');
if (['003', '004', '005', '006', '007', '008'].includes(testMilestone)) {
  Object.defineProperty(globalThis, '__PRAX_TEST__', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      getState: getPuxVerificationState,
      selectNode: (nodeId) => {
        const node = store.getNode(nodeId);
        handleSceneSelection(node?.id ?? null);
        return Boolean(node);
      },
      focusNode: (nodeId = selectedNodeId) => galaxyFocusController.enter(nodeId),
      backFromFocus: () => galaxyFocusController.exit(),
      search: (query) => runSearchlight(query),
      nextSearchResult: () => {
        searchlightSession.move(1);
        selectActiveSearchResult();
        return searchlightSession.snapshot();
      },
      previousSearchResult: () => {
        searchlightSession.move(-1);
        selectActiveSearchResult();
        return searchlightSession.snapshot();
      },
      dismissSearch: () => dismissSearchlight({ restore: true }),
      resetView: () => resetSearchlightView(),
      createExport: (options = {}) => createPraxExport(store.snapshot(), {
        applicationVersion: APP_VERSION,
        ...options
      }),
      parseImport: (text, options = {}) => parsePraxBundleText(text, {
        applicationVersion: APP_VERSION,
        ...options
      }),
      replaceFromText: async (text, options = {}) => {
        const parsed = parsePraxBundleText(text, {
          applicationVersion: APP_VERSION,
          ...options
        });
        await replaceUniverse(parsed.snapshot);
        return parsed.summary;
      }
    })
  });
}

updateViewButton();
updateSearchlightUi();

searchlightForm.addEventListener('submit', (event) => {
  event.preventDefault();
  runSearchlight();
});
searchlightInput.addEventListener('input', () => runSearchlight());
previousSearchResultButton.addEventListener('click', () => {
  searchlightSession.move(-1);
  selectActiveSearchResult();
});
nextSearchResultButton.addEventListener('click', () => {
  searchlightSession.move(1);
  selectActiveSearchResult();
});
closeSearchlightButton.addEventListener('click', () => dismissSearchlight({ restore: true }));
resetViewButton.addEventListener('click', resetSearchlightView);
galaxyResetButton.addEventListener('click', resetSearchlightView);
searchlightInput.addEventListener('keydown', (event) => {
  if (!isSearchlightActive()) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
    event.preventDefault();
    searchlightSession.move(1);
    selectActiveSearchResult();
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
    event.preventDefault();
    searchlightSession.move(-1);
    selectActiveSearchResult();
  }
});

viewToggleButton.addEventListener('click', async () => {
  if (scene.isGalaxyFocusActive()) galaxyFocusController.exit();
  if (isSearchlightActive()) dismissSearchlight({ restore: true });
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

const openCreateModal = () => {
  if (scene.isGalaxyFocusActive()) galaxyFocusController.exit();
  if (isSearchlightActive()) dismissSearchlight({ restore: true });
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
  if (scene.isGalaxyFocusActive()) galaxyFocusController.exit();
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

editNodeButton.addEventListener('click', () => {
  if (isSearchlightActive()) dismissSearchlight({ restore: false });
  openEditModal(store.getNode(selectedNodeId));
});

deleteNodeButton.addEventListener('click', async () => {
  const node = store.getNode(selectedNodeId);
  if (!node || node.nodeType === UNIVERSE_ROOT_NODE_TYPE) return;
  if (!confirm(`Delete “${node.title}” and all of its connected edges?`)) return;
  if (scene.isGalaxyFocusActive()) galaxyFocusController.exit();
  if (isSearchlightActive()) dismissSearchlight({ restore: false });
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

const triggerDownload = ({ json, filename, mimeType }) => {
  const blob = new Blob([json], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
};

exportButton.addEventListener('click', () => {
  exportButton.disabled = true;
  try {
    const result = createPraxExport(store.snapshot(), { applicationVersion: APP_VERSION });
    triggerDownload(result);
    setTransferStatus(`Exported ${result.bundle.graph.nodes.length} nodes`);
  } catch (error) {
    setTransferStatus('Export failed');
    showMutationError(error);
  } finally {
    exportButton.disabled = false;
  }
});

const closeImportModal = ({ resetFile = true } = {}) => {
  importModal.classList.remove('visible');
  pendingImport = null;
  confirmImportButton.disabled = false;
  if (resetFile) importFileInput.value = '';
};

const openImportSummary = (parsed, filename) => {
  pendingImport = parsed;
  const { summary } = parsed;
  importFilename.textContent = filename;
  importUniverseName.textContent = summary.universeName;
  importCounts.textContent = `${summary.nodeCount} nodes · ${summary.edgeCount} edges · ${summary.layoutCount} layouts`;
  const additions = [];
  if (summary.addedRootCount) additions.push(`${summary.addedRootCount} canonical root`);
  if (summary.addedDefaultEdgeCount) additions.push(`${summary.addedDefaultEdgeCount} default edges`);
  importNormalization.textContent = additions.length
    ? `Legacy normalization will add ${additions.join(' and ')}.`
    : 'No topology repair is required.';
  importPersistenceWarning.hidden = Boolean(repository);
  importModal.classList.add('visible');
  confirmImportButton.focus();
};

importButton.addEventListener('click', () => {
  if (scene.isGalaxyFocusActive()) galaxyFocusController.exit();
  if (isSearchlightActive()) dismissSearchlight({ restore: true });
  importFileInput.click();
});

importFileInput.addEventListener('change', async () => {
  const file = importFileInput.files?.[0];
  if (!file) return;
  importButton.disabled = true;
  setTransferStatus('Validating import…');
  try {
    if (file.size > PRAX_IMPORT_MAX_BYTES) {
      throw new PraxBundleError(`Import exceeds the ${PRAX_IMPORT_MAX_BYTES}-byte limit.`, {
        code: 'file_too_large',
        path: 'file'
      });
    }
    const parsed = parsePraxBundleText(await file.text(), {
      filename: file.name,
      applicationVersion: APP_VERSION
    });
    openImportSummary(parsed, file.name);
    setTransferStatus('Import validated');
  } catch (error) {
    importFileInput.value = '';
    setTransferStatus('Import rejected');
    showMutationError(error);
  } finally {
    importButton.disabled = false;
  }
});

cancelImportButton.addEventListener('click', () => {
  closeImportModal();
  setTransferStatus('Import cancelled');
});

confirmImportButton.addEventListener('click', async () => {
  if (!pendingImport) return;
  const candidate = pendingImport;
  confirmImportButton.disabled = true;
  cancelImportButton.disabled = true;
  setTransferStatus('Replacing universe…');
  try {
    await replaceUniverse(candidate.snapshot);
    closeImportModal();
    setTransferStatus(`Imported ${candidate.summary.nodeCount} nodes`);
  } catch (error) {
    setTransferStatus('Import rolled back');
    showMutationError(error);
  } finally {
    confirmImportButton.disabled = false;
    cancelImportButton.disabled = false;
  }
});

addEventListener('keydown', (event) => {
  const target = event.target;
  const editingText = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
  if (event.key === '/' && !editingText && !modal.classList.contains('visible') && !importModal.classList.contains('visible') && !scene.isGalaxyFocusActive()) {
    event.preventDefault();
    searchlightInput.focus();
    searchlightInput.select();
    return;
  }
  if (event.key !== 'Escape') return;
  if (importModal.classList.contains('visible')) {
    closeImportModal();
    setTransferStatus('Import cancelled');
  } else if (modal.classList.contains('visible')) {
    closeModal();
  } else if (galaxyFocusController.handleEscape()) {
    event.preventDefault();
  } else if (isSearchlightActive()) {
    dismissSearchlight({ restore: true });
  } else if (selectedNodeId) {
    showNode(null);
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
