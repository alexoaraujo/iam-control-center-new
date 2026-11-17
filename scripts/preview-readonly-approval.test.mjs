import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/quality.yml", import.meta.url),
  "utf8",
);

function job(name, next) {
  const start = workflow.indexOf("\n  " + name + ":\n");
  assert.notEqual(start, -1, "Missing required job " + name);
  const end = workflow.indexOf("\n  " + next + ":\n", start + 1);
  assert.notEqual(end, -1, "Missing subsequent job " + next);
  return workflow.slice(start, end);
}

test("Preview discovery uses no protected Environment, secrets or token-writing permissions", () => {
  const text = job("preview-deployment", "sync-auth0-preview");
  assert.doesNotMatch(text, /\n    environment:/);
  assert.doesNotMatch(text, /secrets\./);
  assert.doesNotMatch(text, /\n      (?:deployments|contents|checks|statuses|id-token): write\b/);
  assert.match(text, /\n      deployments: read\b/);
  assert.match(text, /github\.event\.pull_request\.head\.sha/);
  assert.match(text, /Vercel Preview Comments/);
  assert.match(text, /\.head_sha == \$sha/);
});

test("Auth0 configuration sync retains the protected Preview Environment", () => {
  const text = job("sync-auth0-preview", "auth0-e2e");
  assert.match(text, /\n    environment:\n      name: Preview\b/);
  assert.match(text, /secrets\.VERCEL_API_TOKEN/);
  assert.match(text, /scripts\/sync-auth0-e2e-preview\.mjs/);
});

test("Live Auth0 E2E retains protected credentials and OIDC requirements", () => {
  const text = job("auth0-e2e", "docs-preview-evidence");
  assert.match(text, /\n    environment:\n      name: Preview\b/);
  assert.match(text, /\n      id-token: write\b/);
  assert.match(text, /secrets\.AUTH0_E2E_USERNAME/);
  assert.match(text, /secrets\.AUTH0_E2E_PASSWORD/);
  assert.match(text, /Verify GitHub OIDC claims for Vercel Trusted Sources/);
  assert.match(text, /Run Auth0 end-to-end flow/);
});

test("Integrated security-gate still checks the live E2E result", () => {
  const text = workflow.slice(workflow.indexOf("\n  security-gate:\n"));
  assert.match(text, /\n      - auth0-e2e\b/);
  assert.match(text, /AUTH0_E2E_RESULT: \$\{\{ needs\.auth0-e2e\.result \}\}/);
  assert.match(text, /scripts\/release-security-gate\.mjs/);
});
