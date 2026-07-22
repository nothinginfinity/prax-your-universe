# Prax — Spatial Knowledge Graph Roadmap

**Project:** `nothinginfinity/prax-your-universe`  
**Live application:** `https://prax-your-universe.jaredtechfit.workers.dev`  
**Roadmap status:** Canonical planning document  
**Updated:** July 21, 2026

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

### v0.2.3 — Node-centered graph UX

**Goal:** Make every node easier to manipulate, expand, search from, and eventually converse with while preserving local-first graph correctness.

- Replace the fixed coarse-pointer tolerance with adaptive hit testing derived from projected node size, camera distance, device pixel ratio, viewport, and pointer type.
- Allow a selected node to create a child node through an explicit typed parent/child edge.
- Preserve the canonical universe-root membership edge for every non-root node; hierarchy supplements root membership rather than replacing it.
- Create child nodes atomically with both their root-membership edge and parent/child edge, rolling back the entire operation on failure.
- Keep semantic node type separate from visual appearance.
- Add validated manual node appearance overrides with `auto` as the default.
- Support a finite shape allowlist and validated color palette or normalized custom color values.
- Persist appearance overrides and parent/child relationships through IndexedDB reload and Prax import/export.
- Add node-centered local search scopes such as This Node, Children, Neighborhood, and Universe.
- Keep the selected anchor node visibly central while scoped search is active and restore the exact prior camera, projection, selection, and emphasis state on exit.
- Prepare a node-centered chat drawer and context-builder contract without requiring the entire universe to be transmitted.
- Treat local search and external chat as separate trust boundaries.
- Require explicit user action and a visible context preview before node content is sent to a model provider.
- Use a provider adapter so Cloudflare Workers AI can be the first chat provider without becoming a permanent hard-coded dependency.
- Confirm the exact supported fast Llama model identifier during implementation rather than recording an unverified model name here.
- Keep provider credentials and model calls in the Worker, never browser JavaScript.
- Gate production model access behind authentication, rate limits, privacy controls, cancellation, timeout, and error handling.
- Allow successful conversations to be saved later as `conversation` nodes linked to their anchor through an explicit relationship such as `discusses` or `derived_from`.

### v0.2.3 acceptance criteria

- Touch selection adapts across zoom levels without visually enlarging nodes or weakening desktop precision.
- Tap-versus-drag rejection remains deterministic on mobile.
- A user can create a child node without violating the single-root or root-membership invariants.
- Child relationships and manual appearance overrides survive reload and import/export round trips.
- Changing node shape or color does not alter semantic type, identity, provenance, timestamps, or edges.
- Scoped local search preserves its anchor and restores the exact previous spatial state on exit.
- Chat preparation remains optional, explicit, inspectable, and unable to break local graph operation when the provider is unavailable.
- Adaptive hit testing, hierarchy, manual appearance, scoped search, chat foundation, and automatic appearance remain separate acceptance and rollback boundaries.

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

PUX-006 validation, PUX-007 Searchlight, PUX-008 Galaxy Focus, and the PUX-008 mobile touch refinement are accepted on `pux-008-galaxy-focus` at commit `203243c74e79739dab7d5930331289a7a66de547`. The approved next implementation sequence is PUX-009 adaptive hit testing, PUX-010 child hierarchy, PUX-011 manual appearance, PUX-012 node-centered scoped search, PUX-013 node-centered chat foundation, and PUX-014 automatic appearance suggestions. Each package remains independently reviewable, reversible, tested on desktop and mobile, and guarded behind a milestone-specific feature preview until explicit acceptance. PUX-009 is the first implementation milestone and must be completed before any graph-schema migration begins.

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

### Work package PUX-003 — Root node and edges — complete

- Create one stable universe root node.
- Connect newly created nodes through explicit default edges.
- Render edges efficiently.
- Keep edge visuals synchronized with layout movement.

### Work package PUX-004 — Node CRUD — complete

- Add link and note creation.
- Add edit and delete.
- Add deletion policy for connected edges.
- Add node-type visual metadata.

### Work package PUX-005 — Import and export — complete

- Define a versioned Prax JSON bundle.
- Export nodes, edges, layouts, and metadata.
- Validate imports before mutation.
- Preserve IDs and provenance during round trips.
- Use replace-only import with complete pre-mutation validation and explicit destructive confirmation.
- Preserve one canonical universe root and roll back graph, persistence, and scene state on replacement failure.
- Verify export, destructive import, reload persistence, malformed-payload rejection, and desktop/mobile behavior in production.

### Work package PUX-006 — Validation and tests — complete and accepted

**Accepted boundary:** PUX-006 branch-preview and physical-device validation completed before Searchlight and Galaxy Focus implementation.


- Test persistence after reload.
- Test schema upgrades.
- Test invalid URLs and malformed imports.
- Test edge cleanup and graph integrity.
- Perform desktop and mobile live verification.

### PUX-006 branch-preview and physical-device gate

**Purpose:** Validate the exact PUX-006 branch on a real mobile device before PUX-007 begins, without merging or routing production traffic.

- Upload the exact `pux-006-validation-tests` branch as a non-production Cloudflare Worker version.
- Assign a stable branch preview alias such as `pux-006`.
- Keep the production Worker and production route unchanged.
- Do not add secrets or stateful bindings unless the branch actually requires them.
- Verify `/api/health`, static assets, desktop behavior, and touch-mobile behavior against the preview URL.
- Manually test the preview on a physical iPhone, including creation, editing, deletion, reload persistence, invalid URL handling, import rejection, and viewport usability.
- Record the preview URL, branch commit, Worker version identifier, automated results, screenshots, and physical-device findings.
- Treat preview deployment as validation infrastructure, not as a production release.
- Close PUX-006 only after branch review, preview validation, and explicit acceptance.
- Do not begin PUX-007 until this gate is complete.
- After acceptance, build PUX-007 Searchlight before PUX-008 Galaxy Focus so both features share one camera, selection, neighborhood, and restoration foundation.

**Long-term release pattern:** Use version preview aliases for stateless branch testing. Use a fully separate staging Worker and separate D1, KV, R2, queues, secrets, and other stateful resources whenever a branch can read or mutate server-side state.

### Work package PUX-007 — Searchlight and shared navigation foundation — complete and accepted

**Accepted boundary:** Exact local Searchlight, shared navigation/restoration behavior, keyboard activation, and mobile dismissal behavior were validated before PUX-008.


**Dependencies:** PUX-004 node CRUD and PUX-006 validation acceptance.

- Add exact local search across node title, body text, URL, and node type.
- Display the current result index and total result count.
- Add next and previous result controls.
- Highlight the active result and dim unrelated nodes without mutating graph state.
- Fly the camera to the active result using reusable camera-navigation controls.
- Emphasize the selected node's immediate explicit-edge neighborhood.
- Capture and restore the previous camera, selection, and projection state.
- Add Reset View, Escape, and mobile-friendly dismissal behavior.
- Keep search deterministic and local; semantic/vector search remains deferred to v0.4.
- Build selection, neighborhood, camera, and restoration logic as shared modules for Galaxy Focus.
- Verify keyboard, touch, mobile viewport, reduced-motion, and reload behavior.

### Work package PUX-008 — Galaxy Focus and mobile touch refinement — complete and accepted

**Accepted boundary:** Galaxy Focus and the subsequent iPhone node-selection refinement are accepted at commit `203243c74e79739dab7d5930331289a7a66de547`. The final refinement performs a fresh tap-position raycast, applies coarse-pointer tolerance, rejects drag gestures, preserves desktop precision, and keeps Searchlight/Galaxy restoration invariants intact.


**Dependencies:** PUX-003 root node and edges, plus the PUX-007 Searchlight shared navigation foundation.

- Define focused, entering, active, and exiting projection states.
- Reuse PUX-007 camera, selection, neighborhood, and restoration controls.
- Capture the previous camera and layout state before entry.
- Compute a stable local neighborhood from explicit graph edges.
- Animate the focused node, direct neighbors, outer halo, and unrelated background groups independently.
- Keep explicit edges visually distinct from future semantic suggestions.
- Add Back, Escape, Reset View, and reduced-motion behavior.
- Test repeated entry and exit without coordinate drift or leaked scene objects.
- Verify performance on desktop and mobile with realistic local graph sizes.

### Queued work package PUX-009 — Adaptive node hit testing

**Dependencies:** Accepted PUX-008 mobile touch refinement.

**Architecture boundary:** Renderer interaction only. PUX-009 must not change canonical graph records, IndexedDB structure, Prax bundle structure, Worker bindings, or visible node size.

- Replace the fixed coarse-pointer fallback with exported pure calculations for projected node radius and adaptive effective hit radius.
- Derive projected size from geometry bounds, world scale, camera distance, camera field of view or zoom, viewport CSS dimensions, renderer pixel ratio, device pixel ratio, and pointer type.
- Keep all pointer comparisons in CSS pixels and normalize device pixel ratio exactly once.
- Preserve precise fine-pointer raycast behavior; adaptive fallback applies only to touch or pen input after the normal raycast misses.
- Rank overlapping fallback candidates deterministically using normalized distance from the rendered boundary, projected depth, and stable node ID as the final tie-breaker.
- Preserve deterministic tap-versus-drag rejection as a separate threshold from hit radius.
- Verify DPR 1, 2, and 3, multiple zoom levels, far and small nodes, emphasized nodes, overlapping targets, sphere and grid views, Searchlight, and Galaxy Focus.
- Require guarded desktop, touch-mobile, and physical-iPhone validation before acceptance.

### Queued work package PUX-010 — Child node hierarchy

**Dependencies:** PUX-003 root topology, PUX-004 CRUD, PUX-005 import/export, and PUX-006 validation.

**Architecture decision:** Hierarchy uses a directed `parent_of` edge from parent to child. It forms a single-parent, acyclic forest layered over universe membership.

**Migration boundary:** Introduce graph schema version 2 while keeping IndexedDB database version 1 and Prax bundle envelope version 1. Existing version-1 graphs migrate without manufactured hierarchy and preserve all IDs, timestamps, provenance, content, layouts, and root-membership edges.

- Add `parent_of` as an explicit typed edge with direction `parent --parent_of--> child`.
- Keep exactly one universe-root `contains` membership edge for every non-root node; hierarchy supplements membership and never replaces it.
- Require zero or one incoming `parent_of` edge per node, allow any number of children, and reject cycles, duplicate parent/child relationships, cross-universe hierarchy, self-edges, and universe-root hierarchy endpoints.
- Add a single composite store command that creates the child node, root-membership edge, and parent edge atomically and validates the complete snapshot before persistence.
- Harden the shared mutation coordinator so scene-projection failure restores and re-persists the previous graph and fully restores the previous scene, matching the replacement rollback guarantee.
- Place a new child near its parent in transient renderer state without storing render coordinates in canonical node content.
- Add Add Child, parent link, child count, compact direct-child list, and parent/child navigation to the selected-node UI.
- Use direct children for the initial hierarchy UX; recursive descendants remain available to later traversal features.
- Never cascade-delete children. Deleting a parent removes that node and its connected edges, preserves each child's root-membership edge, and promotes direct children to top-level nodes.
- State the number of direct children that will become top-level in the deletion confirmation.
- Verify graph-schema migration, cycle rejection, multiple-parent rejection, rollback after each composite step, persistence, export/import, replacement, root invariants, projection failure recovery, desktop/mobile interaction, and physical-iPhone behavior.

### Queued work package PUX-011 — Manual node appearance

**Dependencies:** Stable node identity, accepted PUX-010 graph schema version 2, and safe scene resource-update behavior.

**Architecture decision:** Store appearance in a dedicated canonical `nodeVisualStyles` collection. Do not place manual appearance on semantic node records or layout-node coordinate records.

**Migration boundary:** Introduce graph schema version 3, IndexedDB database version 2 with a `node_visual_styles` store, and Prax bundle version 2. Version-2 graphs migrate with no style records, which resolves to automatic appearance.

- Define a validated visual-style record keyed to one node and universe, separate from semantic `nodeType`, node provenance, and node timestamps.
- Treat absence of a style record as `auto`; a manual record may override shape, color, or both.
- Use canonical shape keys `sphere`, `cube`, `octahedron`, and `torus`; the UI may label `octahedron` as Diamond and `torus` as Ring.
- Add palette colors and validated normalized `#rrggbb` custom colors.
- Add a pure appearance resolver with precedence: manual field override, then automatic suggestion when available, then semantic node-type default.
- Add an Appearance sheet or drawer with Auto/Manual state, shape choices, palette, custom color validation, live preview, Apply, and Reset Appearance.
- Reset Appearance deletes only the style record and resolves immediately to automatic/default presentation.
- Preserve the existing mesh object, node position, selection references, edge endpoints, Searchlight state, and Galaxy Focus membership when changing geometry or color.
- Dispose replaced geometry safely and update material color in place where possible.
- Verify schema and database migration, persistence, reload, export/import, replacement rollback, resource disposal, semantic identity preservation, desktop/mobile interaction, and physical-iPhone behavior.

### Queued work package PUX-012 — Node-centered scoped search

**Dependencies:** PUX-007 shared Searchlight navigation and accepted PUX-010 hierarchy.

**Architecture boundary:** Reuse `searchNodesExact()` unchanged. A separate deterministic scope resolver supplies its candidate node list.

- Add explicit scopes with fixed initial semantics: This Node means the anchor only; Children means direct children only; Neighborhood means the anchor plus immediate explicit hierarchy and semantic relationships; Universe means all nodes.
- Exclude the infrastructure universe-root membership edge from ordinary Neighborhood results while retaining it for topology inspection.
- Maintain separate `anchorNodeId` and `activeResultNodeId` state so browsing results does not silently replace the selected anchor.
- Keep the selected anchor visibly pinned while results change and provide an explicit Open Result action when the user intends to change selection.
- Show each result's relationship to the anchor and distinguish parent, child, semantic neighbor, and universe-wide matches.
- Extend the shared navigation snapshot to capture camera, projection, selected node, prior emphasis, rotation state, and any active presentation mode needed for exact restoration.
- Restore the exact previous camera, projection, selected node, emphasis, rotation, and presentation state on exit.
- Keep all search local, deterministic, offline-capable, and independent of chat-provider availability.
- Verify scope resolution, root-edge exclusion, anchor stability, Galaxy Focus interaction, Searchlight reuse, reduced motion, desktop/mobile behavior, and physical-iPhone restoration.

### Queued work package PUX-013 — Node-centered chat foundation

**Dependencies:** Accepted PUX-012 anchor/scoping behavior. Live provider access additionally depends on an authenticated, rate-limited, isolated staging Worker boundary.

**Architecture boundary:** Separate the local context builder, browser chat client and drawer, and Worker provider adapter. The local graph must remain fully usable when the provider is absent or disabled.

- Add Search and Chat actions to the selected-node panel.
- Build a chat drawer that visibly pins the anchor node and included context scope.
- Build a deterministic versioned context contract containing only approved node fields, included explicit edges, omission and size summaries, and a reproducible digest.
- Add a visible context preview and require an explicit send action before any node content leaves the browser.
- Never transmit the entire universe implicitly.
- Add a provider registry and provider-neutral request, streaming, cancellation, timeout, limit, and normalized-error interfaces.
- Keep all credentials, provider bindings, and model calls in the Worker; the browser receives no provider secret.
- Treat `@cf/meta/llama-3.1-8b-instruct-fast` as the current provisional Cloudflare Workers AI candidate, but reverify exact support, capabilities, pricing, and model identifier immediately before implementation.
- Deliver the context builder, drawer, adapter contract, and fake-provider tests before enabling live inference.
- Require a separate staging Worker, Workers AI binding, authentication or Cloudflare Access, rate limits, privacy-oriented logs, and request-size controls before a real provider route is enabled.
- Do not add an unauthenticated paid inference endpoint to the current public preview alias.
- Define offline, unavailable-provider, cancellation, timeout, context-limit, partial-response, retry, and error behavior.
- Preserve local-first graph operation when chat is unavailable.
- Define the future conversation-result contract without creating conversation nodes in this milestone; durable chat-node mutation remains a later independently accepted package.

### Queued work package PUX-014 — Automatic appearance suggestions

**Dependencies:** Accepted PUX-011 manual appearance and a stable content-classification boundary.

**Architecture boundary:** Automatic appearance is derived, explainable suggestion state. It is not semantic node truth and never mutates or deletes a manual style record.

- Suggest shape and color from semantic type, content, or metadata.
- Start with a deterministic local rule engine before adding any model-based classifier.
- Store or expose each suggestion with its proposed shape and color, source rule or model, explanation, content digest, rule or model version, and confidence when applicable.
- Resolve appearance field by field using: manual override, then automatic suggestion, then semantic node-type default.
- Keep every suggestion explainable and manually overridable.
- Never overwrite a manual appearance choice without explicit confirmation.
- Keep classification suggestions separate from canonical node meaning, provenance, and explicit graph relationships.

## 6. Build order and dependency gates

### Immediate node-centered dependency graph

```text
Accepted PUX-008
    └── PUX-009 adaptive node hit testing

PUX-003 + PUX-004 + PUX-005 + PUX-006
    └── PUX-010 child node hierarchy
          ├── PUX-011 manual node appearance
          │      └── PUX-014 automatic appearance suggestions
          └── PUX-012 node-centered scoped search
                 └── PUX-013 node-centered chat foundation
```

### Long-term release sequence

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

- Complete PUX-009 as an interaction-only milestone before introducing graph-schema changes.
- Do not begin child hierarchy UI until the composite mutation and projection-failure rollback boundary is tested.
- Use a new milestone-specific preview origin whenever a graph or IndexedDB schema upgrade could make local browser data incompatible with older code.
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
