import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyPreviewBinding, approvedCallback } from "./bind-e2e-preview.mjs";

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

// The PR's Vercel Preview check may return a stable branch alias rather than
// the immutable deployment URL. A live alias lookup is required because the
// deployment.alias array can be stale after a manual alias reassignment.
test("accepts Preview alias only when independently bound to same exact-SHA deployment", () => {
  const stableHost = "iam-control-center-new-preview.vercel.app";
  const stableEnv = { ...env, E2E_DEPLOYMENT_HOST: stableHost };
  const previewAlias = { alias: stableHost, projectId: project, deploymentId: deployment.id };
  const staleAliasList = { ...deployment, alias: ["unrelated-preview.vercel.app"] };
  assert.deepEqual(verifyPreviewBinding(stableEnv, domain, alias, staleAliasList, previewAlias), {
    callbackHost: aliasHost, callbackBranch: branch, callbackUrl: `https://${aliasHost}`,
  });
});
test("rejects reassigned Preview alias pointing to another deployment or project", () => {
  const stableHost = "iam-control-center-new-preview.vercel.app";
  const stableEnv = { ...env, E2E_DEPLOYMENT_HOST: stableHost };
  const validAlias = { alias: stableHost, projectId: project, deploymentId: deployment.id };
  for (const change of [
    { deploymentId: "dpl_stale" },
    { projectId: "prj_untrusted" },
    { alias: "other-preview.vercel.app" },
  ]) {
    assert.throws(() => verifyPreviewBinding(stableEnv, domain, alias,
      { ...deployment, alias: [stableHost] }, { ...validAlias, ...change }), /verified Preview/);
  }
  assert.throws(() => verifyPreviewBinding(stableEnv, domain, alias, deployment), /verified Preview/);
});


test("PR143 has its own SHA-scoped callback mapping, never the shared PR132 alias", () => {
  const prBranch = "governance/pr-update-merge-default-20261120";
  const isolatedHost = "iam-control-center-new-pr143-ci.vercel.app";
  assert.equal(approvedCallback(prBranch), isolatedHost);
  assert.equal(approvedCallback("unknown-branch"), "iam-control-center-new-ci-preview.vercel.app");
  const isolatedEnv = { ...env, PR_HEAD_BRANCH: prBranch, E2E_CALLBACK_HOST: isolatedHost };
  const isolatedDomain = { ...domain, name: isolatedHost, gitBranch: prBranch };
  const isolatedAlias = { ...alias, alias: isolatedHost };
  const isolatedDeploy = { ...deployment, meta: { ...deployment.meta, githubCommitRef: prBranch } };
  assert.deepEqual(verifyPreviewBinding(isolatedEnv, isolatedDomain, isolatedAlias, isolatedDeploy), {
    callbackHost: isolatedHost, callbackBranch: prBranch, callbackUrl: `https://${isolatedHost}`,
  });
  assert.throws(() => verifyPreviewBinding(isolatedEnv, { ...isolatedDomain, gitBranch: "integration/peos-g1-g2-canonical-bun-20261118" }, isolatedAlias, isolatedDeploy), /not bound/);
});


test("PEOS exact-SHA callbacks: all eight active PR branches reject shared or stale bindings", () => {
  const mappings = [
    [
        "test/canonical-manifest-diff-gate-20261112",
        "iam-control-center-new-pr44-ci.vercel.app"
    ],
    [
        "fix/pr44-membership-canonical-drift-20261117",
        "iam-control-center-new-pr126-ci.vercel.app"
    ],
    [
        "test/g2-readonly-canonical-drift-contracts-20261118",
        "iam-control-center-new-pr131-ci.vercel.app"
    ],
    [
        "experiment/biome-lint-no-picomatch-20261117",
        "iam-control-center-new-pr119-ci.vercel.app"
    ],
    [
        "experiment/bun-native-tests-picomatch-removal-20261117",
        "iam-control-center-new-pr121-ci.vercel.app"
    ],
    [
        "fix/preview-readonly-on-bun-security-baseline-20261117",
        "iam-control-center-new-pr125-ci.vercel.app"
    ],
    [
        "integration/peos-single-maintainer-bun-20261117",
        "iam-control-center-new-pr128-ci.vercel.app"
    ],
    [
        "fix/g1-security-gate-on-bun-baseline-20261118",
        "iam-control-center-new-pr130-ci.vercel.app"
    ]
];
  for (const [prBranch, isolatedHost] of mappings) {
    assert.equal(approvedCallback(prBranch), isolatedHost, prBranch);
    const ownEnv = { ...env, PR_HEAD_BRANCH: prBranch, E2E_CALLBACK_HOST: isolatedHost };
    const ownDomain = { ...domain, name: isolatedHost, gitBranch: prBranch };
    const ownAlias = { ...alias, alias: isolatedHost };
    const ownDeployment = { ...deployment, meta: { ...deployment.meta, githubCommitRef: prBranch } };
    assert.deepEqual(verifyPreviewBinding(ownEnv, ownDomain, ownAlias, ownDeployment), {
      callbackHost: isolatedHost, callbackBranch: prBranch, callbackUrl: `https://${isolatedHost}`,
    });
    assert.throws(() => verifyPreviewBinding(ownEnv, { ...ownDomain, gitBranch: "integration/peos-g1-g2-canonical-bun-20261118" }, ownAlias, ownDeployment), /not bound/);
    assert.throws(() => verifyPreviewBinding({ ...ownEnv, E2E_CALLBACK_HOST: aliasHost }, ownDomain, ownAlias, ownDeployment), /invalid/);
    assert.throws(() => verifyPreviewBinding(ownEnv, ownDomain, ownAlias, { ...ownDeployment, meta: { ...ownDeployment.meta, githubCommitSha: "b".repeat(40) } }), /exact PR SHA/);
  }
});
