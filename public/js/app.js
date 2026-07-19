import { readHealth } from './api-client.js';
import { GraphValidationError } from './graph-schema.js';
import { GraphStore } from './graph-store.js';
import { PraxScene } from './scene.js';

const store = new GraphStore();
const infoPanel = document.querySelector('#info-panel');
const modal = document.querySelector('#modal-backdrop');
const titleInput = document.querySelector('#link-title-input');
const urlInput = document.querySelector('#link-url-input');

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

const showValidationError = (error) => {
  const firstIssue = error instanceof GraphValidationError ? error.issues[0]?.message : null;
  alert(firstIssue ?? error.message ?? 'The node could not be added.');
};

const scene = new PraxScene(document.querySelector('#main-canvas'), (nodeId) => {
  showNode(nodeId ? store.getNode(nodeId) : null);
});
scene.init();
scene.addNodes(store.listNodes());

document.querySelector('#view-toggle-btn').addEventListener('click', (event) => {
  const view = scene.toggleView();
  event.currentTarget.textContent = `View: ${view[0].toUpperCase()}${view.slice(1)}`;
});

document.querySelector('#add-btn').addEventListener('click', () => modal.classList.add('visible'));
document.querySelectorAll('.modal-cancel-btn').forEach((button) => button.addEventListener('click', () => modal.classList.remove('visible')));

document.querySelector('#submit-link-btn').addEventListener('click', () => {
  try {
    const node = store.addLink(titleInput.value, urlInput.value);
    scene.addNodes([node]);
    titleInput.value = '';
    urlInput.value = '';
    modal.classList.remove('visible');
  } catch (error) {
    showValidationError(error);
  }
});

readHealth()
  .then((health) => {
    document.querySelector('#status-pill').textContent = health.ok ? `Worker ${health.version}` : 'Worker unavailable';
  })
  .catch(() => {
    document.querySelector('#status-pill').textContent = 'Static preview';
  });
