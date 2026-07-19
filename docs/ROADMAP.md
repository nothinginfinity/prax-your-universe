# Prax — Spatial Knowledge Graph Roadmap

**Project:** `nothinginfinity/prax-your-universe`  
**Live application:** `https://prax-your-universe.jaredtechfit.workers.dev`  
**Roadmap status:** Canonical planning document  
**Updated:** July 18, 2026

## 1. North star

Prax will become a personal spatial knowledge system: a navigable universe of conversations, notes, links, documents, repositories, projects, people, sources, and AI-generated artifacts.

The product replaces the traditional linear history sidebar with a persistent knowledge graph. Users should be able to move from an entire galaxy of projects to one specific idea, source, conversation turn, or file without leaving the same spatial interface.

The long-term experience is:

1. Capture or import knowledge.
2. Preserve its source, meaning, and relationships.
3. Find it through exact search, semantic search, or graph traversal.
4. Navigate to it spatially.
5. Ask questions against the graph.
6. Watch new knowledge appear as connected nodes in real time.

The Three.js scene is a projection of the graph, not the canonical database.

## 2. Current baseline — v0.1 Live Foundation

### Completed

- Public Cloudflare Worker deployment.
- Static asset serving through the Worker.
- Modular frontend structure.
- Three.js sphere and grid projections.
- Orbit, hover, selection, and node details.
- In-session link creation.
- Safe HTTP/HTTPS URL validation.
- Mobile pointer-event support.
- Explicit client graph-store boundary.
- API-client boundary for future persistence.
- `/api/health` Worker endpoint.
- GitHub Actions deployment workflow.
- Preserved original standalone prototype.
- Architecture and deployment documentation.

### Current limitations

- Added nodes disappear after refresh.
- Nodes do not yet have durable edges.
- Search is not implemented.
- The application has no authentication.
- D1, KV, Vectorize, R2, and Workers AI are not bound.
- The live API must remain read-only until authentication exists.
- Coordinates currently represent a session layout rather than a versioned projection.

## 3. Product and architecture invariants

These rules apply across every release.

1. **D1 becomes canonical state.** Nodes, edges, provenance, ownership, layouts, and migration state live in D1 once cloud persistence begins.
2. **Vectorize is a semantic index.** Similarity results are candidates, not trusted graph relationships.
3. **KV is disposable cache.** Anything stored in KV must be rebuildable from canonical storage.
4. **Coordinates are projections.** X/Y/Z values belong to versioned layouts and must never be the only representation of graph structure.
5. **Edges are explicit and typed.** Deterministic, user-confirmed, and machine-suggested relationships must remain distinguishable.
6. **Stable identity precedes AI.** Node IDs, content hashes, provenance, and graph deltas must be reliable before semantic or chat layers are added.
7. **No public mutation API before authentication.** The public Worker must not expose writable personal graph routes without an authorization boundary.
8. **Every schema change is versioned.** D1 changes require committed, repeatable migrations.
9. **AI output carries provenance.** Model, provider, time, source context, and generation method must be inspectable.
10. **A successful deploy is not proof of correctness.** Each release requires local validation, workflow inspection, and live endpoint/browser verification.

## 4. Release roadmap

## v0.2 — Persistent Spatial Graph

**Goal:** Make Prax useful without cloud storage or AI.

The user should be able to build a small universe, refresh the page, search it, navigate directly to a result, and preserve the same graph.

### v0.2.0 — Local graph core

- Define a versioned client graph schema.
- Add deterministic node and edge IDs.
- Add a central `universe` root node.
- Add typed edges and visible edge rendering.
- Store nodes, edges, settings, and layouts in IndexedDB.
- Restore the universe automatically after refresh.
- Add node creation for:
  - link
  - note
  - project
  - document placeholder
  - conversation placeholder
- Add edit and delete operations.
- Add validation and schema migration handling for local data.
- Add JSON import and export.

### v0.2.1 — Searchlight

- Add a search bar.
- Support exact title, URL, type, and body-text matching.
- Display result count.
- Add next and previous result controls.
- Add camera fly-to.
- Highlight the active result.
- Dim unrelated nodes.
- Show the selected node's immediate neighborhood.
- Add reset-view behavior.

### v0.2.2 — Galaxy Focus and spatial usability

**Signature experience:** Selecting a node temporarily reorganizes the visible universe around the user's current thought without mutating the canonical graph.

- Add hover labels and a persistent selected-node label.
- Add node-type visual identities.
- Add **Galaxy Focus** as a named projection state.
- Fly the camera smoothly toward the focused node.
- Move directly connected nodes into a readable local orbit.
- Preserve deterministic edge relationships while the focused layout is active.
- Display second-degree or semantically suggested nodes as a visually distinct outer halo when that data is available.
- Fade, dim, or push unrelated nodes into the background without deleting or disconnecting them.
- Keep the selected node and its explicit neighborhood inspectable throughout the transition.
- Provide Back, Escape, and Reset View actions that restore the prior projection and camera state.
- Prevent repeated focus actions from stacking irreversible transforms.
- Add reduced-motion behavior and an immediate-transition accessibility fallback.
- Improve mobile tap targets and modal behavior.
- Add keyboard navigation and accessibility fallbacks.
- Add saved layout preferences.
- Add basic rendering budgets and level-of-detail behavior.
- Add empty-state and recovery UI.

Galaxy Focus is a projection and interaction mode. It must not rewrite node identity, canonical coordinates, explicit edges, or semantic-index data.

### v0.2 acceptance criteria

- A user can create, edit, connect, and delete nodes.
- Data survives reloads and browser restarts.
- Import/export round-trips without changing IDs or relationships.
- Search locates a node and flies the camera to it.
- Galaxy Focus reorganizes a selected node's neighborhood without changing canonical graph relationships.
- Exiting Galaxy Focus restores the prior projection and camera state reliably.
- Galaxy Focus remains usable with reduced motion and on mobile-sized screens.
- Sphere and grid views render the same graph state.
- The application remains usable on mobile.
- No cloud mutation endpoint is required.

---

## v0.3 — Secure Cloud Graph

**Goal:** Synchronize an authenticated personal universe through Cloudflare.

### Scope

- Protect the application or private API routes with Cloudflare Access or an equivalent authenticated session boundary.
- Create the D1 database.
- Add committed SQL migrations.
- Introduce canonical tables:
  - users
  - universes
  - nodes
  - edges
  - layouts
  - layout_nodes
  - sync_events
  - schema_migrations
- Add ownership and per-universe authorization checks.
- Add graph snapshot and graph-delta APIs.
- Add create, update, delete, and edge mutation routes.
- Add optimistic concurrency or revision checks.
- Synchronize IndexedDB with D1.
- Preserve offline-first behavior where practical.
- Add export and deletion workflows.
- Add backup and restore documentation.

### Initial API surface

- `GET /api/universes/:id/snapshot`
- `GET /api/universes/:id/deltas`
- `POST /api/nodes`
- `PATCH /api/nodes/:id`
- `DELETE /api/nodes/:id`
- `POST /api/edges`
- `DELETE /api/edges/:id`
- `POST /api/sync`

### v0.3 acceptance criteria

- An unauthenticated user cannot read or mutate a private universe.
- Two authenticated sessions converge on the same canonical graph.
- Local changes can be synchronized without replacing the full universe.
- Every mutation has ownership, revision, timestamp, and provenance information.
- D1 can recreate the user's graph without relying on KV.

---

## v0.4 — Semantic Constellations

**Goal:** Organize and retrieve knowledge by meaning while preserving explicit graph truth.

### Scope

- Bind Workers AI for embeddings.
- Create and bind a Vectorize index.
- Add content hashing and embedding-version records.
- Embed eligible node text.
- Add semantic search.
- Add related-node suggestions.
- Display suggested relationships separately from confirmed edges.
- Allow confirm, reject, or ignore actions.
- Add semantic constellation projection.
- Add hybrid retrieval:
  - lexical matching
  - vector similarity
  - graph traversal
- Add embedding reindex and model-migration workflows.

### v0.4 acceptance criteria

- Meaningfully related nodes can be found without exact keyword overlap.
- Suggested edges never silently become canonical.
- Every vector maps to a stable D1 node ID and embedding version.
- Re-embedding is idempotent when content has not changed.
- Semantic and explicit graph relationships remain visually distinguishable.

---

## v0.5 — Chat-to-Node

**Goal:** Turn every conversation into live graph expansion.

### Scope

- Add a chat surface inside Prax.
- Stream inference from Workers AI or a configured model provider.
- Create a prompt node before inference.
- Create a response node after or during completion.
- Add deterministic `responds_to` and conversation-membership edges.
- Retrieve graph-aware context before generation.
- Embed prompt and response nodes.
- Return graph deltas to the browser.
- Animate new nodes and edges into the current projection.
- Add conversation-tree projection.
- Add model and context provenance to every response.
- Handle partial, failed, cancelled, and retried turns explicitly.

### v0.5 acceptance criteria

- A completed turn produces durable prompt and response nodes.
- Failed turns do not create misleading completed-response records.
- The user can inspect which graph context informed a response.
- Reloading preserves the conversation topology.
- New turns appear without rebuilding the entire scene.

---

## v0.6 — Ingestion and Connectors

**Goal:** Make Prax the spatial entry point for external knowledge.

### Scope

- URL metadata and content ingestion.
- Notes and Markdown import.
- Document upload with R2-backed artifacts.
- GitHub repository, issue, commit, and file ingestion.
- Chat-history import.
- CairnStone chain and stone ingestion.
- AFO page-harness and identity-source ingestion.
- Source deduplication using hashes and canonical URLs.
- Provenance and import receipts.
- Background parsing and embedding jobs.
- Connector-specific refresh policies.

### v0.6 acceptance criteria

- Imported content retains source identity and provenance.
- Duplicate imports do not create uncontrolled duplicate nodes.
- Large artifacts live outside D1 while remaining addressable through graph nodes.
- Import failures are resumable and inspectable.

---

## v0.7 — Spatial Intelligence

**Goal:** Make the universe adapt its geometry to the user's question and task.

### Scope

- Versioned saved projections.
- Semantic constellation layout.
- Chronology spiral.
- Conversation tree.
- Project galaxy.
- Source and provenance map.
- User-curated constellations.
- Timeline playback.
- Cluster labels.
- Progressive level-of-detail rendering.
- Large-graph performance budgets.
- Camera bookmarks and guided paths.
- Contradiction, uncertainty, and confidence views.

### v0.7 acceptance criteria

- Multiple projections render the same canonical graph.
- Changing layouts does not rewrite graph relationships.
- Large universes remain navigable through clustering and level of detail.
- Saved views can be recreated deterministically from layout records.

---

## v0.8 — Multiple Universes, Sharing, and Portability

**Goal:** Support separated contexts and controlled collaboration without sacrificing ownership.

### Scope

- Multiple personal universes.
- Cross-universe references.
- Private, shared, and publishable nodes.
- Role and permission model.
- Shared constellations.
- Optional Durable Object collaboration rooms.
- Real-time presence and serialized mutation streams where needed.
- Portable Prax export bundle.
- Import into a new account or deployment.
- Read-only public universe views.

### v0.8 acceptance criteria

- Private universes remain isolated.
- Shared content has explicit permissions and provenance.
- Exports can reconstruct graph identity, edges, layouts, and artifact references.
- Collaboration does not require converting the entire product into a real-time system.

---

## v0.9 — Trust, Operations, and Release Hardening

**Goal:** Prepare Prax for dependable long-term personal use.

### Scope

- Audit events for meaningful mutations.
- Data export and account deletion.
- Backup and disaster-recovery drills.
- Migration rollback strategy.
- Rate limits and abuse controls.
- Cost and inference observability.
- Privacy-oriented logging defaults.
- Content-security policy and dependency review.
- Automated API, migration, and browser smoke tests.
- Accessibility review.
- Performance testing with realistic graph sizes.
- Operational runbooks.

### v0.9 acceptance criteria

- A user can export and delete their data.
- Recovery procedures are tested rather than merely documented.
- Production logs do not unnecessarily expose private node content.
- Deployments include repeatable smoke tests and rollback instructions.

---

## v1.0 — Personal Knowledge Universe

**Goal:** Deliver a coherent product that replaces fragmented chat history, bookmarks, notes, and project context with one navigable spatial system.

### v1.0 definition

A user can:

- create or import knowledge from several supported sources;
- inspect provenance and relationships;
- search by exact text, meaning, or graph context;
- navigate to results spatially;
- switch between useful projections;
- chat with graph-aware context;
- preserve conversations as connected nodes;
- maintain multiple private universes;
- export their graph in a portable format;
- trust that canonical data is separated from caches, indexes, and layouts.

## 5. Immediate implementation plan

The next active release is **v0.2.0 — Local Graph Core**.

### Work package PUX-001 — Client graph schema — complete

- Define versioned node, edge, layout, and settings records.
- Define deterministic ID rules.
- Define typed-edge validation.
- Add graph-store unit boundaries.

### Work package PUX-002 — IndexedDB repository — complete

- Add database initialization and upgrade handling.
- Persist nodes, edges, layouts, and preferences.
- Hydrate the graph store during application startup.
- Add transaction and error handling.

### Work package PUX-003 — Root node and edges — active

- Create one stable universe root node.
- Connect newly created nodes through explicit default edges.
- Render edges efficiently.
- Keep edge visuals synchronized with layout movement.

### Work package PUX-004 — Node CRUD

- Add link and note creation.
- Add edit and delete.
- Add deletion policy for connected edges.
- Add node-type visual metadata.

### Work package PUX-005 — Import and export

- Define a versioned Prax JSON bundle.
- Export nodes, edges, layouts, and metadata.
- Validate imports before mutation.
- Preserve IDs and provenance during round trips.

### Work package PUX-006 — Validation and tests

- Test persistence after reload.
- Test schema upgrades.
- Test invalid URLs and malformed imports.
- Test edge cleanup and graph integrity.
- Perform desktop and mobile live verification.

### Queued work package PUX-007 — Galaxy Focus

**Dependencies:** PUX-003 root node and edges, plus v0.2.1 Searchlight camera controls.

- Define focused, entering, active, and exiting projection states.
- Capture the previous camera and layout state before entry.
- Compute a stable local neighborhood from explicit graph edges.
- Animate the focused node, direct neighbors, outer halo, and unrelated background groups independently.
- Keep explicit edges visually distinct from future semantic suggestions.
- Add Back, Escape, Reset View, and reduced-motion behavior.
- Test repeated entry and exit without coordinate drift or leaked scene objects.
- Verify performance on desktop and mobile with realistic local graph sizes.

## 6. Build order and dependency gates

```text
v0.2 Local graph correctness
        ↓
v0.3 Authentication + canonical D1 sync
        ↓
v0.4 Embeddings + semantic retrieval
        ↓
v0.5 Chat-to-node generation
        ↓
v0.6 External ingestion
        ↓
v0.7 Advanced spatial projections
        ↓
v0.8 Sharing and portability
        ↓
v0.9 Production hardening
        ↓
v1.0 Personal Knowledge Universe
```

Do not skip the following gates:

- No AI-defined graph before stable node and edge identity.
- No cloud mutation before authentication and authorization.
- No Vectorize dependency before D1 identity and embedding metadata.
- No collaboration system before single-user sync is reliable.
- No large ingestion surface before provenance and deduplication exist.
- No v1.0 claim before export, deletion, recovery, and live verification work.

## 7. Deferred ideas

These ideas fit the vision but are not part of the immediate build:

- immersive VR or AR navigation;
- autonomous graph restructuring without user review;
- public social-network behavior;
- marketplace or third-party connector store;
- generalized multi-tenant enterprise administration;
- fully decentralized graph storage;
- replacing explicit edges with vector proximity;
- real-time collaboration for every interaction.

They should be reconsidered only after the corresponding dependency gates are complete.

## 8. Success metric

The earliest meaningful success metric is not node count or AI usage.

It is this user outcome:

> A person can capture an idea, return later without remembering its exact wording or date, locate it through search or meaning, fly directly to it, inspect why it is connected to nearby knowledge, and continue working from that context.
