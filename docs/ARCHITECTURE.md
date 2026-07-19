# Prax Spatial Knowledge Graph Architecture

## 1. Core model

Prax is a graph system with one or more 3D projections. The graph is persistent; the rendered universe is a view.

The first implementation should keep the domain model small and explicit:

### Node

A node is an addressable unit of knowledge.

Suggested node types:

- `prompt`
- `response`
- `conversation`
- `note`
- `link`
- `document`
- `repository`
- `artifact`
- `topic`
- `person`
- `project`

Suggested fields:

- `id`
- `universe_id`
- `type`
- `title`
- `body_text`
- `source_url`
- `content_hash`
- `created_at`
- `updated_at`
- `created_by`
- `metadata_json`

### Edge

An edge records a real, named relationship between two nodes.

Suggested edge types:

- `responds_to`
- `part_of`
- `references`
- `derived_from`
- `supersedes`
- `supports`
- `contradicts`
- `similar_to`
- `created_from`
- `belongs_to_project`

Suggested fields:

- `id`
- `universe_id`
- `source_node_id`
- `target_node_id`
- `type`
- `weight`
- `confidence`
- `created_by`
- `created_at`
- `metadata_json`

Machine-suggested edges should be distinguishable from user-confirmed or deterministic edges.

### Embedding record

Vectorize stores embeddings, while D1 stores the durable identity and embedding metadata.

Suggested fields:

- `node_id`
- `model`
- `dimensions`
- `content_hash`
- `vectorize_index`
- `embedded_at`

A content hash prevents unnecessary re-embedding and makes model migrations auditable.

### Layout

Coordinates should not live as the only representation of graph structure.

Suggested fields:

- `id`
- `universe_id`
- `name`
- `algorithm`
- `version`
- `parameters_json`
- `created_at`

A layout-node table can store `x`, `y`, `z`, scale, color hints, pinned state, and cluster membership for a particular layout version.

## 2. Storage responsibilities

### D1 — canonical state

D1 should contain:

- users and universes
- conversations and turns
- nodes and edges
- provenance
- layout versions
- permissions
- embedding metadata
- jobs and migration state

### Vectorize — semantic index

Vectorize should contain embeddings keyed by stable node IDs. It supports:

- semantic search
- related-node discovery
- context retrieval
- cluster seeding

Nearest-neighbor results are candidates, not automatically trusted graph edges.

### KV — derived bootstrap cache

KV can cache compact payloads such as:

- recent universe snapshot
- node summaries
- graph deltas
- public configuration
- feature flags

KV should be safely rebuildable from D1 and R2.

### R2 — large and immutable artifacts

R2 can store:

- uploaded documents
- conversation exports
- generated reports
- images and attachments
- graph snapshots
- import bundles
- model-generated artifacts

D1 rows should reference R2 object keys and hashes.

### Durable Objects — optional coordination

Durable Objects become useful when Prax needs:

- collaborative graph sessions
- real-time presence
- serialized mutation streams
- WebSocket rooms
- per-universe rate coordination

They are not required for the first persistent single-user build.

## 3. Chat transaction

A robust chat transaction should proceed as follows:

1. Authenticate the user and resolve `universe_id`.
2. Validate and normalize the prompt.
3. Insert the prompt node and conversation membership in D1.
4. Generate the model response.
5. Insert the response node and deterministic `responds_to` edge.
6. Embed both nodes.
7. Upsert vectors keyed by node ID.
8. Query nearby vectors to produce relationship candidates.
9. Persist only explicit or policy-approved edges.
10. Compute or enqueue a layout delta.
11. Return the new nodes, edges, summaries, and coordinates to the client.

The browser should receive a graph delta rather than a replacement of the entire universe.

## 4. Search experience

Search should combine three retrieval modes:

- lexical filtering for exact words, titles, URLs, IDs, and dates
- vector search for semantic proximity
- graph traversal for connected context

A search result can return:

- direct matches
- semantically related nodes
- shortest graph paths
- containing conversations or projects
- a camera target and temporary highlight set

The camera flight is a presentation of the retrieval result, not the retrieval mechanism itself.

## 5. Projection strategies

Prax can support several interchangeable projections over the same graph:

- semantic constellation
- chronology spiral
- conversation tree
- project galaxy
- source/provenance map
- user-curated rooms
- uncertainty or contradiction view

The current sphere and grid modes are early examples of this projection layer.

## 6. Privacy and trust boundaries

Because Prax may contain a person's cognitive history, privacy must be structural:

- authentication before data access
- per-universe authorization checks
- no secrets in browser-delivered code
- encrypted transport
- minimal logging of prompt bodies
- deletion and export workflows
- model/provider provenance
- clear separation of private and publishable nodes
- explicit consent before indexing imported data

The system should also preserve the source and creation method of every node so users can distinguish their own writing, imported material, deterministic transformations, and AI-generated output.

## 7. Phased build plan

### Phase 0 — Baseline preservation

- preserve the original standalone app
- document architecture and invariants
- establish repository and CairnStone chain

### Phase 1 — Frontend modularization

- separate HTML, CSS, scene, graph state, interaction, and API client
- replace global mutable state with an explicit client graph store
- add deterministic node IDs
- add edge rendering
- add mobile pointer/touch handling
- add safe URL validation

### Phase 2 — Local persistent graph

- use IndexedDB for nodes, edges, and layouts
- add import/export
- add lexical search
- prove graph-delta rendering before adding cloud dependencies

### Phase 3 — Cloudflare persistence

- add Worker API
- create D1 schema and migrations
- store canonical nodes and edges
- add authentication and universe ownership
- use KV only for derived bootstrap caches

### Phase 4 — Semantic layer

- add Workers AI embeddings
- index nodes in Vectorize
- add semantic search and related-node candidates
- introduce content hashes and embedding versioning

### Phase 5 — AI conversation layer

- add streamed chat inference
- create prompt and response nodes transactionally
- retrieve graph-aware context
- animate graph deltas in real time

### Phase 6 — Spatial intelligence

- add layout workers or queued layout jobs
- support multiple saved projections
- camera fly-to and focus modes
- cluster labels and level-of-detail rendering

### Phase 7 — Collaboration and portability

- optional Durable Object rooms
- shared universes and permissions
- portable export format
- connectors for repositories, documents, chat archives, and CairnStone/AFO data

## 8. Immediate next engineering step

The safest next step is frontend modularization without changing product behavior. That creates a testable boundary between:

- graph data
- projection/layout logic
- Three.js rendering
- UI state
- future Worker API calls

Once those boundaries exist, persistence and AI can be added without turning the prototype into another large monolithic file.
