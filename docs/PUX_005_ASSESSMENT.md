# PUX-005 Implementation Assessment

## Canonical starting point

- CairnStone chain: `prax-your-universe`
- Canonical chain HEAD: `5488df5cf32d9307a79bb76c792768c2f05a55c5a6fc7070b916371d87f174b5`
- Prior expected closeout: `83fc35aae507c6172b30cfd88893f8d8d21b42d057f5e834a38b06e70136e3f6`
- Starting repository commit: `51dedf8b7481ea689258f6f7f759e3b82324144b`
- Starting application version: `0.2.0-pux.4`
- Graph schema version: `1`
- IndexedDB database version: `1`
- Next milestone: PUX-005 — Import and export

The graph reports `5488df5c...` as HEAD because it explicitly supersedes `83fc35aa...` with additional final workflow, AST-lint, verification, and graph-link evidence. It describes the same accepted PUX-004 repository state and does not begin PUX-005.

GitHub `main` remains exactly at `51dedf8b7481ea689258f6f7f759e3b82324144b`. The repository and canonical roadmap agree that PUX-005 is the next incomplete milestone.

## Canonical roadmap scope

PUX-005 requires:

- a versioned Prax JSON bundle;
- export of nodes, edges, layouts, and metadata;
- complete validation before import mutation;
- preservation of IDs and provenance during round trips.

PUX-006 and later milestones remain out of scope. PUX-005 may add the tests and live verifier required to prove its own behavior, but it must not begin later product features.

## Existing import and export architecture

There is no current product-level JSON import or export implementation. Existing uses of the JavaScript `export` keyword are module exports only. The persistence documentation explicitly defers destructive reset and JSON import/export workflows to PUX-005 and PUX-006.

The existing boundaries are suitable for adding PUX-005 without changing canonical storage architecture:

- `GraphStore` owns normalized in-memory graph truth.
- `PraxIndexedDbRepository` persists complete graph snapshots.
- `commitGraphMutation` snapshots the prior store, applies a mutation, validates and persists, restores the prior store on failure, and projects only after persistence succeeds.
- `PraxScene` is a disposable projection of canonical graph state.
- The Worker exposes only `/api/health`; it has no public mutation API.

PUX-005 should remain a client-side, local-IndexedDB feature.

## Canonical serialized format

PUX-005 should introduce an independent bundle version rather than treating the graph schema version as the file-format version.

Recommended version-1 envelope:

```json
{
  "format": "prax-json",
  "bundleVersion": 1,
  "graphSchemaVersion": 1,
  "metadata": {
    "application": "prax-your-universe",
    "applicationVersion": "0.2.0-pux.5",
    "exportedAt": "ISO-8601 timestamp",
    "universeId": "stable universe ID",
    "universeName": "display name"
  },
  "graph": {
    "schemaVersion": 1,
    "universes": [],
    "nodes": [],
    "edges": [],
    "layouts": [],
    "layoutNodes": [],
    "settings": []
  }
}
```

The graph payload is the canonical validated snapshot, not a renderer dump. Bundle version and graph schema version must be checked independently.

## Export payload contents

The export must include every canonical collection required to reconstruct the current local universe without semantic loss:

- the universe record;
- the canonical universe-root node;
- all other nodes;
- all explicit edges;
- all layout records;
- all persisted layout-node records;
- all settings records;
- IDs, origin IDs, timestamps, schema versions, and provenance for every record;
- bundle-level application and export metadata.

Although the roadmap names nodes, edges, layouts, and metadata, omitting the universe, layout-node, or settings records would make the bundle an incomplete representation of the current canonical snapshot. These collections should therefore be included.

## Layout data and UI state

Persisted layout records and layout-node coordinates are part of the export. Temporary `PraxScene.projectionPositions`, mesh order, current rotation, hover state, camera position, selected node, modal state, and other renderer-owned state are excluded.

The preferred layout is included because it already lives in the canonical settings record. This is a persisted preference, not transient UI state.

If no layout-node records currently exist, the exported `layoutNodes` collection remains an empty array. Import must not manufacture renderer coordinates and write them into canonical node records.

## Deterministic output

Export should be deterministic where practical:

- normalize through the canonical graph validators before serialization;
- sort every graph collection by stable record ID;
- emit envelope keys and graph collection keys in a fixed order;
- use consistent two-space JSON formatting and one trailing newline;
- derive a stable, sanitized filename from the universe name and ID.

`metadata.exportedAt` is intentionally time-varying. Tests should compare deterministic graph content and key ordering while treating the export timestamp as expected variable metadata.

## Versioning and compatibility strategy

- `bundleVersion: 1` is the PUX JSON envelope contract.
- `graphSchemaVersion: 1` identifies the graph contract carried by the bundle.
- Record-level `schemaVersion` remains `1`.
- Unsupported bundle versions are rejected before graph parsing.
- Unsupported graph schema versions are rejected before mutation.
- PUX-005 adds no graph-schema migration.
- PUX-005 adds no IndexedDB database migration.

Future bundle versions may introduce envelope migrations independently from graph migrations. No silent best-effort conversion of unknown future structural versions is allowed.

## Legacy PUX-002 and PUX-003 snapshots

Version-1 snapshots from earlier milestones may lack the PUX-003 universe root or one or more default root `contains` edges. The existing `upgradeGraphSnapshot()` function already provides the correct application-level normalization path:

1. validate the supplied version-1 records and references;
2. add a deterministic root only when none exists;
3. add a deterministic default root edge only when one is missing;
4. require exactly one root and exactly one default root edge for every non-root node in the final candidate.

This allows valid PUX-002 and early PUX-003 snapshots to import without an IndexedDB version change. It does not repair duplicate roots, malformed references, invalid root edges, unsupported types, or conflicting IDs.

The bundle parser may accept either the canonical PUX-005 envelope or an explicitly identified legacy version-1 raw graph snapshot. It must not guess that an arbitrary JSON object is a legacy snapshot merely because it contains arrays.

## Import behavior: replace only

PUX-005 import will **replace the current local universe** after complete validation and explicit user confirmation.

Merge is not required by the canonical roadmap. Supporting merge would require additional unresolved policies for:

- duplicate and conflicting IDs;
- origin-ID collisions;
- root selection;
- universe-ID collision or remapping;
- provenance reconciliation;
- settings precedence;
- layout and layout-node conflicts;
- edge deduplication;
- conflict reporting and undo history.

Those policies overlap later synchronization and multiple-universe work. PUX-005 must not implement merge or a hidden merge-like remapping path.

Because the current application is a single-universe local product, a PUX-005 bundle must contain exactly one universe. Multi-universe import is deferred to the roadmap's later portability milestone.

## Complete validation before mutation

Validation must occur in an isolated candidate path before confirmation, active-store mutation, IndexedDB clearing, or scene replacement.

Required sequence:

1. enforce a conservative file-size limit;
2. read the selected file as text;
3. parse JSON and reject malformed JSON;
4. validate the envelope object, format marker, and bundle version;
5. validate graph schema version;
6. require exactly one universe for PUX-005;
7. normalize records using the existing constructors;
8. run `upgradeGraphSnapshot()` for supported legacy version-1 topology;
9. run strict `validateGraphSnapshot(..., { requireUniverseRoots: true })`;
10. generate a non-destructive import summary;
11. ask the user to confirm replacement;
12. only then begin the committed replacement mutation.

No validation error may alter the active store, IndexedDB, selection, preferred layout, or scene.

## Unknown and unsupported data

Unknown node, edge, layout, provenance, or structural types are rejected. The import path must not accept them merely because the renderer has a visual fallback.

Unknown structural collections or alternate topology fields are not trusted. Known records are reconstructed through canonical constructors, which preserve supported fields and discard unsupported structural properties.

Safe optional data already supported by schema version 1 is preserved, including node body/URL fields and arbitrary JSON-compatible values inside `settings.values`. Bundle-level `metadata` may retain JSON-compatible extension keys for inspection during the current import operation, subject to size and prototype-safety checks, but unknown envelope metadata must never override graph invariants. PUX-005 does not add arbitrary metadata fields to canonical graph records and therefore does not require a graph-schema bump.

## Rejection rules

The import must reject, before mutation:

- malformed JSON;
- non-object payloads;
- missing or unsupported format markers;
- unsupported bundle versions;
- unsupported graph schema versions;
- zero or multiple universes;
- duplicate universe, node, edge, layout, layout-node, or settings IDs;
- malformed IDs or timestamps;
- unknown node, edge, layout, or provenance types;
- invalid or unsafe link URLs;
- layout coordinates embedded in canonical nodes;
- self-referential edges;
- edges with missing endpoints;
- cross-universe edges;
- layout nodes with missing layout or node references;
- multiple universe roots;
- non-deterministic root identities;
- edges entering a universe root;
- root edges other than root-to-non-root `contains` edges;
- duplicate default root edges;
- final topology without exactly one default root edge per non-root node;
- any payload that fails application-level normalization or strict final validation.

## Atomic persistence and rollback

After validation and confirmation, replacement should use the existing mutation boundary:

- capture the previous validated store snapshot;
- call `store.replaceSnapshot(candidateSnapshot)`;
- validate the resulting store snapshot;
- save the complete candidate through `repository.saveSnapshot()`;
- project the replacement only after persistence succeeds.

`saveSnapshot()` already clears and rewrites all graph object stores inside one IndexedDB read/write transaction. A failed transaction aborts rather than committing a partial replacement.

If persistence fails after the in-memory replacement begins, `commitGraphMutation` restores the previous store snapshot. Because scene projection has not yet run, the rendered universe remains the previous committed universe. The previous database remains intact because the IndexedDB transaction aborted.

If IndexedDB is unavailable and the application is in explicit memory-only mode, import may replace the in-memory universe only after confirmation, but the UI must warn that the import will not survive reload.

## Partial-import failure behavior

There is no partial import state.

- Parse or validation failure: no mutation.
- User cancellation: no mutation.
- Graph replacement failure: restore previous store.
- IndexedDB failure: abort transaction and restore previous store.
- Scene projection failure after successful persistence: classify as a rendering defect, restore the prior persisted and in-memory snapshot when possible, and surface a blocking error rather than leaving canonical and rendered states divergent.

The final implementation should make the last case explicit. The current mutation helper rolls back graph and persistence failures but does not roll back persistence after a post-commit projection exception. PUX-005 should either make full scene replacement non-throwing after prevalidation or add a guarded replacement coordinator that can restore the prior persisted snapshot if projection fails.

## User confirmation and destructive safeguards

Import is destructive replacement and requires a dedicated confirmation surface. It must show at least:

- source filename;
- universe name;
- node count;
- edge count;
- layout count;
- whether legacy normalization will add a root or default edges;
- an explicit statement that the current local universe will be replaced.

The final confirmation control should use destructive styling and remain disabled while validation or replacement is running. Cancel and Escape must close the dialog without mutation. Re-selecting the same file must remain possible by resetting the file input value after each attempt.

## File picker and download behavior

Import should use a browser file input with an `accept` filter covering Prax JSON and standard JSON. Reading should use the selected `File` object and `File.text()`; no filesystem path is exposed to the application.

Export should create a JSON `Blob`, create a temporary object URL, activate a download anchor from a direct user gesture, and revoke the object URL after activation.

Desktop browsers should download a `.prax.json` file. Mobile Safari may present a preview, Files destination, or share sheet rather than a conventional desktop download. That is acceptable if the action remains user-initiated, the file contents are correct, and the UI does not claim a filesystem location it cannot verify.

The import and export controls must remain usable at 390 by 844, with a scrollable confirmation dialog, visible destructive warning, and no horizontal overflow.

## Rendering synchronization after import

Successful import must:

- clear selection and close node-edit state;
- apply the imported preferred layout when supported;
- call full scene replacement only after persistence succeeds;
- dispose all removed node geometries and materials;
- dispose all removed edge geometries and materials;
- create exactly one mesh per imported node;
- create exactly one line per imported edge;
- avoid duplicate registries after repeated imports;
- synchronize edge positions after the imported layout is projected.

`PraxScene.replaceGraph()` already removes registered edges and nodes before adding the new graph and uses the existing disposal paths. PUX-005 tests must prove this behavior for full-universe replacement.

## IndexedDB implications

No database-version migration is justified.

The existing version-1 stores already persist every collection needed by the bundle:

- universes;
- nodes;
- edges;
- layouts;
- layout nodes;
- settings;
- graph metadata.

PUX-005 changes application behavior, serialization, UI, and tests; it does not require a new object store or index. Application-level bundle parsing and graph normalization are sufficient.

## Worker and public API implications

The Worker currently serves static assets and `/api/health` only. PUX-005 should update health metadata to the PUX-005 application version and expose an import/export readiness marker, but it must not add a public mutation or upload API.

No D1, R2, KV, Vectorize, or secret binding is required. The live Worker currently has only the expected assets binding.

## Expected implementation surface

Likely changed or added files:

- `public/js/prax-bundle.js` for pure bundle creation, deterministic serialization, parsing, validation, and legacy adaptation;
- `public/js/app.js` for export, file selection, confirmation, replacement coordination, UI reset, and verification hooks;
- `public/js/graph-mutations.js` only if a replacement coordinator is needed for projection-failure rollback;
- `public/js/scene.js` for any bulk-replacement hardening required by tests;
- `public/index.html` and `public/styles.css` for import/export controls and confirmation UI;
- `test/prax-bundle.test.js`;
- focused additions to graph-store, mutation, repository, scene, and UI-verification coverage;
- `scripts/verify-pux005-live.mjs`;
- `.github/workflows/deploy.yml`;
- `package.json` and lockfile if scripts or verifier dependencies change;
- `src/worker.js` for version and readiness metadata;
- this assessment, followed only after acceptance by PUX-005 verification and roadmap documentation.

## Required local test plan

At minimum:

- export a complete current snapshot;
- stable IDs for universe, root, nodes, edges, layouts, layout nodes, and settings;
- link title and URL round trip;
- note title and body round trip;
- provenance and timestamps round trip;
- deterministic collection ordering;
- one canonical root in output and imported state;
- persisted layout and preferred-layout round trip;
- valid envelope import;
- explicitly supported legacy version-1 snapshot import;
- export, replace, import, and repository reload round trip;
- malformed JSON rejection;
- unsupported bundle-version rejection;
- unsupported graph-schema rejection;
- duplicate node and edge ID rejection;
- multiple-root rejection;
- missing-edge-endpoint rejection;
- invalid root-edge and `contains` topology rejection;
- unsupported node and edge type rejection;
- invalid URL rejection;
- rejection without active-store mutation;
- persistence failure during replacement;
- in-memory rollback after persistence failure;
- prior IndexedDB snapshot preservation after transaction abort;
- scene synchronization after successful import;
- disposal of resources removed by replacement;
- no duplicate meshes or edge lines after repeated import;
- imported graph persistence across reload.

## Deployment plan

1. Run the complete Node test suite.
2. Run syntax checks for every changed JavaScript file and verifier.
3. Run Wrangler dry-run validation.
4. Commit only after local validation passes.
5. Inspect GitHub Actions validation job and every step.
6. Inspect deployment job and result.
7. Run the production PUX-005 Playwright verifier.
8. Upload browser evidence even on verifier failure.
9. Inspect actual failure annotations and logs before classifying any failure.
10. Run independent desktop and mobile visual-browser verification.

## Production live-verification plan

The production verifier must cover:

- `/api/health` version and PUX-005 readiness;
- fresh IndexedDB startup;
- creation of distinctive link and note records;
- export download event and downloaded JSON contents;
- destructive replacement with a different valid universe bundle;
- imported node and edge visibility;
- exact single-root topology;
- no duplicate rendered meshes or lines;
- imported preferred layout;
- reload persistence;
- malformed import rejection without graph change;
- unsupported-version rejection without graph change;
- mobile import/export control and confirmation usability where browser file APIs permit;
- HTTP status;
- console errors;
- page errors;
- failed requests;
- failed responses;
- desktop and mobile overflow.

Injected IndexedDB failure and rollback should be proven deterministically in unit/integration tests. The production verifier should test rollback-sensitive non-mutation paths without adding an unsafe production failure switch.

## Risks and likely regressions

- **Destructive overwrite:** mitigated by isolated validation, import summary, and explicit confirmation.
- **Partial IndexedDB replacement:** mitigated by the existing single read/write transaction.
- **Store ahead of persistence:** mitigated by the existing prior-snapshot rollback boundary.
- **Scene ahead of persistence:** prevented by projecting only after save succeeds.
- **Persistence committed but scene replacement throws:** requires explicit coordinator hardening or a proven non-throwing prevalidated projection path.
- **Legacy snapshot over-repair:** normalization may add only deterministic missing root structures; it must not repair conflicting topology.
- **Multiple universes:** rejected in PUX-005 because current UI and roadmap are single-universe.
- **Unknown structural data:** rejected or normalized away; never allowed to redefine graph invariants.
- **Unknown optional metadata loss:** preserve schema-supported optional values and safe envelope metadata, but do not introduce arbitrary record fields without a schema version.
- **Large import blocking the UI:** enforce a file-size limit, disable repeated actions, and surface progress state.
- **Mobile download differences:** verify actual browser behavior and avoid false claims about save location.
- **Duplicate render resources:** use full registry replacement and test repeated imports.
- **Roadmap drift:** do not mark PUX-005 complete until all acceptance, deployment, production, and visual checks pass.

## Implementation gate

PUX-005 may proceed with these fixed decisions:

- import behavior is replace-only;
- one universe per bundle;
- bundle version and graph schema version are independent;
- the complete canonical graph snapshot is exported;
- persisted layouts and settings are included;
- transient renderer and modal state are excluded;
- legacy version-1 topology may be normalized only through existing deterministic rules;
- all validation occurs before destructive persistence;
- no IndexedDB database-version migration is introduced;
- no Worker mutation API is introduced;
- PUX-006 is not started.
