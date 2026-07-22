const json = (value, init = {}) => new Response(JSON.stringify(value, null, 2), {
  ...init,
  headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers ?? {}) }
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        app: 'prax-your-universe',
        version: '0.2.0-pux.9',
        milestone: 'PUX-009',
        graph_schema_version: 1,
        indexeddb_database_version: 1,
        prax_bundle_version: 1,
        canonical_store: 'indexeddb-local',
        node_crud: true,
        import_export: true,
        searchlight: true,
        exact_local_search: ['title', 'body', 'url', 'nodeType'],
        shared_navigation_foundation: true,
        adaptive_node_hit_testing: true,
        pointer_hit_policy: 'raycast-first-css-space-adaptive-fallback',
        import_behavior: 'replace-only',
        public_mutation_api: false,
        semantic_index: 'not-configured'
      });
    }

    return env.ASSETS.fetch(request);
  }
};
