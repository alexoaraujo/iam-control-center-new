import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(".github/workflows/iam-main-postmerge-auth0-rbac.yml", "utf8");
const preflight = readFileSync(".github/trusted/iam-main-postmerge-preflight.sh", "utf8");

test("new postmerge executor accepts only owner comment on merged PR128 and main", () => {
  for (const s of [
    "issue_comment:", "github.event.issue.number == 128",
    "github.event.comment.user.login == 'alexoaraujo'",
    "/peos-main-postmerge-g3 ", "ref: ", "persist-credentials: false",
  ]) assert.ok(workflow.includes(s), s);
  assert.ok(!workflow.includes("pull_request_target:"));
  assert.ok(preflight.includes('refs/heads/main'));
  assert.ok(preflight.includes('command_sha'));
  assert.ok(preflight.includes('GITHUB_SHA'));
  assert.ok(preflight.includes('GITHUB_EVENT_PATH'));
});
test("preflight must be unprivileged and secrets are only in protected G3 job", () => {
  const noSecret = workflow.slice(0, workflow.indexOf("\n  execute:"));
  assert.ok(!noSecret.includes("secrets."));
  assert.ok(!noSecret.includes("id-token: write"));
  assert.ok(workflow.includes("name: IAM-G3-PR128-Disposable-RBAC"));
  assert.ok(workflow.includes("G3_APPROVED_SHA:"));
  assert.ok(workflow.includes("G3_POSTMERGE_MAIN_SHA:"));
  assert.equal(workflow.split("iam-main-postmerge-preflight.sh").length, 3);
});
test("exact main source and baseline app parity fail closed before privileged Auth0", () => {
  for (const s of [
    'BASE_PR_HEAD="1f6073c990cca160e0c37604bd55181bc808806a"',
    'BASE_MAIN_MERGE="2270fac70bb588cea2ebc2e12cad5b7da96e2a38"',
    "compare/", "main_sha", "gh api", "security-gate", "auth0-e2e",
    "Execute trusted G3 Auth0/RBAC proof", "pg18-security-contracts",
    "deployment-config", '.files | length) == 6', 'status == "added"',
    'status == "modified"', "PASS_POSTMERGE_MAIN_SHA_PR128_APP_PARITY_AND_CHECKS",
  ]) assert.ok(preflight.includes(s), s);
  assert.ok(!preflight.includes("GH_TOKEN="));
  assert.ok(!preflight.includes("OWNER_DATABASE_URL"));
  assert.ok(preflight.includes('commits/$BASE_MAIN_MERGE/check-runs?per_page=100'));
  assert.ok(preflight.includes('for check in quality pg18-security-contracts; do'));
  assert.ok(!preflight.includes('for check in quality pg18-security-contracts deployment-config; do'));

  for (const s of ["pulls/147", "control_merge", "control_tree", "main_tree", "Main advanced beyond the reviewed PR147"]) assert.ok(preflight.includes(s), s);
});
test("only protected main job can run trusted live Auth0 grant revoke rollback suite", () => {
  for (const s of [
    "g3-pr128.playwright.config.cjs",
    "NEON_RBAC_PR128_TEST_OWNER_DATABASE_URL",
    "AUTH0_E2E_USERNAME",
    "AUTH0_E2E_PASSWORD",
    "claims.event_name !== \"issue_comment\"",
    "iam-main-postmerge-auth0-rbac.yml@refs/heads/main",
    "PASS_G3_VERCEL_TRUSTED_SOURCE_POSITIVE_CONTROL",
    "PASS_G3_OWNER_SECRET_PRESENT_AND_DIRECT_TLS_POLICY_MATCHES",
    "br-super-sound-b63gtz88",
  ]) assert.ok(workflow.includes(s), s);
  assert.ok(!workflow.includes("environment:\n      name: Production"));
});

// Follow-on postmerge G3 attestation revision: keep existing guards enforced until reviewed exact-main baseline update.
