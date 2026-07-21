# Prax Preview Environments

## Purpose

Preview environments validate an exact feature-branch commit without merging it, changing the production route, or promoting it to production traffic.

## PUX-006 implementation

PUX-006 uses a manually dispatched GitHub Actions workflow:

- Workflow: `.github/workflows/preview-pux006.yml`
- Required branch: `pux-006-validation-tests`
- Target Worker: `prax-your-universe`
- Default alias: `pux-006`
- Upload operation: `npx wrangler versions upload --preview-alias pux-006`

`wrangler versions upload` creates a Worker version independently from a deployment. The workflow never runs `wrangler deploy`, `wrangler versions deploy`, or a route command.

Before upload, the workflow records the target Worker, branch, commit SHA, command, and production-impact assessment. It snapshots the current production deployment list and asserts that the list is identical after the version upload.

The workflow performs unit tests, syntax checks, a Wrangler dry-run, remote desktop verification at 1440 × 900, and touch-mobile verification at 390 × 844. Artifacts contain the upload receipt, Worker version identity, preview URL, screenshots, browser report, logs, and before/after deployment evidence.

## Credential policy

GitHub Actions uses only the repository's encrypted `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets for Cloudflare authentication. Tokens must use least privilege and must never be printed.

The PUX-006 application itself requires no Worker secrets. No manual Cloudflare secret setup is necessary for the application preview.

## Binding policy

Stateless branches may use Worker version preview aliases.

Branches that read or write server-side state must use isolated staging resources. Feature previews must not reuse production D1, KV, R2, Queues, Durable Objects, secrets, service bindings, or mutation APIs unless a resource was explicitly designed as read-only and separately approved.

A separate staging Worker is required when state isolation, scheduled tasks, integration credentials, mutation testing, or independent logging are needed.

PUX-006 currently binds only static assets through `ASSETS`. Browser graph state remains local to IndexedDB.

## Manual acceptance gate

A successful workflow does not close PUX-006. The stable preview URL must be tested on a physical iPhone, findings must be recorded, and acceptance must be explicit before PUX-006 closeout or PUX-007 begins.
