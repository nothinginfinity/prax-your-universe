# PUX-003 Verification — Root Node and Typed Edge Rendering

**Release:** `0.2.0-pux.3`  
**Acceptance commit:** `a086c7f913dfc856134a8edf9a96619bff899b7b`  
**Acceptance workflow:** `29671749857`  
**Live Worker:** `https://prax-your-universe.jaredtechfit.workers.dev/`

## Result

PUX-003 is complete.

Prax now has one deterministic universe root per universe, explicit typed membership edges, backward-compatible PUX-002 graph normalization, transactional node-plus-edge persistence, and stable Three.js edge rendering synchronized across sphere and grid projections.

## Root identity

The canonical root uses:

- `nodeType: "universe_root"`
- deterministic origin: `universe-root:<universeId>`
- system provenance: `prax-universe-root-v1`

The default production root ID is:

`node_4b932692f8596023bd2e18f70836f578`

Exactly one root is allowed per universe. Ordinary node mutation APIs cannot create additional roots.

## Default-edge policy

Every canonical non-root node receives exactly one explicit edge:

`universe_root --contains--> node`

This policy includes seed instruction nodes and historical PUX-002 nodes. The relationship represents universe membership rather than an inferred semantic claim.

New user nodes and their root edge are created within one GraphStore mutation boundary. The complete graph is validated and persisted before either object is projected into Three.js.

## Backward-compatible upgrade

IndexedDB remains database version `1`; no object-store migration is required.

At startup Prax:

1. reads and validates the existing PUX-002 snapshot;
2. creates or reuses the deterministic root;
3. creates only missing default root edges;
4. preserves existing IDs, content, layouts, settings, timestamps, and provenance;
5. strictly validates the upgraded topology;
6. persists the upgraded snapshot in one IndexedDB transaction;
7. hydrates GraphStore and the scene from the upgraded graph.

A failed upgrade write leaves the previous IndexedDB commit intact and falls back to the upgraded graph in memory.

## Rendering architecture

`GraphStore` and IndexedDB remain canonical. `PraxScene` owns only render projections.

The scene now maintains:

- `meshByNodeId`
- `edgeObjectById`
- one lightweight `THREE.Line` per explicit edge
- shared node and edge transforms
- deterministic sphere and grid positions
- endpoint synchronization after each layout recalculation
- disposal paths for future edge deletion

Edges are not rebuilt on every animation frame. Sphere rotation moves the shared graph group, keeping lines attached without rewriting geometry continuously.

## Automated validation

Local and CI validation covered:

- 39 Node tests passed;
- direct JavaScript syntax checks passed;
- `npm run check` passed;
- Wrangler deployment dry-run passed;
- production deployment passed.

Tests include:

- deterministic root identity;
- exactly one root per universe;
- existing root reuse after reload;
- lossless PUX-002 snapshot upgrade;
- one default edge per new node;
- duplicate-edge prevention;
- node rollback after edge failure;
- node-and-edge rollback after IndexedDB failure;
- invalid root and edge relationship rejection;
- stable scene edge IDs;
- endpoint synchronization across sphere and grid.

## GitHub Actions acceptance

Workflow run `29671749857` completed successfully.

- `validate`: success
  - `npm test`: success
  - `npm run check`: success
- `deploy`: success
  - Wrangler production deployment: success
- `live-verify`: success
  - Playwright Chromium installation: success
  - production browser verification: success
  - screenshot artifact upload: success

The acceptance evidence artifact is named:

`pux003-live-browser-evidence`

## Live browser verification

The post-deploy Playwright verifier uses the normal page `load` event plus deterministic readiness checks and a short fixed delay. It does not use `networkidle`, because the Three.js scene renders continuously.

The verifier confirmed:

- production health reports Worker `0.2.0-pux.3`;
- IndexedDB reports `Local saved`;
- exactly one deterministic root renders;
- all canonical edges exist in the stable render registry;
- every line endpoint matches its current node mesh positions;
- a link created through the production UI receives one root `contains` edge;
- the new node and edge survive reload in the same IndexedDB profile;
- sphere → grid → sphere maintains attached endpoints;
- mobile `390 × 844` rendering has no horizontal overflow;
- mobile sphere and grid topology remain synchronized;
- no relevant console errors, page errors, failed requests, or failed responses occurred.

Independent visual-browser captures also returned HTTP 200 on desktop and mobile with zero console, page, request, or response failures.

## Verification harness lessons

Two initial live-verifier failures were test-harness defects rather than product defects:

1. The verifier observed canonical GraphStore state during the intentional persist-before-project interval. It was corrected to wait for both the canonical edge and its rendered edge object.
2. The verifier incorrectly expected a trailing slash after a non-root URL path. It was corrected to compare the actual canonical URL.

Persisted diagnostics and screenshots established that the node, edge, reload, and renderer state were intact in both cases. The verifier now emits a compact GitHub annotation and uploads failure evidence whenever a future assertion fails.

## Deferred work

PUX-003 intentionally does not add:

- force-directed layout;
- semantic or suggested edges;
- edit/delete CRUD policy;
- animated layout tweening;
- PUX-004 functionality.

Those remain separate milestones.
