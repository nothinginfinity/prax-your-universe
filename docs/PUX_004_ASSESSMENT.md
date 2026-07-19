# PUX-004 Implementation Assessment

## Canonical starting point

- CairnStone chain: `prax-your-universe`
- Starting chain HEAD: `1293fbed833bf2df5a3f70d9c3db28cc97d70a6ddb97b81d92dca3888c66f6b3`
- Starting repository commit: `e21c21575f44c1c6e507b8159f47234a2ca767bd`
- Starting application version: `0.2.0-pux.3`
- Roadmap milestone: PUX-004 — Node CRUD

The roadmap and repository agree that PUX-004 is the next incomplete milestone. PUX-005 import/export and all later work remain out of scope.

## Existing architecture

Prax uses a versioned canonical graph snapshot in the browser. `GraphStore` owns in-memory graph truth, `PraxIndexedDbRepository` persists the complete normalized snapshot in one IndexedDB transaction, and `PraxScene` projects the graph into Three.js objects. `commitGraphMutation` snapshots the prior store state, validates and persists the mutation, rolls the store back on graph or persistence failure, and only then projects the committed result into the scene.

PUX-003 already guarantees one deterministic universe root, one default root `contains` edge per non-root node, stable explicit edge objects, and projection synchronization across sphere and grid layouts.

## PUX-004 scope

- Create link nodes.
- Create note nodes.
- Edit mutable link and note content without changing identity or type.
- Delete non-root nodes.
- Delete every canonical edge and layout-node record connected to a deleted node.
- Prevent universe-root edit and deletion.
- Add stable node-type visual metadata and expose it in the UI and renderer.

## Files expected to change

- `public/js/graph-store.js`
- `public/js/scene.js`
- `public/js/app.js`
- `public/index.html`
- `public/styles.css`
- CRUD-focused unit and persistence tests
- `scripts/verify-pux004-live.mjs`
- `.github/workflows/deploy.yml`
- `package.json` and `package-lock.json`
- `src/worker.js`
- PUX-004 assessment and, only after acceptance, verification and roadmap documentation

## Data model and migration implications

The existing schema already contains `link` and `note` node types and the canonical fields needed by PUX-004: stable identity, title, body, URL, timestamps, provenance, and typed edges. Mutable content is not part of deterministic identity. Therefore:

- `PRAX_SCHEMA_VERSION` remains `1`.
- `PRAX_DATABASE_VERSION` remains `1`.
- No IndexedDB object-store or index migration is justified.
- Existing PUX-002 and PUX-003 snapshots remain compatible.
- Application-level graph normalization remains sufficient.

## Persistence and rollback semantics

Creation, editing, and deletion continue through `commitGraphMutation`.

- The graph store captures the previous validated snapshot.
- Store-level compound operations validate their final topology and restore the previous snapshot on failure.
- IndexedDB clears and rewrites normalized stores inside one read/write transaction.
- A failed persistence transaction leaves the previously committed database intact.
- Scene projection occurs only after persistence succeeds.

Deletion removes the node, every edge where it is either endpoint, and every layout-node record that references it. The universe root is managed topology and cannot be edited or deleted through CRUD.

## Rendering and UI implications

The scene keeps stable registries for node meshes and edge lines. Node deletion reuses the existing resource-disposal path, including connected rendered edges. Node edits preserve the mesh because node type is immutable, while refreshing display title and visual metadata.

The UI uses one create/edit modal with explicit link and note modes. The selected-node panel exposes type, body or URL, edit, and delete controls. Root-node actions are hidden.

## Test plan

- Link and note creation each produce one default root edge.
- Edits preserve ID, origin ID, node type, creation time, provenance, and connected edges.
- Invalid edits restore the prior snapshot.
- Root edit/delete attempts fail without mutation.
- Deletion removes all connected explicit edges and dependent layout-node records.
- IndexedDB reloads preserve create and edit operations and preserve deletion.
- Injected persistence failures roll back create, edit, and delete operations and suppress scene projection.
- Scene updates retain stable meshes and refresh visual metadata.
- Scene deletion disposes node and connected edge resources.
- Existing graph schema, root topology, layout, persistence, and edge-rendering tests remain green.

## Deployment and live verification plan

- Run all Node tests locally.
- Run JavaScript syntax checks locally.
- Run Wrangler dry-run validation in GitHub Actions.
- Inspect validation, deployment, and live-verifier job steps and logs.
- Verify `/api/health` exposes `0.2.0-pux.4`, schema version `1`, database version `1`, and CRUD readiness.
- Run production Playwright verification for link creation, note creation, edit, deletion, reload persistence, topology, resource registries, desktop, and mobile.
- Run independent visual-browser captures at desktop and mobile widths and inspect console/network/page evidence.

## Risks and regression controls

- Root deletion could destroy graph invariants: explicitly blocked and tested.
- Node deletion could leave dangling edges or layout records: all dependents are removed before validation and persistence.
- Persistence failure could leave the store ahead of IndexedDB: snapshot rollback is retained and tested for edit and delete.
- UI selection could point to a deleted node: deletion clears selection and the detail panel.
- Rendering resources could leak: node deletion disposes the mesh and every connected line.
- Node edits could accidentally change deterministic identity or type: mutable fields are explicitly allow-listed.
- A database migration could introduce unnecessary upgrade risk: no migration is made.
