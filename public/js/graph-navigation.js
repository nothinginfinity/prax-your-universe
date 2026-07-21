import { cloneCameraState } from './camera-navigation.js';

export const getExplicitNeighborhoodNodeIds = (nodeId, edges) => {
  if (!nodeId) return Object.freeze([]);
  const nodeIds = new Set([nodeId]);
  for (const edge of edges) {
    if (edge.fromNodeId === nodeId) nodeIds.add(edge.toNodeId);
    if (edge.toNodeId === nodeId) nodeIds.add(edge.fromNodeId);
  }
  return Object.freeze([...nodeIds]);
};

export const createNavigationSnapshot = ({ cameraState, selectedNodeId = null, projection }) => {
  if (!projection) throw new Error('A navigation snapshot requires a projection.');
  return Object.freeze({
    cameraState: cloneCameraState(cameraState),
    selectedNodeId: selectedNodeId ?? null,
    projection
  });
};
