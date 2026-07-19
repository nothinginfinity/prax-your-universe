# Prax Local Persistence

**Release:** PUX-002  
**Database:** `prax-your-universe`  
**IndexedDB version:** `1`  
**Graph schema version:** `1`

## Purpose

PUX-002 makes the client graph durable without introducing cloud storage or a public mutation API. The browser restores the validated graph before the Three.js scene is populated, so the scene remains a projection of canonical client state rather than a storage layer.

IndexedDB data is local to the current browser profile and origin. It is not synchronized between devices and is not a substitute for the authenticated D1 layer planned for v0.3.

## Object stores

The database uses normalized object stores rather than one opaque snapshot record:

- `universes`
- `nodes`
- `edges`
- `layouts`
- `layout_nodes`
- `settings`
- `meta`

Every graph record store uses the record `id` as its key path. Universe-scoped stores include a `by_universe` index. Edges also include endpoint indexes, and layout-node records include layout and node indexes.

The `meta` store records the current graph schema version, IndexedDB version, and the time of the most recent successful snapshot commit.

## Startup behavior

Application startup follows this order:

1. Create the deterministic seed snapshot in memory.
2. Open IndexedDB and run any required database migrations.
3. Read every canonical graph collection in one read-only transaction.
4. Validate the reconstructed snapshot with `validateGraphSnapshot()`.
5. Use the stored graph when one exists.
6. Otherwise atomically write and return the deterministic seed graph.
7. Construct `GraphStore` from the validated snapshot.
8. Restore the preferred sphere or grid projection.
9. Populate the Three.js scene.

The scene never reads IndexedDB directly.

## Write behavior

Each graph save is a complete validated snapshot transaction across all graph stores and `meta`.

Before a transaction starts:

- the graph snapshot is normalized and validated;
- duplicate identities and missing references are rejected;
- malformed data cannot clear or partially replace the previous database state.

During a transaction:

- all graph stores are cleared and rewritten inside one `readwrite` transaction;
- the transaction commits only after every request succeeds;
- an aborted or failed request leaves the previous committed graph intact.

The application also keeps a pre-mutation `GraphStore` snapshot. A failed persistence operation restores that snapshot and does not project the failed change into the scene.

## Preferences

The currently selected sphere or grid view is stored in the canonical settings record as `preferredLayout`. It is restored before nodes are laid out during startup.

Projection coordinates remain renderer-owned in PUX-002. Durable `layout_nodes` records are supported by the repository but will be populated by later layout work.

## Database migrations

IndexedDB migrations are versioned in `indexeddb-repository.js`.

- Each database version must have one explicit migration function.
- Migrations run sequentially from `oldVersion + 1` through the requested version.
- Opening a database version without a matching migration fails closed with `missing_migration`.
- An upgrade blocked by another open tab returns `upgrade_blocked`.
- A version-change event closes the current database connection so another tab can upgrade safely.

Graph-record schema migrations are separate from IndexedDB structure migrations. PUX-002 validates schema version 1. Broader graph-data migration fixtures remain in PUX-006.

## Failure and recovery behavior

When IndexedDB is unavailable during startup, Prax remains usable in memory-only mode and displays `Memory only` in the status pill. No persistence success is implied.

When a later transaction fails:

- the failed mutation is rolled back in `GraphStore`;
- the previous IndexedDB commit remains intact;
- the scene is not updated with the failed mutation;
- the user receives a save-failure message.

Recovery for a blocked database upgrade is to close other Prax tabs and reload. Destructive reset and JSON import/export workflows are intentionally deferred to PUX-005 and PUX-006.

## Scope boundary

PUX-002 does not add:

- D1, KV, Vectorize, R2, or Workers AI;
- cloud synchronization;
- authentication;
- public mutation APIs;
- root-node edge creation;
- visible edge rendering;
- node edit or delete UI;
- JSON import or export.

Those remain separate roadmap work packages.
