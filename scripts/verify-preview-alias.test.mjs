import assert from "node:assert/strict";
import { test } from "node:test";
import { assertPreviewDeploymentPair } from "./verify-preview-alias.mjs";

const expected = {
  commitSha: "d18a1dfc81123b40d78bffab64190c1a19ec6f1e",
  branch: "feat/iam-api-rbac-lineage-20261110",
  repository: "alexoaraujo/iam-control-center-new",
  pullRequestId: "41",
};

const proof = (override = {}) => ({
  ok: true,
  deploymentHost: "iam-control-center-unique-aoa4.vercel.app",
  commitSha: expected.commitSha,
  branch: expected.branch,
  repository: expected.repository,
  environment: "preview",
  pullRequestId: "41",
  ...override,
});

test("distinct reviewed aliases may share the same exact-SHA Vercel deployment", () => {
  assert.equal(assertPreviewDeploymentPair([proof(), proof()], expected), proof().deploymentHost);
});

test("rejects different deployment IDs, even when the SHA and branch match", () => {
  assert.throws(() => assertPreviewDeploymentPair([proof(), proof({ deploymentHost: "another-deployment.vercel.app" })], expected), /different Vercel deployments/);
});

for (const [name, value] of Object.entries({
  commitSha: "f".repeat(40),
  branch: "fix/proxy-mock-unused-request",
  repository: "attacker/iam-control-center-new",
  environment: "production",
  pullRequestId: "39",
  deploymentHost: "outside.example.com",
  ok: false,
})) {
  test(`rejects invalid ${name} from either Preview alias`, () => {
    assert.throws(() => assertPreviewDeploymentPair([proof(), proof({ [name]: value })], expected));
  });
}

test("rejects missing or malformed identity evidence", () => {
  assert.throws(() => assertPreviewDeploymentPair([proof(), proof({ pullRequestId: undefined })], expected), /Missing or wrong PR number/);
  assert.throws(() => assertPreviewDeploymentPair([proof(), proof({ pullRequestId: null })], expected), /Missing or wrong PR number/);
  assert.throws(() => assertPreviewDeploymentPair([proof()], expected), /Exactly two/);
  assert.throws(() => assertPreviewDeploymentPair([proof(), {}], expected));
  assert.throws(() => assertPreviewDeploymentPair([proof(), proof({ pullRequestId: "" })], { ...expected, branch: "unexpected" }));
  assert.throws(() => assertPreviewDeploymentPair([proof(), proof()], { ...expected, commitSha: "bad" }));
});
