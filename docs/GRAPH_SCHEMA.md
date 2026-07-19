# Prax Client Graph Schema

**Work package:** PUX-001 — Client graph schema  
**Schema version:** 1  
**Release marker:** `0.2.0-pux.1`

## Purpose

This document defines the storage-independent client graph contract used before IndexedDB, D1, Vectorize, or AI features are introduced.

The graph is canonical. The Three.js scene is a projection of the graph. A scene position, mesh order, color, camera state, or semantic similarity result must never define node identity or prove a graph relationship.

## Record collections

A version 1 graph snapshot contains:

- `universes`
- `nodes`
- `edges`
- `layouts`
- `layoutNodes`
- `settings`

Every record includes:

- `id`
- `originId`
- `kind`
- `schemaVersion`
- `createdAt`
- `updatedAt`
- `provenance`

Timestamps are normalized ISO-8601 strings. `updatedAt` cannot precede `createdAt`.

## Identity

Prax identity is stable across mutable content changes.

Locally created records receive an immutable `originId`. Their canonical ID is derived deterministically from:

- record kind;
- universe identity where applicable;
- type and relationship identity where applicable;
- immutable origin identity.

Changing any of these fields must not change an existing record ID:

- title;
- URL;
- body;
- layout position;
- camera state;
- visual style.

Validated imported IDs are preserved. An import must never silently replace a supplied ID with a content-derived ID.

The current deterministic function provides repeatable local identity, not a cryptographic content proof. Content hashing and embedding-version metadata belong to later releases.

## Provenance

Version 1 provenance contains:

```json
{
  "sourceType": "system | user | import",
  "sourceId": "stable source reference",
  "createdBy": "actor reference"
}
```

Provenance describes where a record originated. It does not replace explicit edges.

## Universe record

A universe record defines one graph namespace.

Required domain fields:

- `name`

PUX-001 creates a stable default universe record. PUX-003 adds one canonical node with `nodeType: "universe_root"` as the visible and topological root for each universe.

## Node record

Required domain fields:

- `universeId`
- `nodeType`
- `title`

Optional domain fields:

- `body`
- `url`

Supported node types:

- `universe`
- `universe_root`
- `link`
- `note`
- `project`
- `document`
- `conversation`

Only link nodes may contain a URL. Link URLs must use HTTP or HTTPS.

Canonical nodes must not contain coordinates or layout fields such as `x`, `y`, `z`, `position`, `positions`, `coordinates`, or `layoutId`.

## Edge record

Required domain fields:

- `universeId`
- `edgeType`
- `fromNodeId`
- `toNodeId`

Supported edge types:

- `contains`
- `references`
- `belongs_to`
- `related_to`
- `created_from`

A universe root may only originate `contains` edges to non-root nodes in the same universe. Strict PUX-003 snapshots require exactly one deterministic root per universe and one root `contains` edge for every non-root node.

Both endpoints must exist in the same universe. Version 1 rejects self-referential edges.

Semantic similarity is not an edge type. Future semantic suggestions must remain visually and structurally separate until explicitly confirmed.

## Layout record

Required domain fields:

- `universeId`
- `layoutType`
- `name`

Supported initial layout types:

- `sphere`
- `grid`
- `custom`

A layout describes a projection. It does not alter canonical graph topology.

## Layout-node record

Required domain fields:

- `universeId`
- `layoutId`
- `nodeId`
- `position.x`
- `position.y`
- `position.z`

Coordinates belong only to layout-node records or temporary renderer-owned projection state.

PUX-001 keeps active sphere and grid positions inside `PraxScene.projectionPositions`. PUX-002 will persist validated layout-node records in IndexedDB.

## Settings record

Required domain fields:

- `universeId`
- `values`

The values object contains rebuildable client preferences such as the preferred layout. Settings must not contain canonical graph relationships.

## GraphStore boundary

`GraphStore` owns canonical in-memory collections and validates all inserted or replaced records.

Current boundaries:

- `replaceSnapshot()` validates before mutation;
- `snapshot()` returns a validated immutable graph snapshot;
- `addNode()` validates canonical node records;
- `addLink()` is a compatibility command for the existing link form;
- `addEdge()` requires valid same-universe endpoints;
- collection reads return immutable record objects.

`GraphStore` contains no IndexedDB, Worker API, D1, Vectorize, or scene implementation.

## Scene boundary

The Three.js scene stores only renderer metadata in mesh `userData`:

- `nodeId`
- `nodeType`

Canonical titles, URLs, bodies, provenance, and relationships remain in `GraphStore`.

The scene maintains:

- `meshByNodeId` for stable renderer lookup;
- `projectionPositions` for temporary sphere and grid coordinates.

Mesh order may influence a temporary layout calculation but never node identity.

## Validation and migration boundary

Version 1 rejects:

- unsupported schema versions;
- unknown node, edge, layout, or provenance types;
- malformed IDs;
- invalid timestamps;
- invalid or unsafe link protocols;
- layout fields inside canonical nodes;
- duplicate IDs inside snapshots;
- missing universe, node, or layout references;
- invalid edge endpoints.

PUX-002 will add IndexedDB initialization, transactions, startup hydration, and versioned upgrade functions. It must call the same schema validators before committing upgraded data.

## PUX-001 completion boundary

PUX-001 establishes contracts and tests only. It does not add:

- IndexedDB persistence;
- the visible universe root node;
- edge rendering;
- node editing or deletion;
- import/export UI;
- D1, KV, Vectorize, R2, or Workers AI;
- authentication or writable cloud APIs;
- Searchlight or Galaxy Focus.
