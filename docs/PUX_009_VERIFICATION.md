# PUX-009 Verification — Adaptive Node Hit Testing

**Status:** Accepted — implementation, automated validation, guarded preview, and physical-iPhone manual testing complete  
**Working branch:** `pux-009-adaptive-hit-testing`  
**Starting commit:** `dbc28c0ebb297ba1dcd6dae70917c4fd3be4bea2`  
**Accepted implementation commit:** `71601db1049f9816019648e676416f2dc3bca1ea`  
**Application version:** `0.2.0-pux.9`  
**Validation workflow:** `Validate PUX-009`  
**Automated branch run:** `29881727101`  
**Guarded preview run:** `29881902994`  
**Guarded preview alias:** `pux-009`  
**Canonical roadmap stone before closeout:** `aa3c841fc85c3d963303d6f7c95a9966e2af1cf1e00fedc5ea4bea1e168cff07`

## Delivered behavior

PUX-009 replaces the fixed coarse-pointer selection fallback with adaptive, renderer-only hit testing while preserving the normal Three.js raycast as the authoritative selection path.

- `public/js/adaptive-hit-testing.js` exports pure calculations for projected node radius, adaptive effective hit radius, normalized boundary distance, and deterministic candidate selection.
- Perspective and orthographic cameras are supported using camera field of view or zoom, camera distance, world scale, geometry bounds, and viewport CSS height.
- Device pixel ratio is normalized exactly once and pointer comparisons remain in CSS pixels.
- Adaptive fallback runs only for touch or pen input after the normal raycast misses.
- Mouse selection remains precise and raycast-only.
- Touch and pen policies use bounded padding and minimum/maximum effective radii without changing visible node geometry.
- Overlapping fallback candidates are ranked by normalized distance from the rendered boundary, projected depth, and stable node ID.
- Tap-versus-drag rejection remains a separate deterministic threshold from hit radius.
- Sphere, grid, Searchlight, and Galaxy Focus behavior remain compatible.

## Automated validation

GitHub Actions run `29881727101` completed successfully at accepted implementation commit `71601db1049f9816019648e676416f2dc3bca1ea`.

It passed:

- the complete Node test suite;
- JavaScript syntax checks;
- Wrangler validation;
- PUX-006 desktop and mobile browser regression verification;
- PUX-007 Searchlight browser regression verification;
- PUX-008 Galaxy Focus browser regression verification;
- PUX-009 desktop and DPR-3 mobile browser verification;
- browser evidence artifact upload.

The PUX-009 unit coverage includes:

- DPR 1, 2, and 3;
- perspective and orthographic projection;
- multiple zoom levels;
- small/far and large/near nodes;
- touch and pen adaptive policies;
- normalized boundary ranking;
- depth and stable-node-ID tie breaking;
- raycast precedence;
- mouse precision;
- drag rejection;
- sphere and grid projections;
- Searchlight and Galaxy Focus compatibility;
- graph immutability.

## Guarded preview validation

Workflow-dispatch run `29881902994` completed successfully for preview alias `pux-009` at accepted implementation commit `71601db1049f9816019648e676416f2dc3bca1ea`.

The preview job passed:

- feature-preview boundary enforcement;
- non-production Worker version upload;
- remote PUX-006 regression verification;
- remote PUX-008 Galaxy Focus regression verification;
- remote PUX-009 adaptive-hit-testing verification;
- desktop 1440 × 900 at DPR 1;
- iPhone-sized 390 × 844 at DPR 3;
- raycast-miss adaptive touch selection;
- fine-pointer mouse precision;
- sphere and grid behavior;
- Searchlight and Galaxy Focus behavior;
- graph-count and graph-content invariants;
- overflow, console, page, request, response, and HTTP checks.

No production traffic change or production deployment was performed.

## Physical-iPhone manual acceptance

On July 21, 2026, the user completed manual PUX-009 testing on the guarded preview and reported that PUX-009 passed.

This satisfies the roadmap requirement for explicit physical-iPhone validation and user acceptance before graph-schema work begins.

## Preserved invariants

PUX-009 does not change:

- graph schema version 1;
- IndexedDB database version 1;
- Prax bundle envelope version 1;
- canonical universe, node, edge, provenance, timestamp, or layout records;
- universe-root membership relationships;
- node identity or visible node size;
- public mutation routes;
- Worker stateful bindings;
- Searchlight exact-local-search semantics;
- Galaxy Focus membership or restoration semantics;
- production routing.

Raycasting remains authoritative. Adaptive selection is a touch/pen-only fallback after a miss, and drag/orbit gestures remain rejected independently.

## Accepted boundary and next milestone

The accepted PUX-009 implementation boundary is commit `71601db1049f9816019648e676416f2dc3bca1ea`.

PUX-010 may now begin as a separate milestone for child node hierarchy. PUX-010 is the first graph-schema migration after PUX-009 and must preserve these boundaries:

- introduce graph schema version 2;
- keep IndexedDB database version 1;
- keep Prax bundle envelope version 1;
- use directed `parent_of` edges from parent to child;
- preserve exactly one universe-root `contains` membership edge for every non-root node;
- enforce a single-parent, acyclic forest;
- reject cycles, duplicate relationships, multiple parents, cross-universe hierarchy, self-edges, and universe-root hierarchy endpoints;
- create the child node, root-membership edge, and parent edge atomically;
- validate the complete snapshot before persistence;
- restore and re-persist the previous graph and fully restore the previous scene after projection failure;
- never cascade-delete children by default;
- keep initial child placement transient in renderer state;
- require desktop, mobile, guarded-preview, persistence, import/export, rollback, and physical-iPhone verification before acceptance.

Do not begin PUX-011 or later milestones until PUX-010 is independently accepted.
