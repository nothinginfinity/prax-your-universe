# Prax — Your Universe

Prax is a lightweight Three.js prototype for navigating personal information as a spatial universe rather than a linear sidebar or chronological list.

The current build renders link nodes in a rotatable 3D sphere, supports a grid projection, allows links to be added in-session, and exposes node details through an information panel.

## Product direction

The larger goal is a **Spatial Knowledge Graph**: a navigable 3D representation of a person's conversations, notes, links, documents, repositories, ideas, and AI-generated knowledge.

Instead of treating chat history as an endless timeline, Prax treats each meaningful unit as a node and each real relationship as an edge. Semantic similarity can influence visual proximity, but the graph remains explicit and inspectable.

## Current prototype

- Three.js scene with orbit controls
- Procedural starfield
- Sphere and grid projections
- Clickable, emissive link nodes
- Slide-in information panel
- In-session link creation
- Responsive full-screen canvas

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

This prototype has no build step. Serve the repository with any static HTTP server and open `index.html`.

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Status

The repository now contains the preserved standalone prototype and the modular Cloudflare Worker build deployed at `https://prax-your-universe.jaredtechfit.workers.dev`. The live build supports spatial navigation and in-session link creation. Persistent graph storage, authentication, semantic indexing, and AI inference have not yet been added.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the domain model, [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for deployment details, and [`docs/ROADMAP.md`](docs/ROADMAP.md) for the canonical product and engineering roadmap.
