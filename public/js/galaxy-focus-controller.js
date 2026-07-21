const setHidden = (element, hidden) => {
  if (!element) return;
  element.hidden = hidden;
  element.setAttribute('aria-hidden', String(hidden));
};

export class GalaxyFocusController {
  constructor({
    scene,
    focusButton,
    backButton,
    statusElement = null,
    dismissSearchlight = () => {},
    onStateChange = () => {},
    prefersReducedMotion = () => false
  } = {}) {
    if (!scene) throw new Error('GalaxyFocusController requires a scene.');
    this.scene = scene;
    this.focusButton = focusButton;
    this.backButton = backButton;
    this.statusElement = statusElement;
    this.dismissSearchlight = dismissSearchlight;
    this.onStateChange = onStateChange;
    this.prefersReducedMotion = prefersReducedMotion;
    this.selectedNodeId = null;
    this.focusButton?.setAttribute('aria-label', 'Focus selected node in Galaxy Focus');
    this.focusButton?.setAttribute('aria-pressed', 'false');
    this.backButton?.setAttribute('aria-label', 'Exit Galaxy Focus and restore the previous view');
    this.backButton?.setAttribute('aria-keyshortcuts', 'Escape');
    this.focusButton?.addEventListener?.('click', () => this.enter());
    this.backButton?.addEventListener?.('click', () => this.exit());
    this.syncUi();
  }

  setSelectedNodeId(nodeId) {
    this.selectedNodeId = nodeId ?? null;
    this.syncUi();
    return this.selectedNodeId;
  }

  enter(nodeId = this.selectedNodeId) {
    if (!nodeId) return false;
    this.dismissSearchlight();
    const result = this.scene.enterGalaxyFocus(nodeId, { immediate: this.prefersReducedMotion() });
    this.syncUi();
    this.onStateChange(this.getState());
    return result;
  }

  exit() {
    const result = this.scene.exitGalaxyFocus({ immediate: this.prefersReducedMotion() });
    this.syncUi();
    this.onStateChange(this.getState());
    return result;
  }

  reset() {
    const result = this.scene.resetGalaxyFocus({ immediate: this.prefersReducedMotion() });
    this.syncUi();
    this.onStateChange(this.getState());
    return result;
  }

  handleEscape() {
    if (!this.scene.isGalaxyFocusActive()) return false;
    this.exit();
    return true;
  }

  getState() {
    return Object.freeze({
      selectedNodeId: this.selectedNodeId,
      ...this.scene.getGalaxyFocusState()
    });
  }

  syncUi() {
    const state = this.scene.getGalaxyFocusState();
    const active = state.active;
    if (this.focusButton) {
      this.focusButton.disabled = !this.selectedNodeId || active;
      this.focusButton.setAttribute('aria-pressed', String(active));
    }
    setHidden(this.backButton, !active);
    if (this.statusElement) {
      this.statusElement.textContent = active ? `Galaxy Focus: ${state.state}` : 'Galaxy Focus ready';
    }
    return this.getState();
  }
}
