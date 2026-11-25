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


test("PEOS exact-SHA callbacks: all nine active PR branches reject shared or stale bindings", () => {
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
    ],
    [
        "security/g3-pr128-trusted-executor-20261121",
        "iam-control-center-new-pr145-ci.vercel.app"
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


test("PR146 callback is exclusively bound to its own branch and exact SHA", () => {
  const b = "fix/g3-main-only-environment-contracts-20261121";
  const h = "iam-control-center-new-pr146-ci.vercel.app";
  assert.equal(approvedCallback(b), h);
  const e = { ...env, PR_HEAD_BRANCH: b, E2E_CALLBACK_HOST: h };
  const d = { ...domain, name: h, gitBranch: b };
  const a = { ...alias, alias: h };
  const dep = { ...deployment, meta: { ...deployment.meta, githubCommitRef: b } };
  assert.deepEqual(verifyPreviewBinding(e, d, a, dep), {
    callbackHost: h, callbackBranch: b, callbackUrl: `https://${h}`,
  });
  assert.throws(() => verifyPreviewBinding(e, { ...d, gitBranch: "integration/peos-single-maintainer-bun-20261117" }, a, dep), /not bound/);
  assert.throws(() => verifyPreviewBinding(e, { ...d, name: "iam-control-center-new-pr128-ci.vercel.app" }, a, dep), /not bound/);
  assert.throws(() => verifyPreviewBinding(e, d, a, { ...dep, meta: { ...dep.meta, githubCommitSha: "b".repeat(40) } }), /exact PR SHA/);
});

test("PR147 postmerge security gate has an exact branch-scoped Preview callback", () => {
  const b = "security/main-postmerge-g3-exact-sha-20261121";
  const h = "iam-control-center-new-pr147-ci.vercel.app";
  assert.equal(approvedCallback(b), h);
  const e = { ...env, PR_HEAD_BRANCH: b, E2E_CALLBACK_HOST: h };
  const d = { ...domain, name: h, gitBranch: b };
  const a = { ...alias, alias: h };
  const dep = { ...deployment, meta: { ...deployment.meta, githubCommitRef: b } };
  assert.deepEqual(verifyPreviewBinding(e, d, a, dep), {
    callbackHost: h, callbackBranch: b, callbackUrl: `https://${h}`,
  });
  assert.throws(() => verifyPreviewBinding(e, { ...d, gitBranch: "integration/peos-single-maintainer-bun-20261117" }, a, dep), /not bound/);
  assert.throws(() => verifyPreviewBinding(e, d, a, { ...dep, meta: { ...dep.meta, githubCommitSha: "b".repeat(40) } }), /exact PR SHA/);
});

test("Production RBAC attestation PR callback is bound only to its exact branch and SHA", () => {
  const b = "security/peos-prod-rbac-branch-attestation-20261121";
  const h = "iam-control-center-new-prod-rbac-ci.vercel.app";
  assert.equal(approvedCallback(b), h);
  const e = { ...env, PR_HEAD_BRANCH: b, E2E_CALLBACK_HOST: h };
  const d = { ...domain, name: h, gitBranch: b };
  const a = { ...alias, alias: h };
  const dep = { ...deployment, meta: { ...deployment.meta, githubCommitRef: b } };
  assert.deepEqual(verifyPreviewBinding(e, d, a, dep), {
    callbackHost: h, callbackBranch: b, callbackUrl: `https://${h}`,
  });
  assert.throws(() => verifyPreviewBinding(e, { ...d, gitBranch: "integration/peos-single-maintainer-bun-20261117" }, a, dep), /not bound/);
  assert.throws(() => verifyPreviewBinding(e, d, a,
    { ...dep, meta: { ...dep.meta, githubCommitSha: "b".repeat(40) } }), /exact PR SHA/);
});

test("fingerprint diagnostic Preview binds to its unique PR branch, never the merged PR148 branch", () => {
  const b = "security/peos-prod-branch-fingerprint-20261121";
  const h = "iam-control-center-new-branch-fingerprint-ci.vercel.app";
  assert.equal(approvedCallback(b), h);
  const e = { ...env, PR_HEAD_BRANCH: b, E2E_CALLBACK_HOST: h };
  const d = { ...domain, name: h, gitBranch: b };
  const a = { ...alias, alias: h };
  const dep = { ...deployment, meta: { ...deployment.meta, githubCommitRef: b } };
  assert.deepEqual(verifyPreviewBinding(e, d, a, dep), {
    callbackHost: h, callbackBranch: b, callbackUrl: `https://${h}`,
  });
  assert.throws(() => verifyPreviewBinding(e, { ...d, gitBranch: "security/peos-prod-rbac-branch-attestation-20261121" }, a, dep), /not bound/);
  assert.throws(() => verifyPreviewBinding(e, d, a,
    { ...dep, meta: { ...dep.meta, githubCommitSha: "b".repeat(40) } }), /exact PR SHA/);
});

test("PR151 callback is exclusive to its own exact SHA deployment, never shared Preview", () => {
  const b = "fix/g3-postmerge-pr150-exact-main-20261121";
  const h = "iam-control-center-new-pr151-ci.vercel.app";
  assert.equal(approvedCallback(b), h);
  const e = { ...env, PR_HEAD_BRANCH: b, E2E_CALLBACK_HOST: h };
  const d = { ...domain, name: h, gitBranch: b };
  const a = { ...alias, alias: h };
  const dep = { ...deployment, meta: { ...deployment.meta, githubCommitRef: b } };
  assert.deepEqual(verifyPreviewBinding(e, d, a, dep), {
    callbackHost: h, callbackBranch: b, callbackUrl: `https://${h}`,
  });
  assert.throws(() => verifyPreviewBinding(e, { ...d, gitBranch: "integration/peos-g1-g2-canonical-bun-20261118" }, a, dep), /not bound/);
  assert.throws(() => verifyPreviewBinding(e, { ...d, name: "iam-control-center-new-ci-preview.vercel.app" }, a, dep), /not bound/);
  assert.throws(() => verifyPreviewBinding(e, d, a, { ...dep, meta: { ...dep.meta, githubCommitSha: "b".repeat(40) } }), /exact PR SHA/);
});

test("PR152 callback isolated to exact PR branch and SHA", () => {
  const b = "fix/g1-b2-historical-readback-main-only-20261121";
  const h = "iam-control-center-new-pr152-ci.vercel.app";
  assert.equal(approvedCallback(b), h);
  const e = { ...env, PR_HEAD_BRANCH: b, E2E_CALLBACK_HOST: h };
  const d = { ...domain, name: h, gitBranch: b };
  const a = { ...alias, alias: h };
  const dep = { ...deployment, meta: { ...deployment.meta, githubCommitRef: b } };
  assert.deepEqual(verifyPreviewBinding(e, d, a, dep), {
    callbackHost: h, callbackBranch: b, callbackUrl: `https://${h}`,
  });
  assert.throws(() => verifyPreviewBinding(e, { ...d, gitBranch: "fix/g3-postmerge-pr150-exact-main-20261121" }, a, dep), /not bound/);
  assert.throws(() => verifyPreviewBinding(e, { ...d, name: "iam-control-center-new-ci-preview.vercel.app" }, a, dep), /not bound/);
  assert.throws(() => verifyPreviewBinding(e, d, a, { ...dep, meta: { ...dep.meta, githubCommitSha: "b".repeat(40) } }), /exact PR SHA/);
});


test("PR154 callback exclusively bound to exact branch and deployment SHA", () => {
  const b = "security/g1-b2-real-isolated-restore-20261122";
  const h = "iam-control-center-new-pr154-ci.vercel.app";
  assert.equal(approvedCallback(b), h);
  const e = { ...env, PR_HEAD_BRANCH: b, E2E_CALLBACK_HOST: h };
  const d = { ...domain, name: h, gitBranch: b };
  const a = { ...alias, alias: h };
  const dep = { ...deployment, meta: { ...deployment.meta, githubCommitRef: b } };
  assert.deepEqual(verifyPreviewBinding(e, d, a, dep), {
    callbackHost: h, callbackBranch: b, callbackUrl: `https://${h}`,
  });
  assert.throws(() => verifyPreviewBinding(e, { ...d, gitBranch: "security/g1-b2-aead-restore-offline-contract-20261121" }, a, dep), /not bound/);
  assert.throws(() => verifyPreviewBinding(e, { ...d, name: "iam-control-center-new-ci-preview.vercel.app" }, a, dep), /not bound/);
  assert.throws(() => verifyPreviewBinding(e, d, a, { ...dep, meta: { ...dep.meta, githubCommitSha: "c".repeat(40) } }), /exact PR SHA/);
});



test("PR164 callback is exclusive to its original branch and exact-SHA Preview deployment", () => {
  const prBranch = "fix/peos-g1-rollback-marker-transactional-20261122";
  const host = "iam-control-center-new-pr164-ci.vercel.app";
  assert.equal(approvedCallback(prBranch), host);
  const scopedEnv = { ...env, PR_HEAD_BRANCH: prBranch, E2E_CALLBACK_HOST: host };
  const scopedDomain = { ...domain, name: host, gitBranch: prBranch };
  const scopedAlias = { ...alias, alias: host };
  const scopedDeployment = { ...deployment, meta: { ...deployment.meta, githubCommitRef: prBranch } };
  assert.equal(verifyPreviewBinding(scopedEnv, scopedDomain, scopedAlias, scopedDeployment).callbackHost, host);
  assert.throws(() => verifyPreviewBinding(scopedEnv, { ...scopedDomain, gitBranch: branch }, scopedAlias, scopedDeployment), /not bound/);
  assert.throws(() => verifyPreviewBinding(scopedEnv, scopedDomain, { ...scopedAlias, deploymentId: "dpl_stale" }, scopedDeployment), /not attached/);
  assert.throws(() => verifyPreviewBinding(scopedEnv, scopedDomain, scopedAlias,
    { ...scopedDeployment, meta: { ...scopedDeployment.meta, githubCommitSha: "b".repeat(40) } }), /exact PR SHA/);
  assert.throws(() => verifyPreviewBinding({ ...scopedEnv, E2E_CALLBACK_HOST: aliasHost },
    scopedDomain, scopedAlias, scopedDeployment), /invalid/);
});

test("PR166 ledger branch has its own callback and refuses stale branch, alias or SHA", () => {
  const prBranch = "fix/peos-g1-empty-ledger-fail-closed-20261122";
  const host = "iam-control-center-new-pr166-ci.vercel.app";
  assert.equal(approvedCallback(prBranch), host);
  const e = { ...env, PR_HEAD_BRANCH: prBranch, E2E_CALLBACK_HOST: host };
  const d = { ...domain, name: host, gitBranch: prBranch };
  const a = { ...alias, alias: host };
  const dep = { ...deployment, meta: { ...deployment.meta, githubCommitRef: prBranch } };
  assert.equal(verifyPreviewBinding(e, d, a, dep).callbackBranch, prBranch);
  assert.throws(() => verifyPreviewBinding(e, { ...d, gitBranch: branch }, a, dep), /not bound/);
  assert.throws(() => verifyPreviewBinding(e, d, { ...a, deploymentId: "dpl_old" }, dep), /not attached/);
  assert.throws(() => verifyPreviewBinding(e, d, a,
    { ...dep, meta: { ...dep.meta, githubCommitSha: "b".repeat(40) } }), /exact PR SHA/);
  assert.throws(() => verifyPreviewBinding({ ...e, E2E_CALLBACK_HOST: aliasHost },
    d, a, dep), /invalid/);
});

test("PR169 callback host is unique and rejects a stale or shared Vercel branch", () => {
  const newBranch = "test/peos-g3-tree-inventory-20261123";
  const callbackHost = "iam-control-center-new-pr169-ci.vercel.app";
  assert.equal(approvedCallback(newBranch), callbackHost);
  assert.notEqual(approvedCallback(newBranch), approvedCallback("alexoaraujo-patch-1"));
  const scoped = { ...env, PR_HEAD_BRANCH: newBranch, E2E_CALLBACK_HOST: callbackHost };
  const newDomain = { ...domain, name: callbackHost, gitBranch: newBranch };
  const newAlias = { ...alias, alias: callbackHost };
  const newDeployment = { ...deployment, meta: { ...deployment.meta, githubCommitRef: newBranch } };
  assert.equal(verifyPreviewBinding(scoped, newDomain, newAlias, newDeployment).callbackHost, callbackHost);
  assert.throws(() => verifyPreviewBinding(scoped, {...newDomain, gitBranch: "alexoaraujo-patch-1"}, newAlias, newDeployment), /not bound/);
  assert.throws(() => verifyPreviewBinding(scoped, newDomain, newAlias,
    {...newDeployment, meta: {...newDeployment.meta, githubCommitSha: "b".repeat(40)}}), /exact PR SHA/);
});

test("PR171 dedicated callback rejects stale branch, wrong alias and SHA", () => {
  const branch = "audit/peos-g3-current-main-rebaseline-20261123";
  const host = "iam-control-center-new-pr171-ci.vercel.app";
  assert.equal(approvedCallback(branch), host);
  assert.notEqual(approvedCallback(branch), approvedCallback("test/peos-g3-tree-inventory-20261123"));
  const scoped = { ...env, PR_HEAD_BRANCH: branch, E2E_CALLBACK_HOST: host };
  const domainNew = { ...domain, name: host, gitBranch: branch };
  const aliasNew = { ...alias, alias: host };
  const deploymentNew = { ...deployment, meta: { ...deployment.meta, githubCommitRef: branch } };
  assert.equal(verifyPreviewBinding(scoped, domainNew, aliasNew, deploymentNew).callbackHost, host);
  assert.throws(() => verifyPreviewBinding(scoped, {...domainNew, gitBranch: "test/peos-g3-tree-inventory-20261123"}, aliasNew, deploymentNew), /not bound/);
  assert.throws(() => verifyPreviewBinding(scoped, domainNew, {...aliasNew, alias: "iam-control-center-new-pr169-ci.vercel.app"}, deploymentNew), /mismatch|alias|invalid/i);
  assert.throws(() => verifyPreviewBinding(scoped, domainNew, aliasNew,
    {...deploymentNew, meta: {...deploymentNew.meta, githubCommitSha: "f".repeat(40)}}), /exact PR SHA/);
});

test("PR117 security workflow change requires its dedicated branch-bound callback", () => {
  const b = "audit/peos-github-scope-hardening-20261117";
  const h = "iam-control-center-new-pr117-ci.vercel.app";
  assert.equal(approvedCallback(b), h);
  const e = { ...env, PR_HEAD_BRANCH: b, E2E_CALLBACK_HOST: h };
  const d = { ...domain, name: h, gitBranch: b };
  const a = { ...alias, alias: h };
  const p = { ...deployment, meta: { ...deployment.meta, githubCommitRef: b } };
  assert.deepEqual(verifyPreviewBinding(e, d, a, p), {
    callbackHost: h, callbackBranch: b, callbackUrl: "https://" + h,
  });
  assert.throws(() => verifyPreviewBinding(e, { ...d, gitBranch: "integration/peos-g1-g2-canonical-bun-20261118" }, a, p), /not bound/);
  assert.throws(() => verifyPreviewBinding(e, { ...d, name: aliasHost }, a, p), /not bound/);
  assert.throws(() => verifyPreviewBinding(e, d, a, { ...p, meta: { ...p.meta, githubCommitSha: "b".repeat(40) } }), /exact PR SHA/);
});

test("PR173 canonical reconciliation callback is branch-bound and exact-SHA only", () => {
  const prBranch = "feat/peos-canonical-reconciliation-readonly-20261123";
  const host = "iam-control-center-new-pr173-ci.vercel.app";
  assert.equal(approvedCallback(prBranch), host);
  assert.notEqual(approvedCallback(prBranch), approvedCallback("audit/peos-g3-current-main-rebaseline-20261123"));
  const scoped = { ...env, PR_HEAD_BRANCH: prBranch, E2E_CALLBACK_HOST: host };
  const scopedDomain = { ...domain, name: host, gitBranch: prBranch };
  const scopedAlias = { ...alias, alias: host };
  const scopedDeployment = { ...deployment, meta: { ...deployment.meta, githubCommitRef: prBranch } };
  assert.equal(verifyPreviewBinding(scoped, scopedDomain, scopedAlias, scopedDeployment).callbackHost, host);
  assert.throws(() => verifyPreviewBinding(scoped,
    { ...scopedDomain, gitBranch: "audit/peos-g3-current-main-rebaseline-20261123" },
    scopedAlias, scopedDeployment), /not bound/);
  assert.throws(() => verifyPreviewBinding(scoped, scopedDomain,
    { ...scopedAlias, deploymentId: "dpl_stale" }, scopedDeployment), /not attached/);
  assert.throws(() => verifyPreviewBinding(scoped, scopedDomain, scopedAlias,
    { ...scopedDeployment, meta: { ...scopedDeployment.meta, githubCommitSha: "b".repeat(40) } }), /exact PR SHA/);
});

test("PR174 transactional fixture runner Preview binds the unique branch and exact SHA", () => {
  const prBranch = "feat/peos-fixture-transactional-migration-runner-20261123";
  const host = "iam-control-center-new-pr174-ci.vercel.app";
  assert.equal(approvedCallback(prBranch), host);
  assert.notEqual(host, approvedCallback("feat/peos-canonical-reconciliation-readonly-20261123"));
  const scoped = { ...env, PR_HEAD_BRANCH: prBranch, E2E_CALLBACK_HOST: host };
  const scopedDomain = { ...domain, name: host, gitBranch: prBranch };
  const scopedAlias = { ...alias, alias: host };
  const scopedDeployment = { ...deployment, meta: { ...deployment.meta, githubCommitRef: prBranch } };
  assert.equal(verifyPreviewBinding(scoped, scopedDomain, scopedAlias, scopedDeployment).callbackHost, host);
  assert.throws(() => verifyPreviewBinding(scoped, {...scopedDomain, gitBranch: "other-branch"}, scopedAlias, scopedDeployment), /not bound/);
  assert.throws(() => verifyPreviewBinding(scoped, scopedDomain, scopedAlias, {...scopedDeployment, meta: {...scopedDeployment.meta, githubCommitSha: "b".repeat(40)}}), /exact PR SHA/);
});

test("PR175 role reconciliation fixture Preview binds unique branch and exact SHA", () => {
  const prBranch = "feat/peos-role-reconciliation-fixture-20261123";
  const host = "iam-control-center-new-pr175-ci.vercel.app";
  assert.equal(approvedCallback(prBranch), host);
  assert.notEqual(host, approvedCallback("feat/peos-fixture-transactional-migration-runner-20261123"));
  const scoped = { ...env, PR_HEAD_BRANCH: prBranch, E2E_CALLBACK_HOST: host };
  const scopedDomain = { ...domain, name: host, gitBranch: prBranch };
  const scopedAlias = { ...alias, alias: host };
  const scopedDeployment = { ...deployment, meta: { ...deployment.meta, githubCommitRef: prBranch } };
  assert.equal(verifyPreviewBinding(scoped, scopedDomain, scopedAlias, scopedDeployment).callbackHost, host);
  assert.throws(() => verifyPreviewBinding(scoped, {...scopedDomain, gitBranch: "other-branch"}, scopedAlias, scopedDeployment), /not bound/);
  assert.throws(() => verifyPreviewBinding(scoped, scopedDomain, scopedAlias, {...scopedDeployment, meta: {...scopedDeployment.meta, githubCommitSha: "b".repeat(40)}}), /exact PR SHA/);
});

test("PR176 baseline preparation Preview binds unique branch and exact SHA", () => {
  const prBranch = "feat/peos-canonical-baseline-preparation-20261123";
  const host = "iam-control-center-new-pr176-ci.vercel.app";
  assert.equal(approvedCallback(prBranch), host);
  assert.notEqual(host, approvedCallback("feat/peos-role-reconciliation-fixture-20261123"));
  const scoped = { ...env, PR_HEAD_BRANCH: prBranch, E2E_CALLBACK_HOST: host };
  const scopedDomain = { ...domain, name: host, gitBranch: prBranch };
  const scopedAlias = { ...alias, alias: host };
  const scopedDeployment = { ...deployment, meta: { ...deployment.meta, githubCommitRef: prBranch } };
  assert.equal(verifyPreviewBinding(scoped, scopedDomain, scopedAlias, scopedDeployment).callbackHost, host);
  assert.throws(() => verifyPreviewBinding(scoped, {...scopedDomain, gitBranch: "other-branch"}, scopedAlias, scopedDeployment), /not bound/);
  assert.throws(() => verifyPreviewBinding(scoped, scopedDomain, scopedAlias, {...scopedDeployment, meta: {...scopedDeployment.meta, githubCommitSha: "b".repeat(40)}}), /exact PR SHA/);
});

test("PR177 evidence collector Preview binds unique branch and exact SHA", () => {
  const prBranch = "feat/peos-baseline-evidence-collector-fixture-20261123";
  const host = "iam-control-center-new-pr177-ci.vercel.app";
  assert.equal(approvedCallback(prBranch), host);
  assert.notEqual(host, approvedCallback("feat/peos-canonical-baseline-preparation-20261123"));
  const scoped = { ...env, PR_HEAD_BRANCH: prBranch, E2E_CALLBACK_HOST: host };
  const scopedDomain = { ...domain, name: host, gitBranch: prBranch };
  const scopedAlias = { ...alias, alias: host };
  const scopedDeployment = { ...deployment, meta: { ...deployment.meta, githubCommitRef: prBranch } };
  assert.equal(verifyPreviewBinding(scoped, scopedDomain, scopedAlias, scopedDeployment).callbackHost, host);
  assert.throws(() => verifyPreviewBinding(scoped, {...scopedDomain, gitBranch: "other-branch"}, scopedAlias, scopedDeployment), /not bound/);
  assert.throws(() => verifyPreviewBinding(scoped, scopedDomain, scopedAlias, {...scopedDeployment, meta: {...scopedDeployment.meta, githubCommitSha: "b".repeat(40)}}), /exact PR SHA/);
});

test("PR178 collector privilege preflight Preview binds unique branch and exact SHA", () => {
  const prBranch = "feat/peos-collector-effective-privilege-preflight-20261123";
  const host = "iam-control-center-new-pr178-ci.vercel.app";
  assert.equal(approvedCallback(prBranch), host);
  assert.notEqual(host, approvedCallback("feat/peos-baseline-evidence-collector-fixture-20261123"));
  const scoped = { ...env, PR_HEAD_BRANCH: prBranch, E2E_CALLBACK_HOST: host };
  const scopedDomain = { ...domain, name: host, gitBranch: prBranch };
  const scopedAlias = { ...alias, alias: host };
  const scopedDeployment = { ...deployment, meta: { ...deployment.meta, githubCommitRef: prBranch } };
  assert.equal(verifyPreviewBinding(scoped, scopedDomain, scopedAlias, scopedDeployment).callbackHost, host);
  assert.throws(() => verifyPreviewBinding(scoped, {...scopedDomain, gitBranch: "other-branch"}, scopedAlias, scopedDeployment), /not bound/);
  assert.throws(() => verifyPreviewBinding(scoped, scopedDomain, scopedAlias, {...scopedDeployment, meta: {...scopedDeployment.meta, githubCommitSha: "b".repeat(40)}}), /exact PR SHA/);
});

test("PR179 canonical ledger adapter Preview binds unique branch and exact SHA", () => {
  const prBranch = "feat/peos-canonical-ledger-adapter-20261123";
  const host = "iam-control-center-new-pr179-ci.vercel.app";
  assert.equal(approvedCallback(prBranch), host);
  assert.notEqual(host, approvedCallback("feat/peos-collector-effective-privilege-preflight-20261123"));
  const scoped = { ...env, PR_HEAD_BRANCH: prBranch, E2E_CALLBACK_HOST: host };
  const scopedDomain = { ...domain, name: host, gitBranch: prBranch };
  const scopedAlias = { ...alias, alias: host };
  const scopedDeployment = { ...deployment, meta: { ...deployment.meta, githubCommitRef: prBranch } };
  assert.equal(verifyPreviewBinding(scoped, scopedDomain, scopedAlias, scopedDeployment).callbackHost, host);
  assert.throws(() => verifyPreviewBinding(scoped, {...scopedDomain, gitBranch: "other-branch"}, scopedAlias, scopedDeployment), /not bound/);
  assert.throws(() => verifyPreviewBinding(scoped, scopedDomain, scopedAlias, {...scopedDeployment, meta: {...scopedDeployment.meta, githubCommitSha: "b".repeat(40)}}), /exact PR SHA/);
});

test("PR180 protected Development collector Preview binds unique branch and exact SHA", () => {
  const prBranch = "feat/peos-protected-development-evidence-20261124";
  const host = "iam-control-center-new-pr180-ci.vercel.app";
  assert.equal(approvedCallback(prBranch), host);
  assert.notEqual(host, approvedCallback("feat/peos-canonical-ledger-adapter-20261123"));
  const scoped = { ...env, PR_HEAD_BRANCH: prBranch, E2E_CALLBACK_HOST: host };
  const scopedDomain = { ...domain, name: host, gitBranch: prBranch };
  const scopedAlias = { ...alias, alias: host };
  const scopedDeployment = { ...deployment, meta: { ...deployment.meta, githubCommitRef: prBranch } };
  assert.equal(verifyPreviewBinding(scoped, scopedDomain, scopedAlias, scopedDeployment).callbackHost, host);
  assert.throws(() => verifyPreviewBinding(scoped, {...scopedDomain, gitBranch: "other-branch"}, scopedAlias, scopedDeployment), /not bound/);
  assert.throws(() => verifyPreviewBinding(scoped, scopedDomain, scopedAlias, {...scopedDeployment, meta: {...scopedDeployment.meta, githubCommitSha: "b".repeat(40)}}), /exact PR SHA/);
});

test("PR181 offline signature custody Preview binds unique branch and exact SHA", () => {
  const prBranch = "feat/peos-offline-signature-custody-20261124";
  const host = "iam-control-center-new-pr181-ci.vercel.app";
  assert.equal(approvedCallback(prBranch), host);
  assert.notEqual(host, approvedCallback("feat/peos-protected-development-evidence-20261124"));
  const scoped = { ...env, PR_HEAD_BRANCH: prBranch, E2E_CALLBACK_HOST: host };
  const scopedDomain = { ...domain, name: host, gitBranch: prBranch };
  const scopedAlias = { ...alias, alias: host };
  const scopedDeployment = { ...deployment, meta: { ...deployment.meta, githubCommitRef: prBranch } };
  assert.equal(verifyPreviewBinding(scoped, scopedDomain, scopedAlias, scopedDeployment).callbackHost, host);
  assert.throws(() => verifyPreviewBinding(scoped, {...scopedDomain, gitBranch: "other-branch"}, scopedAlias, scopedDeployment), /not bound/);
  assert.throws(() => verifyPreviewBinding(scoped, scopedDomain, scopedAlias, {...scopedDeployment, meta: {...scopedDeployment.meta, githubCommitSha: "b".repeat(40)}}), /exact PR SHA/);
});

test("PR182 G2 environment preflight Preview binds unique branch and exact SHA", () => {
  const prBranch = "feat/peos-g2-protected-environment-preflight-20261124";
  const host = "iam-control-center-new-pr182-ci.vercel.app";
  assert.equal(approvedCallback(prBranch), host);
  assert.notEqual(host, approvedCallback("feat/peos-protected-development-evidence-20261124"));
  const scoped = { ...env, PR_HEAD_BRANCH: prBranch, E2E_CALLBACK_HOST: host };
  const scopedDomain = { ...domain, name: host, gitBranch: prBranch };
  const scopedAlias = { ...alias, alias: host };
  const scopedDeployment = { ...deployment, meta: { ...deployment.meta, githubCommitRef: prBranch } };
  assert.equal(verifyPreviewBinding(scoped, scopedDomain, scopedAlias, scopedDeployment).callbackHost, host);
  assert.throws(() => verifyPreviewBinding(scoped, {...scopedDomain, gitBranch: "other-branch"}, scopedAlias, scopedDeployment), /not bound/);
  assert.throws(() => verifyPreviewBinding(scoped, scopedDomain, scopedAlias, {...scopedDeployment, meta: {...scopedDeployment.meta, githubCommitSha: "b".repeat(40)}}), /exact PR SHA/);
});

test("PR183 G2 reader ACL rehearsal Preview binds unique branch and exact SHA", () => {
  const prBranch = "test/peos-g2-reader-acl-rehearsal-20261125";
  const host = "iam-control-center-new-pr183-ci.vercel.app";
  assert.equal(approvedCallback(prBranch), host);
  assert.notEqual(host, approvedCallback("feat/peos-g2-protected-environment-preflight-20261124"));
  const scoped = { ...env, PR_HEAD_BRANCH: prBranch, E2E_CALLBACK_HOST: host };
  const scopedDomain = { ...domain, name: host, gitBranch: prBranch };
  const scopedAlias = { ...alias, alias: host };
  const scopedDeployment = { ...deployment, meta: { ...deployment.meta, githubCommitRef: prBranch } };
  assert.equal(verifyPreviewBinding(scoped, scopedDomain, scopedAlias, scopedDeployment).callbackHost, host);
  assert.throws(() => verifyPreviewBinding(scoped, {...scopedDomain, gitBranch: "other-branch"}, scopedAlias, scopedDeployment), /not bound/);
  assert.throws(() => verifyPreviewBinding(scoped, scopedDomain, scopedAlias, {...scopedDeployment, meta: {...scopedDeployment.meta, githubCommitSha: "b".repeat(40)}}), /exact PR SHA/);
});

test("PR184 G2 direct login preflight Preview binds unique branch and exact SHA", () => {
  const prBranch = "feat/peos-g2-clone-direct-login-preflight-20261125";
  const host = "iam-control-center-new-pr184-ci.vercel.app";
  assert.equal(approvedCallback(prBranch), host);
  assert.notEqual(host, approvedCallback("test/peos-g2-reader-acl-rehearsal-20261125"));
  const scoped = { ...env, PR_HEAD_BRANCH: prBranch, E2E_CALLBACK_HOST: host };
  const scopedDomain = { ...domain, name: host, gitBranch: prBranch };
  const scopedAlias = { ...alias, alias: host };
  const scopedDeployment = { ...deployment, meta: { ...deployment.meta, githubCommitRef: prBranch } };
  assert.equal(verifyPreviewBinding(scoped, scopedDomain, scopedAlias, scopedDeployment).callbackHost, host);
  assert.throws(() => verifyPreviewBinding(scoped, {...scopedDomain, gitBranch: "other-branch"}, scopedAlias, scopedDeployment), /not bound/);
  assert.throws(() => verifyPreviewBinding(scoped, scopedDomain, scopedAlias, {...scopedDeployment, meta: {...scopedDeployment.meta, githubCommitSha: "b".repeat(40)}}), /exact PR SHA/);
});

test("PR185 G2 legacy provenance proof Preview binds unique branch and exact SHA", () => {
  const prBranch = "feat/peos-g2-legacy-provenance-proof-20261125";
  const host = "iam-control-center-new-pr185-ci.vercel.app";
  assert.equal(approvedCallback(prBranch), host);
  assert.notEqual(host, approvedCallback("feat/peos-g2-clone-direct-login-preflight-20261125"));
  const scoped = { ...env, PR_HEAD_BRANCH: prBranch, E2E_CALLBACK_HOST: host };
  const scopedDomain = { ...domain, name: host, gitBranch: prBranch };
  const scopedAlias = { ...alias, alias: host };
  const scopedDeployment = { ...deployment, meta: { ...deployment.meta, githubCommitRef: prBranch } };
  assert.equal(verifyPreviewBinding(scoped, scopedDomain, scopedAlias, scopedDeployment).callbackHost, host);
  assert.throws(() => verifyPreviewBinding(scoped, {...scopedDomain, gitBranch: "other-branch"}, scopedAlias, scopedDeployment), /not bound/);
  assert.throws(() => verifyPreviewBinding(scoped, scopedDomain, scopedAlias, {...scopedDeployment, meta: {...scopedDeployment.meta, githubCommitSha: "b".repeat(40)}}), /exact PR SHA/);
});

test("PR186 G2 local preflight diagnostics Preview binds unique branch and exact SHA", () => {
  const prBranch = "fix/peos-g2-local-preflight-diagnostics-20261125";
  const host = "iam-control-center-new-pr186-ci.vercel.app";
  assert.equal(approvedCallback(prBranch), host);
  assert.notEqual(host, approvedCallback("feat/peos-g2-legacy-provenance-proof-20261125"));
  const scoped = { ...env, PR_HEAD_BRANCH: prBranch, E2E_CALLBACK_HOST: host };
  const scopedDomain = { ...domain, name: host, gitBranch: prBranch };
  const scopedAlias = { ...alias, alias: host };
  const scopedDeployment = { ...deployment, meta: { ...deployment.meta, githubCommitRef: prBranch } };
  assert.equal(verifyPreviewBinding(scoped, scopedDomain, scopedAlias, scopedDeployment).callbackHost, host);
  assert.throws(() => verifyPreviewBinding(scoped, {...scopedDomain, gitBranch: "other-branch"}, scopedAlias, scopedDeployment), /not bound/);
  assert.throws(() => verifyPreviewBinding(scoped, scopedDomain, scopedAlias, {...scopedDeployment, meta: {...scopedDeployment.meta, githubCommitSha: "b".repeat(40)}}), /exact PR SHA/);
});

test("PR187 G2 ACL review candidate Preview binds unique branch and exact SHA", () => {
  const prBranch = "feat/peos-g2-acl-candidate-contract-20261125";
  const host = "iam-control-center-new-pr187-ci.vercel.app";
  assert.equal(approvedCallback(prBranch), host);
  assert.notEqual(host, approvedCallback("fix/peos-g2-local-preflight-diagnostics-20261125"));
  const scoped = { ...env, PR_HEAD_BRANCH: prBranch, E2E_CALLBACK_HOST: host };
  const scopedDomain = { ...domain, name: host, gitBranch: prBranch };
  const scopedAlias = { ...alias, alias: host };
  const scopedDeployment = { ...deployment, meta: { ...deployment.meta, githubCommitRef: prBranch } };
  assert.equal(verifyPreviewBinding(scoped, scopedDomain, scopedAlias, scopedDeployment).callbackHost, host);
  assert.throws(() => verifyPreviewBinding(scoped, {...scopedDomain, gitBranch: "other-branch"}, scopedAlias, scopedDeployment), /not bound/);
  assert.throws(() => verifyPreviewBinding(scoped, scopedDomain, scopedAlias, {...scopedDeployment, meta: {...scopedDeployment.meta, githubCommitSha: "b".repeat(40)}}), /exact PR SHA/);
});


test("PR188 callback binds exclusively to its branch and exact SHA", () => {
  const b = "fix/peos-vercel-docs-exact-sha-ready-20261125";
  const h = "iam-control-center-new-pr188-ci.vercel.app";
  assert.equal(approvedCallback(b), h);
  const e = { ...env, PR_HEAD_BRANCH: b, E2E_CALLBACK_HOST: h };
  const d = { ...domain, name: h, gitBranch: b };
  const a = { ...alias, alias: h };
  const dep = { ...deployment, meta: { ...deployment.meta, githubCommitRef: b } };
  assert.deepEqual(verifyPreviewBinding(e, d, a, dep), {
    callbackHost: h, callbackBranch: b, callbackUrl: `https://${h}`,
  });
  assert.throws(() => verifyPreviewBinding(e, { ...d, gitBranch: "other-branch" }, a, dep), /not bound/);
  assert.throws(() => verifyPreviewBinding({ ...e, E2E_CALLBACK_HOST: aliasHost }, d, a, dep), /invalid/);
  assert.throws(() => verifyPreviewBinding(e, d, { ...a, deploymentId: "dpl_stale" }, dep), /not attached/);
  assert.throws(() => verifyPreviewBinding(e, d, a, { ...dep, meta: { ...dep.meta, githubCommitSha: "b".repeat(40) } }), /exact PR SHA/);
});


test("PR191 maintainer observation requires dedicated branch and exact SHA", () => {
  const b = "feat/peos-g2-single-maintainer-attestation-20261125";
  const h = "iam-control-center-new-pr191-ci.vercel.app";
  assert.equal(approvedCallback(b), h);
  const e = { ...env, PR_HEAD_BRANCH: b, E2E_CALLBACK_HOST: h };
  const d = { ...domain, name: h, gitBranch: b };
  const a = { ...alias, alias: h };
  const dep = { ...deployment, meta: { ...deployment.meta, githubCommitRef: b } };
  assert.deepEqual(verifyPreviewBinding(e,d,a,dep), {callbackHost:h,callbackBranch:b,callbackUrl:"https://"+h});
  assert.throws(() => verifyPreviewBinding(e,{...d,gitBranch:"other-branch"},a,dep), /not bound/);
  assert.throws(() => verifyPreviewBinding({...e,E2E_CALLBACK_HOST:aliasHost},d,a,dep), /invalid/);
  assert.throws(() => verifyPreviewBinding(e,d,a,{...dep,meta:{...dep.meta,githubCommitSha:"b".repeat(40)}}), /exact PR SHA/);
});


test("PR192 rollback witness Preview is bound to its branch and exact SHA", () => {
  const b = "feat/peos-g2-rollback-witness-20261125";
  const h = "iam-control-center-new-pr192-ci.vercel.app";
  assert.equal(approvedCallback(b), h);
  const e = {...env, PR_HEAD_BRANCH:b, E2E_CALLBACK_HOST:h};
  const d = {...domain, name:h, gitBranch:b};
  const a = {...alias, alias:h};
  const dep = {...deployment, meta:{...deployment.meta,githubCommitRef:b}};
  assert.deepEqual(verifyPreviewBinding(e,d,a,dep), {callbackHost:h,callbackBranch:b,callbackUrl:"https://"+h});
  assert.throws(() => verifyPreviewBinding(e,{...d,gitBranch:"other-branch"},a,dep), /not bound/);
  assert.throws(() => verifyPreviewBinding({...e,E2E_CALLBACK_HOST:aliasHost},d,a,dep), /invalid/);
  assert.throws(() => verifyPreviewBinding(e,d,a,{...dep,meta:{...dep.meta,githubCommitSha:"b".repeat(40)}}), /exact PR SHA/);
});


test("retired Preview branches fail closed before shared or historical binding", () => {
  const retired = [
    ["security/g1-b2-aead-restore-offline-contract-20261121", "iam-control-center-new-pr153-ci.vercel.app"],
    ["fix/g1-restore-synthetic-marker-isolation-20261122", "iam-control-center-new-pr155-ci.vercel.app"],
    ["fix/g1-main-checks-paginated-gate-20261122", "iam-control-center-new-pr156-ci.vercel.app"],
    ["fix/g1-pg18-failed-phase-diagnostics-20261122", "iam-control-center-new-pr157-ci.vercel.app"],
    ["fix/g1-artifact-same-run-gh-cli-20261122", "iam-control-center-new-pr159-ci.vercel.app"],
    ["fix/g1-pg18-restore-apply-redacted-classifier-20261122", "iam-control-center-new-pr160-ci.vercel.app"],
    ["fix/g1-restore-custody-id-readonly-attestation-20261122", "iam-control-center-new-pr161-ci.vercel.app"],
  ];
  for (const [prBranch, historicalHost] of retired) {
    assert.throws(() => approvedCallback(prBranch), /RETIRED_PREVIEW_BRANCH/);
    for (const callback of [historicalHost, aliasHost]) {
      const e = { ...env, PR_HEAD_BRANCH: prBranch, E2E_CALLBACK_HOST: callback };
      const d = { ...domain, name: callback, gitBranch: prBranch };
      const a = { ...alias, alias: callback };
      const dep = { ...deployment, meta: { ...deployment.meta, githubCommitRef: prBranch } };
      assert.throws(() => verifyPreviewBinding(e, d, a, dep), /RETIRED_PREVIEW_BRANCH/);
    }
  }
  assert.equal(approvedCallback("unknown-branch"), aliasHost);
});
