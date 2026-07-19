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
        version: '0.2.0-pux.5',
        milestone: 'PUX-005',
        graph_schema_version: 1,
        indexeddb_database_version: 1,
        prax_bundle_version: 1,
        canonical_store: 'indexeddb-local',
        node_crud: true,
        import_export: true,
        import_behavior: 'replace-only',
        public_mutation_api: false,
        semantic_index: 'not-configured'
      });
    }

    return env.ASSETS.fetch(request);
  }
};
