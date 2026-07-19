# Cloudflare deployment

The first Cloudflare slice deploys the modular Three.js application as Worker static assets and exposes `/api/health` from `src/worker.js`.

## GitHub secrets

The workflow expects:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## Deliberately not configured yet

No D1, KV, Vectorize, R2, Workers AI, authentication, or Durable Object bindings are declared in `wrangler.jsonc` yet. Resource IDs must be created and recorded before bindings are added.

D1 will be canonical. KV will only cache rebuildable projections or bootstrap snapshots. Vectorize results will remain semantic candidates until converted into explicit graph relationships by deterministic logic, policy, or user confirmation.

## Commands

- `npm run dev`
- `npm run check`
- `npm run deploy`

Every push to `main` validates with a Wrangler dry run before deploying.
