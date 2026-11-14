import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(".github/workflows/quality.yml", "utf8");
const e2e = readFileSync(".github/e2e/auth0.spec.cjs", "utf8");
const repository = "alexoaraujo/iam-control-center-new";
const currentAlias = "iam-control-center-new-ci-preview.vercel.app";
test("Auth0 Preview callback is resolved from live Vercel binding for every PR", () => {
  assert.ok(workflow.includes("iam-control-center-new-ci-preview.vercel.app"));
  assert.ok(workflow.includes("VERCEL_API_TOKEN"));
  assert.ok(workflow.includes("node scripts/bind-e2e-preview.mjs"));
  assert.ok(workflow.includes("PR_HEAD_SHA: ${{ github.event.pull_request.head.sha }}"));
  assert.ok(!workflow.includes("ci/optimize-pr-checks-20261110"));
});


test("E2E enforces exact browser origin and restricts trusted OIDC header to Preview", () => {
  assert.ok(e2e.includes("previewHost !== callbackHost"));
  assert.ok(e2e.includes("trustedHosts.has(requestUrl.hostname)"));
  assert.ok(e2e.includes('requestUrl.hostname === "iam-control-center.us.auth0.com"'));
  assert.ok(workflow.includes("callbackHost !== deploymentOrigin.hostname"));
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

test("uses live Vercel domain and branch-scoped variables before credentialed Auth0 E2E", () => {
 assert.ok(workflow.includes("sync-auth0-preview:"));
 assert.ok(workflow.includes("node scripts/sync-auth0-e2e-preview.mjs"));
 assert.ok(workflow.includes("needs.sync-auth0-preview.outputs.auth0_ready == 'true'"));
 assert.ok(workflow.includes("needs.sync-auth0-preview.outputs.callback_host"));
 assert.ok(workflow.includes("needs.sync-auth0-preview.outputs.app_base_url"));
 assert.ok(workflow.includes("needs.sync-auth0-preview.outputs.auth0_domain"));
 assert.ok(workflow.includes("PR_BASE_SHA: ${{ github.event.pull_request.base.sha }}"));
 assert.ok(workflow.includes("PR_HEAD_REPOSITORY: ${{ github.event.pull_request.head.repo.full_name }}"));
});

test("never syncs protected Vercel variables from a forked pull request", () => {
 assert.ok(workflow.includes("github.event.pull_request.head.repo.full_name == github.repository"));
 assert.ok(workflow.includes("scope: ${{ steps.sync.outputs.scope }}"));
});
