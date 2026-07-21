import assert from 'node:assert/strict';
import { appendFile, readFile, writeFile } from 'node:fs/promises';

const artifactDir = process.env.PRAX_VISUAL_ARTIFACT_DIR ?? 'artifacts/pux006-preview';
const alias = process.env.PRAX_PREVIEW_ALIAS ?? 'pux-006';
const worker = process.env.PRAX_WORKER_NAME ?? 'prax-your-universe';
const commitSha = process.env.GITHUB_SHA ?? '';
const message = process.env.PRAX_UPLOAD_MESSAGE ?? '';
const outputPath = process.env.GITHUB_OUTPUT;
const summaryPath = process.env.GITHUB_STEP_SUMMARY;

const stripAnsi = (value) => value.replace(/\u001b\[[0-9;]*m/g, '');
const uploadLog = stripAnsi(await readFile(`${artifactDir}/upload.log`, 'utf8'));
const versions = JSON.parse(await readFile(`${artifactDir}/versions-after.json`, 'utf8'));
const deploymentsBefore = JSON.parse(await readFile(`${artifactDir}/deployments-before.json`, 'utf8'));
const deploymentsAfter = JSON.parse(await readFile(`${artifactDir}/deployments-after.json`, 'utf8'));

assert.deepEqual(deploymentsAfter, deploymentsBefore, 'Production deployment list changed during version upload.');

const objects = [];
const visit = (value) => {
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value)) objects.push(value);
  for (const child of Object.values(value)) visit(child);
};
visit(versions);

const version = objects.find((candidate) => candidate.message === message)
  ?? objects.find((candidate) => candidate.tag === `pux-006-${commitSha.slice(0, 12)}`);
const uploadUuid = uploadLog.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i)?.[0] ?? null;
const versionId = version?.id ?? version?.version_id ?? version?.versionId ?? uploadUuid;
assert.ok(versionId, 'Unable to determine uploaded Worker version ID.');

const urls = [...uploadLog.matchAll(/https:\/\/[^\s)]+/g)].map(([url]) => url.replace(/[.,;]+$/, ''));
const expectedPrefix = `https://${alias}-${worker}.`;
const previewUrl = urls.find((url) => url.startsWith(expectedPrefix) && url.includes('.workers.dev'));
assert.ok(previewUrl, `Unable to find aliased preview URL beginning ${expectedPrefix}`);

const wranglerVersion = (await readFile(`${artifactDir}/wrangler-version.txt`, 'utf8')).trim();
const receipt = {
  ok: true,
  branch: process.env.GITHUB_REF_NAME,
  commitSha,
  worker,
  versionId,
  alias,
  previewUrl,
  uploadCommand: `npx wrangler versions upload --preview-alias ${alias}`,
  uploadMessage: message,
  wranglerVersion,
  deployedAt: new Date().toISOString(),
  productionDeploymentsUnchanged: true,
  productionTrafficAffected: false,
  statefulProductionBindingsUsed: false,
  manualSecretsRequired: false,
  authenticationSecretsUsedByWorkflow: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']
};

await writeFile(`${artifactDir}/deployment-receipt.json`, `${JSON.stringify(receipt, null, 2)}\n`);
if (outputPath) {
  await appendFile(outputPath, `preview_url=${previewUrl}\nversion_id=${versionId}\nwrangler_version=${wranglerVersion}\n`);
}
if (summaryPath) {
  await appendFile(summaryPath, [
    '## PUX-006 Preview Upload',
    '',
    `- Branch: \`${receipt.branch}\``,
    `- Commit: \`${receipt.commitSha}\``,
    `- Worker: \`${receipt.worker}\``,
    `- Version ID: \`${receipt.versionId}\``,
    `- Preview alias: \`${receipt.alias}\``,
    `- Preview URL: ${receipt.previewUrl}`,
    `- Wrangler: \`${receipt.wranglerVersion}\``,
    '- Production deployment list unchanged: **yes**',
    '- Production traffic changed: **no**',
    '- Stateful production resources bound: **no**',
    '- Manual Worker secrets required: **no**',
    ''
  ].join('\n'));
}
console.log(JSON.stringify(receipt, null, 2));
