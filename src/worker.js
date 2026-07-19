const json = (data, init = {}) => {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        app: 'prax-your-universe',
        version: '0.2.0-pux.1',
        schema_version: 1,
        canonical_store: 'local-client-graph',
        semantic_index: 'not-configured'
      });
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ ok: false, error: 'API route not implemented' }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  }
};
