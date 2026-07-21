import test from 'node:test';
import assert from 'node:assert/strict';
import { GalaxyFocusController } from '../public/js/galaxy-focus-controller.js';

class FakeElement {
  constructor() {
    this.attributes = new Map();
    this.listeners = new Map();
    this.disabled = false;
    this.hidden = false;
    this.textContent = '';
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name); }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  click() { this.listeners.get('click')?.(); }
}

const createHarness = ({ reducedMotion = false } = {}) => {
  let active = false;
  let focusedNodeId = null;
  const calls = [];
  const scene = {
    isGalaxyFocusActive: () => active,
    getGalaxyFocusState: () => ({ state: active ? 'active' : 'idle', focusedNodeId, active }),
    enterGalaxyFocus: (nodeId, options) => { active = true; focusedNodeId = nodeId; calls.push(['enter', nodeId, options]); return true; },
    exitGalaxyFocus: (options) => { active = false; calls.push(['exit', options]); return true; },
    resetGalaxyFocus: (options) => { active = false; calls.push(['reset', options]); return true; }
  };
  const focusButton = new FakeElement();
  const backButton = new FakeElement();
  const statusElement = new FakeElement();
  let dismissals = 0;
  const controller = new GalaxyFocusController({
    scene,
    focusButton,
    backButton,
    statusElement,
    dismissSearchlight: () => { dismissals += 1; },
    prefersReducedMotion: () => reducedMotion
  });
  return { controller, scene, calls, focusButton, backButton, statusElement, getDismissals: () => dismissals };
};

test('Focus is selection-gated and dismisses Searchlight before entry', () => {
  const harness = createHarness();
  assert.equal(harness.focusButton.disabled, true);
  harness.controller.setSelectedNodeId('node-1');
  assert.equal(harness.focusButton.disabled, false);
  harness.focusButton.click();
  assert.equal(harness.getDismissals(), 1);
  assert.deepEqual(harness.calls[0], ['enter', 'node-1', { immediate: false }]);
  assert.equal(harness.focusButton.getAttribute('aria-pressed'), 'true');
  assert.equal(harness.backButton.hidden, false);
});

test('Back and Escape exit focus with accessibility metadata', () => {
  const harness = createHarness({ reducedMotion: true });
  harness.controller.setSelectedNodeId('node-1');
  harness.controller.enter();
  assert.equal(harness.backButton.getAttribute('aria-keyshortcuts'), 'Escape');
  assert.equal(harness.controller.handleEscape(), true);
  assert.deepEqual(harness.calls.at(-1), ['exit', { immediate: true }]);
  assert.equal(harness.controller.handleEscape(), false);
  assert.equal(harness.backButton.hidden, true);
});

test('Reset exits transient presentation state without changing selection identity', () => {
  const harness = createHarness();
  harness.controller.setSelectedNodeId('node-1');
  harness.controller.enter();
  harness.controller.reset();
  assert.deepEqual(harness.calls.at(-1), ['reset', { immediate: false }]);
  assert.equal(harness.controller.getState().selectedNodeId, 'node-1');
  assert.equal(harness.controller.getState().active, false);
  assert.equal(harness.statusElement.textContent, 'Galaxy Focus ready');
});
