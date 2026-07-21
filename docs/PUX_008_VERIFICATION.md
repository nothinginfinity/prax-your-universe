# PUX-008 Verification - Galaxy Focus

**Status:** Implementation and non-production preview verified; final CairnStone acceptance pending  
**Working branch:** `pux-008-galaxy-focus`  
**Starting commit:** `0a51e063fa6adbae358ed70e49035948f0dc7650`  
**Rollback boundary:** `d234123e55b634eb0e9020638279acc76e7cc1cb`  
**Accepted implementation commit:** `8b6333f3902e1e1a905b6c871629c1f9a9902ff2`  
**Application version:** `0.2.0-pux.8`  
**Stable preview:** `https://pux-008-prax-your-universe.jaredtechfit.workers.dev`  
**Workflow:** `Validate PUX-006`  
**Implementation push run:** `29857617595`  
**Preview verification run:** `29857846017`

## Delivered behavior

PUX-008 adds Galaxy Focus as transient presentation state layered over the existing Prax scene and navigation foundation.

- `public/js/galaxy-focus.js` computes deterministic focus membership, context membership, edge visibility, and presentation metadata without mutating graph records.
- `public/js/galaxy-scene.js` extends the existing scene through composition while leaving `public/js/scene.js` unchanged.
- `public/js/galaxy-focus-controller.js` owns focus, back, reset, Escape, restoration, and reduced-motion behavior.
- `public/js/app.js` integrates Focus, Back, and Reset View controls and exposes the PUX-008 verification surface.
- Desktop and touch-mobile controls include accessible labels, pressed/hidden state, live status, keyboard Escape support, and viewport-safe layout.

## Local and workflow validation

The implementation was validated before GitHub mutation with all nine PUX-008 unit tests passing and the required JavaScript parse checks passing.

GitHub Actions run `29857617595` completed successfully at implementation commit `8b6333f3902e1e1a905b6c871629c1f9a9902ff2`. It passed:

- the complete Node test suite;
- JavaScript syntax checks;
- Wrangler deployment dry-run;
- PUX-006 desktop and mobile regression verification;
- PUX-007 desktop and mobile Searchlight verification;
- PUX-008 desktop and mobile Galaxy Focus verification;
- browser evidence artifact upload.

## Non-production preview verification

Workflow-dispatch run `29857846017` completed successfully for preview alias `pux-008` at implementation commit `8b6333f3902e1e1a905b6c871629c1f9a9902ff2`.

The guarded preview job passed:

- feature-preview boundary enforcement;
- non-production Worker version upload;
- remote PUX-006 regression verification;
- remote PUX-008 Galaxy Focus verification;
- verification summary and artifact upload.

No production deployment was performed.

## Independent live evidence

A separate deterministic visual-browser audit opened the stable preview with `?puxTest=008` after the workflow completed.

### Desktop

- receipt: `vb_21803932`;
- viewport: 1440 x 1000;
- HTTP status: 200;
- final title: `Prax — Your Universe`;
- page dimensions matched the viewport with no horizontal or vertical overflow;
- 24 controls were exposed to the accessibility capture;
- console errors: 0;
- page errors: 0;
- failed requests: 0;
- failed responses: 0;
- screenshot SHA-256: `97f8d57f0994ad6a17ae2ec18a65a41c551d7b0e84f84b5be6c2ce57bfd00059`.

### Touch mobile

- receipt: `vb_10ff2284`;
- viewport: 390 x 844 at device scale factor 3;
- HTTP status: 200;
- final title: `Prax — Your Universe`;
- page dimensions matched the viewport with no horizontal or vertical overflow;
- 24 controls were exposed to the accessibility capture;
- console errors: 0;
- page errors: 0;
- failed requests: 0;
- failed responses: 0;
- screenshot SHA-256: `df6a54cd7b44b4d20487f3d8229abe99848f6feb2cc4000612c36e3c545ea019`.

## Preserved invariants

A recursive Git tree comparison between starting commit `0a51e063fa6adbae358ed70e49035948f0dc7650` and implementation commit `8b6333f3902e1e1a905b6c871629c1f9a9902ff2` confirmed that the following protected blobs are byte-for-byte unchanged:

- `public/js/scene.js`;
- `public/js/graph-schema.js`;
- `public/js/graph-store.js`;
- `public/js/indexeddb-repository.js`;
- `public/js/prax-bundle.js`;
- `src/worker.js`;
- `wrangler.jsonc`.

PUX-008 therefore does not change:

- graph schema version 1;
- IndexedDB database version 1;
- Prax bundle version 1;
- universe, node, or edge identity;
- canonical graph relationships;
- canonical coordinates or persistence records;
- public mutation routes.

Galaxy Focus membership, emphasis, camera movement, and restoration remain transient scene presentation state.

## User-confirmed deployment state

On July 21, 2026, the user reported that the GitHub deployment workflows were green. This is recorded as user-supplied confirmation and is supported independently by the GitHub Actions API results above.

## Branch and production boundaries

The branch was created directly from `0a51e063fa6adbae358ed70e49035948f0dc7650`. At implementation verification time it was four commits ahead and zero commits behind that base.

`main` remained at `54bfd10403b0530414276736cfde569c3d6043c5` throughout implementation and preview validation. No merge to `main`, force update, production deployment, graph migration, or canonical-data rewrite was performed.
