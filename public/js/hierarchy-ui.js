import { commitGraphMutation } from './graph-mutations.js';
import { UNIVERSE_ROOT_NODE_TYPE } from './graph-schema.js';

const compareStableIds = (left, right) => String(left.id).localeCompare(String(right.id));

const summarizeNode = (node) => node
  ? Object.freeze({
      id: node.id,
      nodeType: node.nodeType,
      title: node.title,
      url: node.url ?? '',
      body: node.body ?? ''
    })
  : null;

export const createHierarchyViewModel = (store, nodeId) => {
  const node = nodeId ? store.getNode(nodeId) : null;
  if (!node || node.nodeType === UNIVERSE_ROOT_NODE_TYPE) {
    return Object.freeze({
      parent: null,
      children: Object.freeze([]),
      childCount: 0,
      canAddChild: false
    });
  }

  const children = store.listDirectChildren(node.id)
    .slice()
    .sort(compareStableIds)
    .map(summarizeNode);

  return Object.freeze({
    parent: summarizeNode(store.getParent(node.id)),
    children: Object.freeze(children),
    childCount: children.length,
    canAddChild: true
  });
};

export const createChildNodeInput = ({ nodeType, title, url = '', body = '' }) => {
  const common = {
    nodeType,
    title,
    provenance: {
      sourceType: 'user',
      sourceId: 'local-add-child',
      createdBy: 'local-user'
    }
  };
  return nodeType === 'note'
    ? { ...common, body }
    : { ...common, url };
};

export const commitChildHierarchyMutation = async ({
  store,
  repository = null,
  scene,
  parentId,
  input
}) => {
  const parent = store.getNode(parentId);
  if (!parent || parent.nodeType === UNIVERSE_ROOT_NODE_TYPE) {
    throw new Error('A non-root parent node is required.');
  }

  const cameraState = scene.captureCameraState();
  const view = scene.getView?.() ?? store.getPreferredLayout();

  return commitGraphMutation({
    store,
    repository,
    mutate: () => store.addChildWithHierarchy(parent.id, input),
    project: ({ node, rootEdge, parentEdge }) => {
      scene.addNodes([node]);
      scene.addEdges([rootEdge, parentEdge]);
      scene.restoreCameraState(cameraState, { immediate: true });
    },
    restore: (snapshot) => {
      scene.replaceGraph(snapshot.nodes, snapshot.edges);
      scene.setView?.(view, { resetCamera: false });
      scene.restoreCameraState(cameraState, { immediate: true });
    }
  });
};

export const selectHierarchyNode = ({
  store,
  scene,
  nodeId,
  onSelect,
  immediate = false
}) => {
  const node = nodeId ? store.getNode(nodeId) : null;
  if (!node || node.nodeType === UNIVERSE_ROOT_NODE_TYPE) return null;
  onSelect?.(node);
  scene.navigateToNode(node.id, { immediate });
  return node;
};
