import { readHealth } from './api-client.js';
import { GraphValidationError } from './graph-schema.js';
import { GraphStore, createSeedSnapshot } from './graph-store.js';
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
  try {
    repository = new PraxIndexedDbRepository();
    const snapshot = await repository.loadOrCreate(seedSnapshot);
    persistenceLabel = 'Local saved';
    return new GraphStore(snapshot);
  } catch (error) {
    console.error('Prax local persistence is unavailable.', error);
    repository?.close();
    repository = null;
    persistenceLabel = 'Memory only';
    return new GraphStore(seedSnapshot);
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

const commitMutation = async (mutate, project) => {
  const previousSnapshot = store.snapshot();
  try {
    const result = mutate();
    if (repository) await repository.saveSnapshot(store.snapshot());
    project?.(result);
    return result;
  } catch (error) {
    store.replaceSnapshot(previousSnapshot);
    throw error;
  }
};

const scene = new PraxScene(document.querySelector('#main-canvas'), (nodeId) => {
  showNode(nodeId ? store.getNode(nodeId) : null);
});
scene.init();
scene.setView(store.getPreferredLayout());
scene.addNodes(store.listNodes());

const updateViewButton = () => {
  const view = scene.getView();
  viewToggleButton.textContent = `View: ${view[0].toUpperCase()}${view.slice(1)}`;
};
updateViewButton();

viewToggleButton.addEventListener('click', async () => {
  const nextView = scene.getView() === 'sphere' ? 'grid' : 'sphere';
  viewToggleButton.disabled = true;
  try {
    await commitMutation(
      () => store.setPreferredLayout(nextView),
      () => scene.setView(nextView)
    );
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
    await commitMutation(
      () => store.addLink(titleInput.value, urlInput.value),
      (node) => scene.addNodes([node])
    );
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
