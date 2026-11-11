import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyPreviewBinding } from "./bind-e2e-preview.mjs";

const sha = "a".repeat(40);
const branch = "feat/auth0-neon-identity-sync-20261111";
const aliasHost = "iam-control-center-new-ci-preview.vercel.app";
const previewHost = "iam-control-center-123-aoa4.vercel.app";
const project = "prj_OnuwD1iarOsXh6FFGkSpK4A5mj80";
const env = { PR_HEAD_REPOSITORY: "alexoaraujo/iam-control-center-new", PR_HEAD_BRANCH: branch,
 PR_HEAD_SHA: sha, E2E_CALLBACK_HOST: aliasHost, E2E_DEPLOYMENT_HOST: previewHost };
const domain = { name: aliasHost, projectId: project, verified: true, gitBranch: branch };
const alias = { alias: aliasHost, projectId: project, deploymentId: "dpl_test" };
const deployment = { id: "dpl_test", readyState: "READY", project: { id: project },
  url: previewHost, meta: { githubCommitRef: branch, githubCommitSha: sha,
  githubOrg: "alexoaraujo", githubRepo: "iam-control-center-new" } };

test("sets fixed callback host and verified branch for exact SHA", () => {
  assert.deepEqual(verifyPreviewBinding(env, domain, alias, deployment), {
    callbackHost: aliasHost, callbackBranch: branch, callbackUrl: `https://${aliasHost}`,
  });
});
test("rejects stale Vercel branch even if callback host matches", () => {
  assert.throws(() => verifyPreviewBinding(env, { ...domain, gitBranch: "other-branch" }, alias, deployment), /not bound/);
});
test("rejects alias deployment pointing to a different SHA", () => {
  assert.throws(() => verifyPreviewBinding(env, domain, alias,
    { ...deployment, meta: { ...deployment.meta, githubCommitSha: "b".repeat(40) } }), /exact PR SHA/);
});
test("rejects stale alias mapping", () => {
  assert.throws(() => verifyPreviewBinding(env, domain,
    { ...alias, deploymentId: "dpl_old" }, deployment), /not attached/);
});
test("rejects forked PRs and callback substitutions", () => {
  assert.throws(() => verifyPreviewBinding({ ...env, PR_HEAD_REPOSITORY: "someone/fork" }, domain, alias, deployment), /Untrusted/);
  assert.throws(() => verifyPreviewBinding({ ...env, E2E_CALLBACK_HOST: "other.vercel.app" }, domain, alias, deployment), /invalid/);
});
test("rejects Preview deployment from a different SHA", () => {
  assert.throws(() => verifyPreviewBinding({ ...env, E2E_DEPLOYMENT_HOST: "other.vercel.app" },
    domain, alias, deployment), /verified Preview/);
});
