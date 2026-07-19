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
        version: '0.1.0',
        canonical_store: 'not-configured',
        semantic_index: 'not-configured'
      });
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ ok: false, error: 'API route not implemented' }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  }
};
