# PUX-005 Verification — Import and Export

**Milestone:** PUX-005 — Import and Export  
**Application version:** `0.2.0-pux.5`  
**Final implementation commit:** `2d551b4d1c9fcf70e00622bbb030246bfd5c6b52`  
**Final successful workflow:** `29675770334`  
**Live application:** `https://prax-your-universe.jaredtechfit.workers.dev`  
**Graph schema version:** `1`  
**IndexedDB database version:** `1`  
**Prax bundle version:** `1`

## Verdict

PUX-005 is complete.

The final commit passed the complete GitHub Actions validation, deployment, dedicated production browser verifier, and an independent desktop/mobile visual-browser audit. The application exports a deterministic, versioned Prax JSON bundle and imports validated bundles through a destructive, replace-only workflow without permitting malformed input or failed persistence to leave partial graph state.

No IndexedDB schema migration was introduced. The Worker still exposes no public mutation API.

## Canonical behavior

### Export

The application exports one universe as a `prax-json` bundle with:

- `format: "prax-json"`;
- `bundleVersion: 1`;
- `graphSchemaVersion: 1`;
- application and export metadata;
- universes;
- nodes, including the canonical universe root;
- edges;
- layouts;
- layout-node records;
- settings;
- stable IDs, origin IDs, timestamps, schema versions, and provenance.

Record collections are sorted by stable ID. Metadata extension object keys are normalized deterministically. Serialization uses formatted JSON with a final newline. The generated filename ends in `.prax.json`.

Renderer-only state is intentionally excluded. Camera position, hover state, selected node, modal state, transient mesh order, and temporary scene projection coordinates are not exported. Canonical settings and persisted layout records are included.

### Import

PUX-005 supports **replace-only** import. Merge behavior is not implemented because it is not required by the canonical roadmap and would require unresolved conflict policies for IDs, roots, provenance, layouts, and settings.

The complete file is read and validated before the destructive confirmation becomes available. Import is limited to 10 MiB and requires exactly one universe.

The validator rejects:

- malformed JSON;
- unsupported bundle versions;
- unsupported graph schema versions;
- unknown structural envelope or graph fields;
- duplicate node or edge IDs;
- multiple universes;
- multiple or non-deterministic universe roots;
- edges with missing endpoints;
- cross-universe endpoints;
- invalid root mutations;
- invalid or missing root `contains` topology after normalization;
- unknown node, edge, layout, or provenance types;
- unsafe metadata keys;
- graph snapshots that fail application-level normalization.

Safe optional envelope metadata is preserved. Unknown structural invariants are rejected.

### Legacy compatibility

A raw graph-schema-version-1 snapshot is accepted as a legacy import shape. Application-level normalization adds only deterministic missing universe-root topology and default root `contains` edges. Existing IDs, content, timestamps, provenance, layouts, layout-node records, and settings are preserved.

This supports PUX-002-era snapshots without an IndexedDB migration. PUX-003 and later version-1 snapshots that already contain strict root topology import without topology repair.

### Transaction and rollback semantics

Import validation completes before `GraphStore` mutation or IndexedDB clearing begins.

Replacement uses a pre-operation snapshot and follows this order:

1. Replace the in-memory graph with the fully normalized candidate.
2. Validate the strict replacement snapshot.
3. Save the complete snapshot in one IndexedDB transaction.
4. Project the committed graph into the scene.

If mutation or persistence fails, the previous `GraphStore` snapshot is restored and the scene is not projected with the failed candidate. IndexedDB transaction failure preserves the previous committed database state.

If scene projection fails after persistence succeeds, the replacement helper restores the previous store, re-persists the previous snapshot, and restores the previous projection before surfacing the error.

Malformed and unsupported files are rejected without changing the current graph.

## User safeguards

Import requires a dedicated destructive-operation confirmation surface that displays:

- source filename;
- universe name;
- node count;
- edge count;
- layout count;
- whether legacy root topology will be added;
- an explicit warning that the current universe will be replaced.

The file input accepts JSON-compatible files. Export uses the browser download surface. Desktop and mobile download behavior was verified in Chromium. Browsers that restrict programmatic downloads or file pickers may still apply platform-specific permission behavior.

## Rendering synchronization

Successful import performs a full scene replacement from the committed canonical graph.

Verification confirms:

- removed node geometry and materials are disposed;
- removed edge geometry and materials are disposed;
- rendered node IDs equal canonical node IDs;
- rendered edge IDs equal canonical edge IDs;
- repeated full replacement creates no duplicate meshes;
- repeated full replacement creates no duplicate edge lines;
- the imported preferred sphere or grid setting is restored;
- the imported graph remains visible after reload.

## Automated test evidence

The final source contains 67 Node test cases across the graph schema, graph store, mutation transaction boundary, IndexedDB repository, import/export bundle, and Three.js scene suites.

Final workflow `29675770334` reported:

- `npm test`: success;
- `npm run check`: success;
- JavaScript syntax checks: success;
- Wrangler deployment dry-run: success;
- deployment: success;
- dedicated PUX-005 live verifier: success.

The PUX-005-specific test coverage includes:

- complete bundle export;
- deterministic serialization;
- stable-ID and provenance round trips;
- link URL and note body preservation;
- edge type preservation;
- layout, layout-node, and settings preservation;
- legacy version-1 normalization;
- malformed JSON rejection;
- unsupported bundle and graph versions;
- duplicate node and edge IDs;
- multiple universes and roots;
- missing endpoints;
- invalid root edges;
- unsupported node and edge types;
- unknown structural fields;
- safe optional metadata preservation;
- unsafe metadata rejection;
- oversized file rejection;
- replacement persistence ordering;
- persistence-failure rollback;
- projection-failure rollback and re-persistence;
- render-resource disposal;
- duplicate mesh and edge-line prevention.

## Production live-verification evidence

The dedicated production verifier in `scripts/verify-pux005-live.mjs` passed on workflow `29675770334` and verified:

- `/api/health` returned HTTP 200;
- version `0.2.0-pux.5`;
- milestone `PUX-005`;
- bundle version `1`;
- import/export enabled;
- replace-only behavior;
- no public mutation API;
- link and note creation before export;
- actual browser download and JSON inspection;
- destructive replacement through the confirmation modal;
- replacement of titles, URLs, and note bodies while preserving IDs;
- removal of a node created after export;
- preferred-layout replacement;
- reload persistence;
- malformed import rejection without graph mutation;
- unsupported-version rejection without graph mutation;
- one canonical root and one root `contains` edge per non-root node;
- no duplicate rendered nodes or edges;
- desktop import confirmation usability;
- mobile file input, confirmation modal, cancel, and download behavior;
- zero captured console errors, page errors, failed requests, or failed responses.

## Independent visual-browser evidence

Final independent audit: `vb_3af0a6d9`

Desktop child run: `vb_3af0a6d9_0`

- viewport: 1440 × 900;
- HTTP 200;
- ready state complete;
- scroll width 1440;
- viewport width 1440;
- zero console errors;
- zero page errors;
- zero failed requests;
- zero failed responses.

Mobile child run: `vb_3af0a6d9_1`

- viewport: 390 × 844 with mobile/touch emulation;
- HTTP 200;
- ready state complete;
- scroll width 390;
- viewport width 390;
- zero console errors;
- zero page errors;
- zero failed requests;
- zero failed responses.

The final desktop and mobile audit therefore found no horizontal overflow.

## Defect classification and corrections

### Test defect

The first core workflow failure compared exports generated from two separately randomized test graphs. The serializer was not shown to be nondeterministic. The fixture was corrected to serialize the same canonical snapshot twice.

### Product UI defects

The first PUX-005 live verifier found that an invisible import-modal child button inherited `pointer-events: all` and intercepted add-node modal clicks. Hidden modal descendants were made non-interactive until their modal is visible.

An independent visual audit then found that transform-based hiding of the information panel increased document scroll width. The hidden panel behavior was changed so desktop and mobile document width now equals viewport width.

### Verifier/tool condition

An early independent visual-browser attempt waited for `networkidle`, which is unsuitable for the continuously animated Three.js application and timed out. The audit was rerun using the page `load` event. This was a wait-condition defect, not a product defect.

### Workflow, deployment, Cloudflare, and infrastructure

No final workflow defect, deployment defect, Cloudflare binding defect, or infrastructure defect remains. The deployed Worker continues to use the static assets binding and read-only health route only.

## Final acceptance result

PUX-005 acceptance criteria are satisfied:

- versioned Prax JSON bundle defined;
- nodes, edges, layouts, layout-node records, settings, and metadata exported;
- IDs and provenance preserved;
- export-import round trip preserves semantics;
- validation occurs before destructive mutation;
- replace-only behavior confirmed;
- one canonical root preserved;
- malformed imports cannot partially overwrite state;
- persistence and projection rollback paths are tested;
- successful import synchronizes the complete scene;
- imported state persists after reload;
- desktop and mobile behavior verified;
- graph schema remains version 1;
- IndexedDB remains version 1;
- no public mutation API introduced.

PUX-006 was not started as part of this milestone.
