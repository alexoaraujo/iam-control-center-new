import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(".github/workflows/quality.yml", "utf8");
const e2e = readFileSync(".github/e2e/auth0.spec.cjs", "utf8");
const repository = "alexoaraujo/iam-control-center-new";
const currentAlias = "iam-control-center-new-ci-preview.vercel.app";
const currentBranch = "feat/iam-api-rbac-lineage-20261110";

test("Auth0 E2E is pinned to the reviewed PR #41 branch and matching Preview alias", () => {
  assert.ok(workflow.includes("E2E_CALLBACK_HOST: " + currentAlias), "E2E host must be the reviewed Preview alias");
  assert.ok(workflow.includes("E2E_CALLBACK_BRANCH: " + currentBranch), "E2E branch must be the current PR branch");
  assert.ok(!workflow.includes("vars.AUTH0_E2E_CALLBACK_BRANCH"), "Stale protected-environment branch variable must not override the reviewed binding");
  assert.ok(!workflow.includes("vars.AUTH0_E2E_CALLBACK_HOST"), "Callback host must not drift from reviewed PR alias");
  assert.ok(workflow.includes('PR_HEAD_BRANCH}" != "${E2E_CALLBACK_BRANCH}'));
  assert.ok(workflow.includes('PR_HEAD_REPOSITORY}" != "' + repository));
});

test("E2E enforces exact browser origin and restricts trusted OIDC header to Preview", () => {
  assert.ok(e2e.includes("previewHost !== callbackHost"));
  assert.ok(e2e.includes("trustedHosts.has(requestUrl.hostname)"));
  assert.ok(e2e.includes('requestUrl.hostname === "iam-control-center.us.auth0.com"'));
  assert.ok(workflow.includes("node scripts/verify-preview-alias.mjs"), "Both aliases must prove the same Vercel deployment identity before E2E");
  assert.ok(workflow.includes("PR_HEAD_SHA: ${{ github.event.pull_request.head.sha }}"), "Deployment identity must be tied to exact GitHub PR SHA");
  assert.ok(!workflow.includes("callbackHost !== deploymentOrigin.hostname"), "Do not confuse alias equality with deployment identity");
  assert.ok(workflow.includes("Callback must be the reviewed IAM Preview alias"));
  assert.ok(workflow.includes("E2E_DEPLOYMENT_HOST"));
});

test("E2E stays opt-in, fails closed for forks and missing credentials", () => {
  assert.ok(workflow.includes("vars.AUTH0_E2E_ENABLED == 'true'"));
  assert.ok(workflow.includes("id-token: write"));
  assert.ok(workflow.includes("environment:Preview"));
  assert.ok(workflow.includes("github.event.pull_request.head.sha"));
  assert.ok(workflow.includes("AUTH0_E2E_PASSWORD must be set in the protected Preview environment"));
});

test("Obsolete repository and callback host cannot return unnoticed", () => {
  for (const source of [workflow, e2e]) {
    assert.ok(!source.includes("alexoaraujo83/iam-control-center"));
    assert.ok(!source.includes("iam-control-center-preview.vercel.app"));
    assert.ok(!source.includes("fix/bind-preview-e2e-deployment"));
  }
});
