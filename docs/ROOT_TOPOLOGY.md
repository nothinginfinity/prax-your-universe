# Prax Universe Root and Typed Edge Rendering

**Release:** PUX-003  
**Graph schema version:** `1`  
**IndexedDB version:** `1`

## Canonical universe root

Every universe has exactly one canonical root node.

The root uses:

- `nodeType: "universe_root"`
- deterministic origin: `universe-root:<universeId>`
- deterministic node ID derived from the universe ID, node type, and origin
- system provenance:
  - `sourceType: "system"`
  - `sourceId: "prax-universe-root-v1"`
  - `createdBy: "prax"`

For the default production universe, the root ID is:

`node_4b932692f8596023bd2e18f70836f578`

The root is not created through ordinary link or note mutation APIs. `GraphStore` rejects attempts to add another managed root.

## Default edge policy

Every canonical non-root node in a universe receives exactly one explicit edge:

`universe_root --contains--> node`

The edge type is the existing validated `contains` type. No vague fallback edge type is introduced.

Default root edges use system provenance:

- `sourceType: "system"`
- `sourceId: "prax-default-root-edge-v1"`
- `createdBy: "prax"`

The seed instruction nodes are included in this policy. Historical PUX-002 nodes are also connected during upgrade because the root edge represents universe membership, not a user-authored semantic claim.

A node may still acquire additional explicit relationships such as `references` or `related_to` later.

## Backward-compatible graph upgrade

PUX-003 does not change the IndexedDB object-store structure, so the database remains version `1`.

Startup performs an application-level graph-data normalization:

1. Read and validate the existing PUX-002 snapshot using backward-compatible validation.
2. Detect the deterministic root for each universe.
3. Create the root when missing.
4. Reuse an existing valid root when present.
5. Add a missing root `contains` edge for every non-root node.
6. Preserve all existing universe, node, edge, layout, layout-node, settings, IDs, timestamps, and provenance records.
7. Strictly validate the completed topology.
8. Persist the upgraded snapshot in one IndexedDB transaction.
9. Construct `GraphStore` and hydrate the scene from the upgraded canonical graph.

If the upgrade write fails, the previous IndexedDB commit remains intact. Prax continues in memory-only mode using the loaded graph upgraded in memory.

## Mutation boundary

User node creation follows this order:

1. Capture the previous `GraphStore` snapshot.
2. Create the canonical node.
3. Create or reuse its default root edge.
4. Strictly validate the complete graph.
5. Persist the complete snapshot.
6. Project the node and edge into Three.js.

A node-creation, edge-creation, validation, or persistence failure restores the previous in-memory snapshot. The failed node and edge are not projected, and the prior IndexedDB commit remains unchanged.

## Rendering ownership

Canonical edge records live in `GraphStore` and IndexedDB. Three.js is only a projection.

`PraxScene` maintains:

- `meshByNodeId` for node render objects
- `edgeObjectById` for explicit edge render objects
- one `THREE.Line` per current explicit edge
- a shared graph group containing both node and edge groups

One line per edge is intentionally used for the current expected graph size. It provides stable edge IDs, simple deletion, and direct endpoint updates without introducing a force-directed system or rebuilding all edges every animation frame.

## Synchronization lifecycle

Sphere and grid positions are recalculated deterministically during scene layout.

After node positions change, `PraxScene.syncEdgePositions()` updates the two vertices of each affected line. Both node and edge groups share the same rotating graph transform, so sphere rotation does not separate edges from their endpoints.

Edges are synchronized when:

- nodes are added or removed
- edges are added or updated
- the scene graph is replaced
- the projection switches between sphere and grid
- layout positions are recalculated

Current movement is immediate rather than tweened. Future animated layouts should update edge geometry at the same position-update lifecycle point rather than turning render state into graph truth.
