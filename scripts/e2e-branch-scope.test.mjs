import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import assert from "node:assert/strict";
import test from "node:test";

const source = readFileSync(".github/e2e/playwright.config.cjs", "utf8");
const workflow = readFileSync(".github/workflows/quality.yml", "utf8");
const PR41 = "feat/iam-api-rbac-lineage-20261110";
const PR132 = "integration/peos-g1-g2-canonical-bun-20261118";
const PR42 = "feat/auth0-neon-identity-sync-20261111";

function select(env) {
  const module = { exports: {} };
  const context = {
    module,
    __dirname: "/reviewed-e2e",
    process: { env },
    require(name) {
      if (name !== "@playwright/test") throw Error("Untrusted Playwright module: " + name);
      return { defineConfig: (x) => x };
    },
  };
  runInNewContext(source, context, { timeout: 1000 });
  return Array.from(module.exports.testMatch);
}

test("PR41 always runs real login, 45s expiry, and RBAC grant/revoke", () => {
  assert.deepEqual(select({ E2E_CALLBACK_BRANCH: PR41, E2E_RBAC_HTTP_ENABLED: "true",
    E2E_IDENTITY_SYNC: "false" }),
  ["auth0.spec.cjs", "auth0-expiry.spec.cjs", "auth0-rbac.spec.cjs"]);
});

test("PR42 runs only its authorized login/identity-sync flow without PR41 Neon RBAC fixtures", () => {
  assert.deepEqual(select({ E2E_CALLBACK_BRANCH: PR42, E2E_RBAC_HTTP_ENABLED: "false",
    E2E_IDENTITY_SYNC: "true" }), ["auth0.spec.cjs"]);
});

test("PR132 requires separate real RBAC HTTP but never the PR41 expiry or PR41 fixture", () => {
  assert.deepEqual(select({ E2E_CALLBACK_BRANCH: PR132, E2E_RBAC_HTTP_ENABLED: "true",
    E2E_IDENTITY_SYNC: "false" }), ["auth0.spec.cjs", "auth0-rbac-pr132.spec.cjs"]);
});

test("other authorized callback branches keep shared authentication test but no PR41 fixture", () => {
  assert.deepEqual(select({ E2E_CALLBACK_BRANCH: "docs/preview-authorized",
    E2E_RBAC_HTTP_ENABLED: "false", E2E_IDENTITY_SYNC: "false" }), ["auth0.spec.cjs"]);
});

test("denies missing or forged branch-specific controls instead of silently skipping mandatory tests", () => {
  for (const env of [
    { E2E_CALLBACK_BRANCH: PR41, E2E_RBAC_HTTP_ENABLED: "false" },
    { E2E_CALLBACK_BRANCH: PR132, E2E_RBAC_HTTP_ENABLED: "false" },
    { E2E_CALLBACK_BRANCH: PR132, E2E_RBAC_HTTP_ENABLED: "true", E2E_IDENTITY_SYNC: "true" },
    { E2E_CALLBACK_BRANCH: PR41, E2E_IDENTITY_SYNC: "true", E2E_RBAC_HTTP_ENABLED: "true" },
    { E2E_CALLBACK_BRANCH: PR42, E2E_RBAC_HTTP_ENABLED: "false", E2E_IDENTITY_SYNC: "false" },
    { E2E_CALLBACK_BRANCH: PR42, E2E_RBAC_HTTP_ENABLED: "true", E2E_IDENTITY_SYNC: "true" },
    { E2E_CALLBACK_BRANCH: "untrusted/branch", E2E_RBAC_HTTP_ENABLED: "true" },
    { E2E_CALLBACK_BRANCH: "untrusted/branch", E2E_IDENTITY_SYNC: "true" },
  ]) {
    assert.throws(() => select(env), /does not match verified callback branch/);
  }
});

test("GitHub Preview E2E retains exact-SHA callback preflight and branch-scoped Neon credentials", () => {
  assert.ok(workflow.includes("needs.sync-auth0-preview.outputs.auth0_ready == 'true'"));
  assert.ok(workflow.includes("E2E_CALLBACK_BRANCH: ${{ needs.sync-auth0-preview.outputs.callback_branch }}"));
  assert.ok(workflow.includes("github.event.pull_request.head.ref == 'feat/iam-api-rbac-lineage-20261110'"));
  assert.ok(workflow.includes("github.event.pull_request.number == 132"));
  assert.ok(workflow.includes("vars.IAM_PR132_RBAC_APPROVED_SHA == github.event.pull_request.head.sha"));
  assert.ok(workflow.includes("E2E_IDENTITY_SYNC: ${{ github.event.pull_request.head.ref == 'feat/auth0-neon-identity-sync-20261111'"));
  assert.ok(workflow.includes("github.event.pull_request.head.ref == 'feat/iam-api-rbac-lineage-20261110' && secrets.NEON_RBAC_TEST_OWNER_DATABASE_URL"));
  assert.ok(workflow.includes("node scripts/bind-e2e-preview.mjs"));
});
