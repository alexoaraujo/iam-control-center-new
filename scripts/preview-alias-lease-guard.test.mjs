import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyLeaseSnapshot } from "./preview-alias-lease-guard.mjs";

const project = "prj_OnuwD1iarOsXh6FFGkSpK4A5mj80";
const repo = "alexoaraujo/iam-control-center-new";
const callback = "iam-control-center-new-ci-preview.vercel.app";
const source = {
  branch: "feat/iam-api-rbac-lineage-20261110",
  sha: "0a681b73f40cd1b28db54e57f3813eefcdf0e64c",
  deploymentId: "dpl_28LtLPW4oRs1vjgbA5uHUunnZQsU",
  previewHost: "iam-control-center-1gasw2ybf-aoa4.vercel.app", repo,
};
const target = {
  branch: "fix/security-next-16-4-5",
  sha: "fb14b5b76c6bb52446b126b8c3fddfe77d8a3ea8",
  deploymentId: "dpl_38TsYyHC1C5GYbvdLNw8uBVVVjiy",
  previewHost: "iam-control-center-4jw9ytx99-aoa4.vercel.app", repo,
};
const deployment = ref => ({
  id: ref.deploymentId,
  readyState: "READY",
  project: { id: project },
  url: ref.previewHost,
  meta: {
    githubCommitRef: ref.branch, githubCommitSha: ref.sha,
    githubOrg: "alexoaraujo", githubRepo: "iam-control-center-new",
  },
});
function fixture(phase = "before") {
  return {
    phase, source: { ...source }, target: { ...target },
    sourceDeployment: deployment(source), targetDeployment: deployment(target),
    domain: { name: callback, projectId: project, verified: true,
      gitBranch: phase === "leased" ? target.branch : source.branch },
    alias: { alias: callback, projectId: project,
      deploymentId: phase === "leased" ? target.deploymentId : source.deploymentId },
    targetPreviewVariables: [
      { key: "APP_BASE_URL", gitBranch: target.branch, target: ["preview"] },
      { key: "DATABASE_URL", gitBranch: target.branch, target: ["preview"] },
      { key: "AUTHZ_CONTEXT_SIGNING_KEY_HEX", gitBranch: target.branch, target: ["preview"] },
    ],
  };
}
test("read-only preflight matches source exact SHA and ready target", () => {
  const state = verifyLeaseSnapshot(fixture());
  assert.equal(state.state, "PASS_PREVIEW_LEASE_PRECONDITIONS_READ_ONLY");
  assert.equal(state.operationalApproval, "NOT_ATTESTED");
  assert.equal(state.dataSourceAndRls, "NOT_ATTESTED");
});
test("leased state requires exact new domain and alias binding", () => {
  const state = verifyLeaseSnapshot(fixture("leased"));
  assert.equal(state.state, "PASS_PREVIEW_LEASE_TARGET_BINDING_READ_ONLY");
  assert.equal(state.auth0LoginAndGrantRevoke, "NOT_TESTED");
});
test("rollback checks original branch and original deployment", () => {
  assert.equal(verifyLeaseSnapshot(fixture("rollback")).state,
    "PASS_PREVIEW_LEASE_ROLLBACK_BINDING_READ_ONLY");
  const bad = fixture("rollback");
  bad.alias.deploymentId = target.deploymentId;
  assert.throws(() => verifyLeaseSnapshot(bad), /SOURCE_BINDING/);
});
test("rollback attestations do not depend on previously removed target variables", () => {
  const ready = fixture("rollback");
  ready.targetPreviewVariables = [];
  assert.equal(verifyLeaseSnapshot(ready).state,
    "PASS_PREVIEW_LEASE_ROLLBACK_BINDING_READ_ONLY");
});
test("rejects mismatched Preview hostname despite correct SHA", () => {
  const bad = fixture();
  bad.target.previewHost = "untrusted-preview.vercel.app";
  assert.throws(() => verifyLeaseSnapshot(bad), /EXACT_DEPLOYMENT/);
});
test("rejects split domain/alias binding", () => {
  const bad = fixture("leased");
  bad.alias.deploymentId = source.deploymentId;
  assert.throws(() => verifyLeaseSnapshot(bad), /TARGET_BINDING/);
});
test("rejects missing branch-scoped Preview variables", () => {
  const bad = fixture();
  bad.targetPreviewVariables = [];
  assert.throws(() => verifyLeaseSnapshot(bad), /SCOPED_VARIABLES/);
});
test("rejects Preview variables scoped to another branch", () => {
  const bad = fixture();
  bad.targetPreviewVariables[1].gitBranch = source.branch;
  assert.throws(() => verifyLeaseSnapshot(bad), /SCOPED_VARIABLES/);
});
test("rejects exact-SHA drift even if deployment is READY", () => {
  const bad = fixture();
  bad.target.sha = "a".repeat(40);
  assert.throws(() => verifyLeaseSnapshot(bad), /EXACT_DEPLOYMENT/);
});
test("rejects any mismatched project", () => {
  const bad = fixture();
  bad.domain.projectId = "prj_untrusted";
  assert.throws(() => verifyLeaseSnapshot(bad), /PROJECT_DOMAIN/);
});
test("rejects deployment misbound to different branch or repository", () => {
  const bad = fixture();
  bad.sourceDeployment.meta.githubCommitRef = target.branch;
  assert.throws(() => verifyLeaseSnapshot(bad), /EXACT_DEPLOYMENT/);
  const fork = fixture();
  fork.target.repo = "someone/fork";
  assert.throws(() => verifyLeaseSnapshot(fork), /REFERENCES/);
});
test("rejects malformed phase and unknown hostname", () => {
  const bad = fixture("unexpected");
  assert.throws(() => verifyLeaseSnapshot(bad), /PHASE/);
  const host = fixture();
  host.alias.alias = "untrusted.example";
  assert.throws(() => verifyLeaseSnapshot(host), /PROJECT_DOMAIN/);
});
