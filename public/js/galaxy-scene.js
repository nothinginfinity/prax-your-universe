import { cloneCameraState } from './camera-navigation.js';
import { GalaxyFocusSession, calculateGalaxyFocusPositions, captureNodePositionSnapshot, positionSnapshotsEqual } from './galaxy-focus.js';
import { PraxScene, getNodeVisualMetadata } from './scene.js';

const cloneRecords = (records = []) => records.map((record) => ({ ...record }));
const cloneEmphasis = (emphasis = {}) => ({
  matchedNodeIds: [...(emphasis.matchedNodeIds ?? [])],
  neighborhoodNodeIds: [...(emphasis.neighborhoodNodeIds ?? [])],
  activeNodeId: emphasis.activeNodeId ?? null
});

export class GalaxyPraxScene extends PraxScene {
  constructor(...args) {
    super(...args);
    this.galaxyFocusSession = new GalaxyFocusSession();
    this.galaxyGraphNodes = [];
    this.galaxyGraphEdges = [];
    this.lastGalaxyRestoration = null;
  }

  replaceGraph(nodes, edges) {
    if (this.isGalaxyFocusActive()) this.exitGalaxyFocus({ immediate: true });
    this.galaxyGraphNodes = [];
    this.galaxyGraphEdges = [];
    const result = super.replaceGraph(nodes, edges);
    this.galaxyGraphNodes = cloneRecords(nodes);
    this.galaxyGraphEdges = cloneRecords(edges);
    return result;
  }

  addNodes(nodes) {
    const result = super.addNodes(nodes);
    const incoming = new Map(nodes.map((node) => [node.id, { ...node }]));
    this.galaxyGraphNodes = [
      ...this.galaxyGraphNodes.filter(({ id }) => !incoming.has(id)),
      ...incoming.values()
    ];
    return result;
  }

  updateNode(node) {
    const result = super.updateNode(node);
    if (result) {
      this.galaxyGraphNodes = this.galaxyGraphNodes.map((record) => record.id === node.id ? { ...node } : record);
    }
    return result;
  }

  removeNode(nodeId) {
    const result = super.removeNode(nodeId);
    if (result) {
      this.galaxyGraphNodes = this.galaxyGraphNodes.filter(({ id }) => id !== nodeId);
      this.galaxyGraphEdges = this.galaxyGraphEdges.filter(({ fromNodeId, toNodeId }) => fromNodeId !== nodeId && toNodeId !== nodeId);
    }
    return result;
  }

  addEdges(edges) {
    const result = super.addEdges(edges);
    const incoming = new Map(edges.map((edge) => [edge.id, { ...edge }]));
    this.galaxyGraphEdges = [
      ...this.galaxyGraphEdges.filter(({ id }) => !incoming.has(id)),
      ...incoming.values()
    ];
    return result;
  }

  removeEdge(edgeId) {
    const result = super.removeEdge(edgeId);
    if (result) this.galaxyGraphEdges = this.galaxyGraphEdges.filter(({ id }) => id !== edgeId);
    return result;
  }

  isGalaxyFocusActive() {
    return this.galaxyFocusSession.getState().active;
  }

  getGalaxyFocusState() {
    const state = this.galaxyFocusSession.getState();
    return Object.freeze({
      ...state,
      nodeObjectCount: this.meshByNodeId.size,
      edgeObjectCount: this.edgeObjectById.size,
      restorationExact: this.lastGalaxyRestoration?.exact ?? null
    });
  }

  captureGalaxySnapshot() {
    return Object.freeze({
      cameraState: cloneCameraState(this.captureCameraState()),
      projection: this.getView(),
      nodePositions: captureNodePositionSnapshot(this.meshByNodeId),
      rotationPaused: this.rotationPaused,
      emphasis: cloneEmphasis(this.getEmphasisState()),
      nodeObjectCount: this.meshByNodeId.size,
      edgeObjectCount: this.edgeObjectById.size
    });
  }

  applyGalaxyFocusPositions(focusedNodeId) {
    const { groups, positions } = calculateGalaxyFocusPositions({
      focusedNodeId,
      nodes: this.galaxyGraphNodes,
      edges: this.galaxyGraphEdges,
      view: this.getView()
    });
    for (const [nodeId, position] of positions) {
      this.meshByNodeId.get(nodeId)?.position?.set(position.x, position.y, position.z);
    }
    this.syncEdgePositions();
    this.applyGalaxyFocusVisuals(groups);
    return groups;
  }

  applyGalaxyFocusVisuals(groups) {
    const neighbors = new Set(groups.neighborNodeIds);
    const unrelated = new Set(groups.unrelatedNodeIds);
    for (const [nodeId, point] of this.meshByNodeId) {
      const visual = getNodeVisualMetadata(point.userData.nodeType);
      let scale = 1;
      let opacity = 1;
      let emissiveIntensity = visual.emissiveIntensity;
      if (nodeId === groups.focusedNodeId) {
        scale = 1.85;
        emissiveIntensity *= 2;
      } else if (neighbors.has(nodeId)) {
        scale = 1.28;
        emissiveIntensity *= 1.35;
      } else if (unrelated.has(nodeId)) {
        scale = 0.78;
        opacity = 0.2;
        emissiveIntensity *= 0.28;
      }
      point.userData.emphasisScale = scale;
      point.material.transparent = true;
      point.material.opacity = opacity;
      point.material.emissiveIntensity = emissiveIntensity;
      point.material.needsUpdate = true;
      point.scale.setScalar(scale);
    }
    for (const line of this.edgeObjectById.values()) {
      const connected = line.userData.fromNodeId === groups.focusedNodeId || line.userData.toNodeId === groups.focusedNodeId;
      line.material.opacity = connected ? 0.92 : 0.08;
      line.material.needsUpdate = true;
    }
  }

  enterGalaxyFocus(focusedNodeId, { immediate = false, duration = 450 } = {}) {
    if (!this.meshByNodeId.has(focusedNodeId)) return false;
    if (this.isGalaxyFocusActive()) {
      if (this.galaxyFocusSession.focusedNodeId === focusedNodeId) return this.getGalaxyFocusState();
      this.exitGalaxyFocus({ immediate: true });
    }
    const snapshot = this.captureGalaxySnapshot();
    this.galaxyFocusSession.begin(focusedNodeId, snapshot);
    this.rotationPaused = true;
    this.applyGalaxyFocusPositions(focusedNodeId);
    this.navigateToNode(focusedNodeId, { immediate, duration, distance: 9 });
    this.galaxyFocusSession.activate();
    this.lastGalaxyRestoration = null;
    return this.getGalaxyFocusState();
  }

  exitGalaxyFocus({ immediate = false, duration = 450 } = {}) {
    const snapshot = this.galaxyFocusSession.snapshot;
    if (!snapshot) return false;
    this.galaxyFocusSession.beginExit();
    if (this.getView() !== snapshot.projection) super.setView(snapshot.projection, { resetCamera: false });
    for (const [nodeId, position] of snapshot.nodePositions) {
      this.meshByNodeId.get(nodeId)?.position?.set(position.x, position.y, position.z);
    }
    this.syncEdgePositions();
    this.setSearchEmphasis(snapshot.emphasis);
    this.rotationPaused = true;
    this.restoreCameraState(snapshot.cameraState, { immediate, duration });
    const restoredPositions = captureNodePositionSnapshot(this.meshByNodeId);
    const exact = positionSnapshotsEqual(snapshot.nodePositions, restoredPositions)
      && snapshot.nodeObjectCount === this.meshByNodeId.size
      && snapshot.edgeObjectCount === this.edgeObjectById.size;
    this.lastGalaxyRestoration = Object.freeze({
      exact,
      projection: snapshot.projection,
      nodeObjectCount: this.meshByNodeId.size,
      edgeObjectCount: this.edgeObjectById.size
    });
    this.rotationPaused = snapshot.rotationPaused;
    this.galaxyFocusSession.clear();
    return this.lastGalaxyRestoration;
  }

  setView(view, options = {}) {
    const result = super.setView(view, options);
    if (this.isGalaxyFocusActive()) {
      this.rotationPaused = true;
      this.applyGalaxyFocusPositions(this.galaxyFocusSession.focusedNodeId);
    }
    return result;
  }

  resetGalaxyFocus(options = {}) {
    if (this.isGalaxyFocusActive()) this.exitGalaxyFocus({ ...options, immediate: true });
    return this.resetCamera(options);
  }
}
