import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const branchCallbacks = new Map([
  ["feat/peos-canonical-reconciliation-readonly-20261123", "iam-control-center-new-pr173-ci.vercel.app"],
  ["audit/peos-g3-current-main-rebaseline-20261123", "iam-control-center-new-pr171-ci.vercel.app"],
  ["test/peos-g3-tree-inventory-20261123", "iam-control-center-new-pr169-ci.vercel.app"],
  ["feat/iam-g1-b2-readback-independent-gate", "iam-control-center-new-pr101-ci.vercel.app"],
  ["ops/g1-full-recovery-preflight-20261118", "iam-control-center-new-pr134-ci.vercel.app"],
  ["ops/g1-disposable-ttl-contract-20261119", "iam-control-center-new-pr135-ci.vercel.app"],
  ["fix/g1-env-readonly-solo-metadata-20261119", "iam-control-center-new-pr136-ci.vercel.app"],
  ["fix/g1-recovery-preflight-safety-20261119", "iam-control-center-new-g1-recovery-safety-ci.vercel.app"],
  ["fix/g1-b2-full-ciphertext-readback-20261119", "iam-control-center-new-g1-readback-ci.vercel.app"],
  ["fix/g1-b2-env-api-diagnostics-20261119", "iam-control-center-new-g1-env-diagnostic-ci.vercel.app"],
  ["feat/g1-b2-encrypted-full-backup-writer-20261119", "iam-control-center-new-g1-backup-writer-ci.vercel.app"],
  ["fix/g1-b2-four-environments-readonly-preflight-20261119", "iam-control-center-new-pr141-ci.vercel.app"],
  ["fix/g1-b2-writer-failfast-privilege-diagnostics-20261119", "iam-control-center-new-g1-writer-fix-ci.vercel.app"],
  ["governance/pr-update-merge-default-20261120", "iam-control-center-new-pr143-ci.vercel.app"],
  ["test/canonical-manifest-diff-gate-20261112", "iam-control-center-new-pr44-ci.vercel.app"],
  ["fix/pr44-membership-canonical-drift-20261117", "iam-control-center-new-pr126-ci.vercel.app"],
  ["test/g2-readonly-canonical-drift-contracts-20261118", "iam-control-center-new-pr131-ci.vercel.app"],
  ["experiment/biome-lint-no-picomatch-20261117", "iam-control-center-new-pr119-ci.vercel.app"],
  ["experiment/bun-native-tests-picomatch-removal-20261117", "iam-control-center-new-pr121-ci.vercel.app"],
  ["fix/preview-readonly-on-bun-security-baseline-20261117", "iam-control-center-new-pr125-ci.vercel.app"],
  ["integration/peos-single-maintainer-bun-20261117", "iam-control-center-new-pr128-ci.vercel.app"],
  ["fix/g3-main-only-environment-contracts-20261121", "iam-control-center-new-pr146-ci.vercel.app"],
  ["security/main-postmerge-g3-exact-sha-20261121", "iam-control-center-new-pr147-ci.vercel.app"],
  ["fix/g3-postmerge-pr150-exact-main-20261121", "iam-control-center-new-pr151-ci.vercel.app"],
  ["fix/g1-b2-historical-readback-main-only-20261121", "iam-control-center-new-pr152-ci.vercel.app"],
  ["security/g1-b2-aead-restore-offline-contract-20261121", "iam-control-center-new-pr153-ci.vercel.app"],
  ["security/g1-b2-real-isolated-restore-20261122", "iam-control-center-new-pr154-ci.vercel.app"],
  ["fix/g1-restore-synthetic-marker-isolation-20261122", "iam-control-center-new-pr155-ci.vercel.app"],
  ["fix/g1-main-checks-paginated-gate-20261122", "iam-control-center-new-pr156-ci.vercel.app"],
  ["fix/g1-pg18-failed-phase-diagnostics-20261122", "iam-control-center-new-pr157-ci.vercel.app"],
  ["fix/g1-pg18-archive-stdin-node24-20261122", "iam-control-center-new-pr158-ci.vercel.app"],
  ["fix/g1-artifact-same-run-gh-cli-20261122", "iam-control-center-new-pr159-ci.vercel.app"],
  ["fix/g1-pg18-restore-apply-redacted-classifier-20261122", "iam-control-center-new-pr160-ci.vercel.app"],
  ["fix/g1-restore-custody-id-readonly-attestation-20261122", "iam-control-center-new-pr161-ci.vercel.app"],
  ["fix/peos-g1-neon-managed-default-acl-20261122", "iam-control-center-new-pr162-ci.vercel.app"],
  ["fix/peos-g1-rollback-marker-transactional-20261122", "iam-control-center-new-pr164-ci.vercel.app"],
  ["fix/peos-g1-empty-ledger-fail-closed-20261122", "iam-control-center-new-pr166-ci.vercel.app"],
  ["security/peos-prod-rbac-branch-attestation-20261121", "iam-control-center-new-prod-rbac-ci.vercel.app"],
  ["security/peos-prod-branch-fingerprint-20261121", "iam-control-center-new-branch-fingerprint-ci.vercel.app"],
  ["security/g3-pr128-trusted-executor-20261121", "iam-control-center-new-pr145-ci.vercel.app"],
  ["fix/g3-pr128-rbac-isolated-lease-20261120", "iam-control-center-new-pr144-ci.vercel.app"],
  ["fix/g1-security-gate-on-bun-baseline-20261118", "iam-control-center-new-pr130-ci.vercel.app"],
]);

export function approvedCallback(branch) {
  return branchCallbacks.get(branch) ?? "iam-control-center-new-ci-preview.vercel.app";
}
const APPROVED_PROJECT = "prj_OnuwD1iarOsXh6FFGkSpK4A5mj80";
const APPROVED_REPO = "alexoaraujo/iam-control-center-new";
const hostname = /^[a-zA-Z0-9-]+\.vercel\.app$/;

export function verifyPreviewBinding(env, domain, alias, deployment, previewAlias) {
  const { PR_HEAD_BRANCH: branch, PR_HEAD_SHA: sha, PR_HEAD_REPOSITORY: repository,
    E2E_CALLBACK_HOST: callback, E2E_DEPLOYMENT_HOST: preview } = env;
  if (repository !== APPROVED_REPO) throw Error("Untrusted PR repository");
  if (!branch || !/^[a-zA-Z0-9][a-zA-Z0-9/._-]*$/.test(branch) || /[\r\n]/.test(branch)) {
    throw Error("Invalid PR branch");
  }
  if (!/^[a-f0-9]{40}$/.test(sha ?? "")) throw Error("Invalid PR SHA");
  if (callback !== approvedCallback(branch) || !hostname.test(preview ?? "")) {
    throw Error("Callback or verified Preview hostname is invalid");
  }
  if (domain?.name !== callback || domain.projectId !== APPROVED_PROJECT ||
      domain.verified !== true || domain.gitBranch !== branch) {
    throw Error("Auth0 callback alias is not bound to this PR branch in Vercel");
  }
  if (alias?.alias !== callback || alias?.projectId !== APPROVED_PROJECT ||
      !alias.deploymentId || alias.deploymentId !== deployment?.id) {
    throw Error("Callback alias is not attached to a verified deployment");
  }
  const meta = deployment.meta ?? {};
  if (deployment.readyState !== "READY" || deployment.project?.id !== APPROVED_PROJECT ||
      meta.githubCommitRef !== branch || meta.githubCommitSha !== sha ||
      meta.githubOrg !== "alexoaraujo" || meta.githubRepo !== "iam-control-center-new") {
    throw Error("Callback alias deployment does not match the exact PR SHA");
  }
  // Vercel can omit manually reassigned aliases from deployment.alias. Verify
  // the actual Preview alias's live mapping independently against the SAME
  // SHA-verified deployment; never trust a cached alias array as proof.
  if (deployment.url !== preview &&
      (previewAlias?.alias !== preview || previewAlias.projectId !== APPROVED_PROJECT ||
       previewAlias.deploymentId !== deployment.id)) {
    throw Error("Callback deployment is not the exact-SHA verified Preview");
  }
  return { callbackHost: callback, callbackBranch: branch, callbackUrl: `https://${callback}` };
}

export async function bindPreview(env, fetcher = fetch) {
  if (!env.VERCEL_API_TOKEN || !env.GITHUB_ENV) {
    throw Error("VERCEL_API_TOKEN (protected Preview secret) and GITHUB_ENV are required");
  }
  if (env.VERCEL_PROJECT_ID !== APPROVED_PROJECT || env.VERCEL_TEAM_SLUG !== "aoa4") {
    throw Error("Unexpected Vercel project or team");
  }
  const headers = { Authorization: `Bearer ${env.VERCEL_API_TOKEN}`, Accept: "application/json" };
  const query = "?slug=aoa4";
  const get = async (path) => {
    const response = await fetcher(`https://api.vercel.com${path}${query}`, { headers, cache: "no-store" });
    if (!response.ok) throw Error(`Vercel alias verification failed: HTTP ${response.status}`);
    return response.json();
  };
  const callback = approvedCallback(env.PR_HEAD_BRANCH);
  const domain = await get(`/v9/projects/${APPROVED_PROJECT}/domains/${callback}`);
  const alias = await get(`/v4/aliases/${callback}`);
  if (!alias?.deploymentId) throw Error("Vercel callback alias has no deployment");
  const deployment = await get(`/v13/deployments/${encodeURIComponent(alias.deploymentId)}`);
  // Independently verify the host reported by Vercel's exact-SHA PR check.
  // Some Vercel API responses do not list aliases added after deployment.
  if (!hostname.test(env.E2E_DEPLOYMENT_HOST ?? "")) {
    throw Error("Invalid verified Preview hostname");
  }
  const previewAlias = env.E2E_DEPLOYMENT_HOST === deployment.url ? null
    : await get(`/v4/aliases/${encodeURIComponent(env.E2E_DEPLOYMENT_HOST)}`);
  const result = verifyPreviewBinding(env, domain, alias, deployment, previewAlias);
  appendFileSync(env.GITHUB_ENV, [
    `E2E_CALLBACK_HOST=${result.callbackHost}`,
    `E2E_CALLBACK_BRANCH=${result.callbackBranch}`,
    `E2E_DEPLOYMENT_URL=${result.callbackUrl}`,
    `E2E_BASE_URL=${result.callbackUrl}`,
  ].join("\n") + "\n");
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  bindPreview(process.env).then(
    result => console.log(`Verified Auth0 callback ${result.callbackHost} for PR branch ${result.callbackBranch} and exact SHA`),
    error => { console.error(`::error::${error.message}`); process.exitCode = 1; },
  );
}
