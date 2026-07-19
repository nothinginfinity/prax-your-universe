# Prax — Your Universe

Prax is a lightweight Three.js prototype for navigating personal information as a spatial universe rather than a linear sidebar or chronological list.

The current build provides a durable local spatial graph with one protected universe root, typed edges, link and note CRUD, IndexedDB persistence, sphere and grid projections, and validated JSON import/export.

## Product direction

The larger goal is a **Spatial Knowledge Graph**: a navigable 3D representation of a person's conversations, notes, links, documents, repositories, ideas, and AI-generated knowledge.

Instead of treating chat history as an endless timeline, Prax treats each meaningful unit as a node and each real relationship as an edge. Semantic similarity can influence visual proximity, but the graph remains explicit and inspectable.

## Current local graph

- Three.js scene with orbit controls and a procedural starfield
- Sphere and grid projections over the same canonical graph
- One deterministic, protected universe root
- Typed, explicitly rendered edges
- Durable link and note creation, editing, and deletion
- IndexedDB persistence with transactional snapshot replacement
- Versioned Prax JSON export
- Validated, confirmation-gated, replace-only import
- Stable IDs, provenance, layouts, settings, and legacy version-1 normalization
- Responsive desktop and mobile controls

## Proposed Cloudflare architecture

| Layer | Responsibility |
| --- | --- |
| Cloudflare Worker | API gateway, authentication, orchestration, graph operations, AI calls |
| Workers AI | Chat inference, embeddings, summaries, labels, relationship suggestions |
| D1 | Canonical nodes, edges, conversations, turns, metadata, and layout versions |
| Vectorize | Semantic retrieval and nearest-neighbor discovery |
| R2 | Large documents, exports, attachments, snapshots, and generated artifacts |
| KV | Disposable read cache and compact bootstrap state |
| Durable Objects | Optional real-time sessions, collaborative rooms, and serialized graph mutations |

D1 and the explicit graph should be the source of truth. Vectorize is an index. KV is a cache. Three-dimensional coordinates are a projection that can be regenerated or versioned.

## Chat-to-node pipeline

1. The client submits a prompt to the Worker.
2. The Worker creates the user-turn node in D1.
3. Workers AI generates a response.
4. The prompt and response are embedded.
5. The embeddings are indexed in Vectorize using stable D1 node IDs.
6. The response node and an explicit `responds_to` edge are written to D1.
7. Related nodes are retrieved or proposed from semantic similarity.
8. The Worker returns a graph delta to the browser.
9. Three.js animates the new nodes and edges into the current projection.

## Design principle

Prax should not confuse semantic similarity with factual relationship.

- **Similarity** answers: “Which nodes are mathematically close in embedding space?”
- **Edges** answer: “Which nodes are actually connected, and why?”
- **Layout** answers: “How should this graph be projected for this view?”

Keeping these layers separate prevents the visual universe from becoming the database and allows multiple layouts—semantic clusters, chronology, projects, source provenance, or user-defined constellations—to coexist over the same knowledge graph.

## Run locally

The application has no frontend build step. Install the Worker tooling and start Wrangler:

```bash
npm install
npm run dev
```

Open the local URL printed by Wrangler.

## Status

The repository contains the preserved standalone prototype and the modular Cloudflare Worker build deployed at `https://prax-your-universe.jaredtechfit.workers.dev`. PUX-005 is complete: the live build supports durable local graph CRUD, explicit root topology, IndexedDB persistence, deterministic JSON export, and validated replace-only import. Authentication, cloud synchronization, semantic indexing, and AI inference remain future milestones.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the domain model, [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for deployment details, and [`docs/ROADMAP.md`](docs/ROADMAP.md) for the canonical product and engineering roadmap.
