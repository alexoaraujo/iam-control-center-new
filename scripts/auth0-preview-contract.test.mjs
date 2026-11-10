import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(".github/workflows/quality.yml", "utf8");
const e2e = readFileSync(".github/e2e/auth0.spec.cjs", "utf8");
const alias = "iam-control-center-new-preview.vercel.app";
const repository = "alexoaraujo/iam-control-center-new";
const branch = "fix/vercel-deployment-readiness";

test("Auth0 E2E and CI use the same verified branch-specific callback alias", () => {
  assert.match(workflow, /E2E_CALLBACK_HOST:\s+iam-control-center-new-preview\.vercel\.app/);
  assert.ok(e2e.includes(`callbackHost !== "${alias}"`));
  assert.ok(workflow.includes(`callbackHost !== "${alias}"`));
  assert.ok(workflow.includes(`"${repository}"`));
  assert.ok(workflow.includes(`"${branch}"`));
});

test("E2E remains opt-in and the Preview OIDC scope is explicit", () => {
  assert.ok(workflow.includes("vars.AUTH0_E2E_ENABLED == 'true'"));
  assert.ok(workflow.includes("id-token: write"));
  assert.ok(workflow.includes("environment:Preview"));
  assert.ok(workflow.includes("github.event.pull_request.head.sha"));
});

test("Old repository and callback host cannot return unnoticed", () => {
  for (const source of [workflow, e2e]) {
    assert.ok(!source.includes("alexoaraujo83/iam-control-center"));
    assert.ok(!source.includes("iam-control-center-preview.vercel.app"));
    assert.ok(!source.includes("fix/bind-preview-e2e-deployment"));
  }
});
