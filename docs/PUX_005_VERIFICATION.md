# PUX-005 Verification

## Release identity

- Work package: PUX-005 — Import and export
- Application version: `0.2.0-pux.5`
- Final implementation commit: `2d551b4d1c9fcf70e00622bbb030246bfd5c6b52`
- Final implementation workflow: `29675770334`
- Canonical starting PUX-004 closeout: `5488df5cf32d9307a79bb76c792768c2f05a55c5a6fc7070b916371d87f174b5`
- PUX-005 assessment stone: `ac113ead0cf3805f93f7ce73708eabb0b29a99caead9c00d15fad71a1eed9eaa`
- Prax bundle version: `1`
- Graph schema version: `1`
- IndexedDB database version: `1`

PUX-005 is a client-side, replace-only import/export release. It adds no public mutation API, no cloud persistence binding, no graph-schema migration, and no IndexedDB database-version migration.

## Accepted behavior

The final implementation provides:

- a versioned `prax-json` envelope independent from the graph schema version;
- deterministic export ordering for all canonical collections;
- export of the universe, nodes, edges, layouts, layout-node records, settings, IDs, timestamps, and provenance;
- preservation of link URLs, note bodies, node types, edge types, stable IDs, and provenance;
- safe optional envelope metadata preservation;
- strict rejection of unknown structural fields and unsupported structural types;
- explicit support for valid legacy version-1 raw graph snapshots;
- deterministic application-level normalization of only missing roots and default root edges;
- complete validation before confirmation, store mutation, IndexedDB writes, or scene replacement;
- destructive import confirmation showing filename, universe, counts, and normalization effects;
- replace-only import for exactly one universe;
- persistence-first replacement;
- rollback of the in-memory graph after persistence failure;
- restoration of graph, persistence, and scene after projection failure;
- full scene replacement with disposal of removed meshes and edge resources;
- no duplicate mesh or edge-line registries after repeated replacement;
- desktop and mobile import/export controls;
- direct user-gesture file download and browser file-picker import;
- explicit memory-only warning when IndexedDB is unavailable.

Merge import was intentionally excluded because it is not required by the canonical PUX-005 roadmap and would require conflict policies that belong to later synchronization and multiple-universe work.

## Import rejection matrix

The automated suite verifies rejection of:

- malformed JSON;
- unsupported bundle versions;
- unsupported graph schema versions;
- duplicate node IDs;
- duplicate edge IDs;
- multiple universes;
- multiple roots;
- edges with missing endpoints;
- invalid root mutations and root topology;
- unsupported node types;
- unsupported edge types;
- unknown structural envelope fields;
- unknown structural graph fields;
- unsafe metadata keys;
- oversized import files;
- snapshots that fail canonical graph validation.

Rejected imports do not modify the active graph or persisted graph.

## Automated validation

Final workflow `29675770334` checked out exact commit `2d551b4d1c9fcf70e00622bbb030246bfd5c6b52`.

### Validate job

Job `88162822902` completed successfully.

- `npm install`: passed with zero reported package vulnerabilities for the committed dependencies.
- `npm test`: 67 tests passed, 0 failed.
- JavaScript syntax checks: passed for source files and all live verifiers.
- Wrangler deployment dry-run: passed.

The PUX-005 additions include:

- 12 bundle-format, round-trip, validation, compatibility, and rejection tests;
- 3 replacement transaction and rollback tests;
- 1 full-scene replacement, disposal, and duplicate-registry test.

Existing persistence, graph schema, graph store, mutation, scene, and PUX-004 behavior remained green.

### Deployment job

Job `88162845256` completed successfully.

- dependency installation: passed;
- `wrangler deploy`: passed;
- production Worker and static assets were updated from the exact tested commit.

### Production PUX-005 verifier

Job `88162876905` completed successfully.

The dedicated Playwright verifier confirmed:

- `/api/health` returned HTTP 200 and `0.2.0-pux.5`;
- bundle version `1` and replace-only readiness were exposed;
- no public mutation API was exposed;
- distinctive link and note nodes were created and persisted;
- export produced a downloadable `.prax.json` file;
- exported JSON retained the root, IDs, link URL, note body, and graph collections;
- a different valid payload destructively replaced the current universe;
- a node created after export disappeared during replacement;
- imported titles, URL, note content, settings, and IDs appeared in the graph;
- exactly one canonical root remained;
- rendered node and edge registries matched canonical records;
- no duplicate meshes or edge lines appeared;
- the imported preferred grid layout was applied;
- the imported universe survived page reload;
- malformed JSON was rejected without graph mutation;
- an unsupported bundle version was rejected without graph mutation;
- desktop and mobile import confirmation controls were usable;
- desktop and mobile export download behavior was observed;
- browser evidence was uploaded by the workflow.

Rollback-sensitive persistence and projection failure paths are tested deterministically in the unit suite rather than through an unsafe production failure switch.

## Independent visual-browser verification

Final independent multi-viewport audit: `vb_2a8f90b0`.

### Desktop

Receipt: `vb_2a8f90b0_0`

- viewport: `1440 × 900`;
- HTTP status: 200;
- ready state: complete;
- document dimensions: `1440 × 900`;
- horizontal overflow: none;
- console errors: 0;
- page errors: 0;
- failed requests: 0;
- failed responses: 0;
- visual warnings: none.

### Mobile

Receipt: `vb_2a8f90b0_1`

- viewport: `390 × 844`;
- HTTP status: 200;
- ready state: complete;
- document dimensions: `390 × 844`;
- horizontal overflow: none;
- console errors: 0;
- page errors: 0;
- failed requests: 0;
- failed responses: 0;
- visual warnings: none.

## Defects found and resolved during verification

### Determinism test fixture defect

The first core workflow failed because the test generated two different random graph identities and then compared their serialized output. The serializer was not shown to be nondeterministic. The test was corrected to serialize the same snapshot twice in commit `2c875fe34b03ff9b11883c293cd23d3770c6fe75`.

Classification: test defect.

### Hidden import modal intercepted node-form clicks

Workflow `29675597410` reached production and the live verifier discovered that a button inside the invisible import modal inherited `pointer-events: all`, intercepting the visible node form's submit action. Hidden modal descendants were made non-interactive, and invisible modals now use hidden visibility semantics in commit `5576ed4a04db96c381cd699320e6fe638c93fec9`.

Classification: product UI defect found by the verifier.

### Off-canvas information panel caused desktop overflow

Independent visual audit `vb_ac1125fe` found a desktop document width of 1852 pixels at a 1440-pixel viewport. The transform-hidden information panel extended the document's scrollable width. The panel was changed to visibility and opacity hiding in final implementation commit `2d551b4d1c9fcf70e00622bbb030246bfd5c6b52`.

Classification: product responsive-layout defect found by independent visual verification.

### Unsuitable visual wait condition

An initial independent audit waited for `networkidle` and timed out on the continuously animated Three.js application. The audit was rerun using the load event and deterministic evidence capture. No product network, console, or rendering error was associated with that timeout.

Classification: verifier configuration issue.

## Schema and infrastructure state

PUX-005 does not change the graph schema or database structure.

- Graph schema remains version 1.
- IndexedDB remains version 1.
- Existing object stores already hold every exported collection.
- Legacy normalization remains application-level and transactional.
- No D1, KV, R2, Vectorize, or Workers AI binding was added.
- No public upload or graph-mutation endpoint was added.
- The Worker continues to serve static assets and the read-only health route.

## Completion boundary

Every PUX-005 acceptance criterion has passed through automated validation, exact workflow inspection, production browser verification, reload verification, and independent desktop/mobile visual evidence.

PUX-006 has not been started.
