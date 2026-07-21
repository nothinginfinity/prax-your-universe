# PUX-007 Implementation Assessment

**Branch:** `pux-006-validation-tests`  
**Starting commit:** `5343c342a3c7749619177a4349fbbeaa3a0c65ad`  
**Scope:** Searchlight and shared navigation foundation

## Existing boundaries

- Search UI and exact search did not exist.
- `public/js/app.js` owned selected-node UI state and modal orchestration.
- `public/js/scene.js` owned Three.js meshes, edges, camera, OrbitControls, and projection changes.
- `GraphStore.listConnectedEdges()` exposed canonical explicit edges without semantic inference.
- Sphere and grid were deterministic projections of canonical graph records.
- `scene.layout()` reset the camera, so camera state needed to be separated from graph layout before restoration could be reliable.

## Minimal implementation

- Add pure exact local search for title, body, URL, and node type.
- Add deterministic current-result, next, previous, and wrap behavior.
- Add pure immediate-neighborhood lookup from explicit edges only.
- Add reusable camera capture, destination, interpolation, restoration, and reset helpers.
- Add scene-only highlighting and dimming without changing graph records or canonical coordinates.
- Capture camera, selection, and projection once when Searchlight begins.
- Escape and explicit dismissal restore the captured state.
- Reset View clears Searchlight and returns to the default camera for the current projection.
- Respect `prefers-reduced-motion` with immediate camera changes.
- Keep mobile search controls inside the visual viewport with a 16px input font to avoid iOS input zoom.

## Files

Modified:

- `public/index.html`
- `public/styles.css`
- `public/js/app.js`
- `public/js/scene.js`
- `package.json`
- `package-lock.json`
- `src/worker.js`
- `.github/workflows/validate-pux006.yml`

Added:

- `public/js/searchlight.js`
- `public/js/camera-navigation.js`
- `public/js/graph-navigation.js`
- `test/pux007-searchlight.test.js`
- `scripts/verify-pux007-local.mjs`

## Verification

Unit tests cover exact fields, non-semantic behavior, deterministic result traversal, explicit-edge neighborhoods, navigation snapshots, and camera interpolation.

Browser verification covers desktop Chromium and touch-mobile Chromium, title/body/URL/type search, next/previous controls, active emphasis, unrelated dimming, explicit-edge emphasis, camera movement, Escape restoration, Reset View, reduced motion, keyboard focus, and horizontal overflow.

## Rollback boundary

PUX-007 changes only UI, transient navigation state, and scene presentation. It does not change schema version 1, IndexedDB version 1, bundle version 1, node identity, edge identity, canonical coordinates, explicit relationships, or public mutation routes.
