import test from 'node:test';
import assert from 'node:assert/strict';
import { commitGraphReplacement } from '../public/js/graph-mutations.js';
import { GraphStore } from '../public/js/graph-store.js';

const makeCandidate = () => {
  const store = new GraphStore();
  store.addNoteWithDefaultEdge('Imported replacement', 'Replacement body');
  store.setPreferredLayout('grid', '2026-07-19T06:10:00.000Z');
  return store.snapshot();
};

test('graph replacement persists before projection and returns the committed snapshot', async () => {
  const store = new GraphStore();
  const candidate = makeCandidate();
  const order = [];
  const repository = {
    saveSnapshot: async (snapshot) => {
      order.push('save');
      assert.deepEqual(snapshot, candidate);
    }
  };
  const result = await commitGraphReplacement({
    store,
    repository,
    snapshot: candidate,
    project: async (snapshot, context) => {
      order.push('project');
      assert.equal(context.phase, 'commit');
      assert.deepEqual(snapshot, candidate);
    }
  });
  assert.deepEqual(result, candidate);
  assert.deepEqual(store.snapshot(), candidate);
  assert.deepEqual(order, ['save', 'project']);
});

test('persistence failure restores the previous store and suppresses projection', async () => {
  const store = new GraphStore();
  const previous = store.snapshot();
  let projected = false;
  await assert.rejects(() => commitGraphReplacement({
    store,
    repository: { saveSnapshot: async () => { throw new Error('injected persistence failure'); } },
    snapshot: makeCandidate(),
    project: () => { projected = true; }
  }), /injected persistence failure/);
  assert.deepEqual(store.snapshot(), previous);
  assert.equal(projected, false);
});

test('projection failure restores store, persistence, and previous projection', async () => {
  const store = new GraphStore();
  const previous = store.snapshot();
  const saved = [];
  const phases = [];
  await assert.rejects(() => commitGraphReplacement({
    store,
    repository: { saveSnapshot: async (snapshot) => { saved.push(snapshot); } },
    snapshot: makeCandidate(),
    project: async (snapshot, context) => {
      phases.push(context.phase);
      if (context.phase === 'commit') throw new Error('injected projection failure');
      assert.deepEqual(snapshot, previous);
    }
  }), /injected projection failure/);
  assert.deepEqual(store.snapshot(), previous);
  assert.equal(saved.length, 2);
  assert.deepEqual(saved[1], previous);
  assert.deepEqual(phases, ['commit', 'rollback']);
});
