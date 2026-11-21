import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
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
    "deployment-config", '.files | length) == 13', 'status == "added"',
    'status == "modified"', "PASS_POSTMERGE_MAIN_SHA_PR128_APP_PARITY_AND_CHECKS",
  ]) assert.ok(preflight.includes(s), s);
  assert.ok(!preflight.includes("GH_TOKEN="));
  assert.ok(!preflight.includes("OWNER_DATABASE_URL"));
  assert.ok(preflight.includes('commits/$BASE_MAIN_MERGE/check-runs?per_page=100'));
  assert.ok(preflight.includes('for check in quality pg18-security-contracts; do'));
  assert.ok(!preflight.includes('for check in quality pg18-security-contracts deployment-config; do'));

  for (const s of ["pulls/150", "pulls/151", "control_merge", "control_tree", "main_tree", "Main advanced beyond the reviewed PR151"]) assert.ok(preflight.includes(s), s);
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

// Postmerge G3 safety contract for the reviewed PR150/PR151 exact-main lineage.

test("PR150 review is pinned to exact SHA and no later app/SQL changes", () => {
  for (const s of [
    'REVIEWED_APP_HEAD="3e053b6c774ee77075dbd038b9a295cc07eefda4"',
    'REVIEWED_APP_MERGE="633ed462566c63cb0307b7266ec147a25e3f84ee"',
    'reviewed_main_tree', 'reviewed_head_tree',
    '(.files | length) == 13', '(.files | length) == 2',
    'reviewed_scope', 'reviewed_checks',
    'Post-PR150 main changes exceed the reviewed G3 control-only scope.',
    'Reviewed PR128-to-PR150 source/SQL/G3 scope differs',
    'The main Git tree differs from reviewed PR151 head source.',
    'Main advanced beyond the reviewed PR151',
  ]) assert.ok(preflight.includes(s), s);
  for (const s of [
    'security-gate', 'auth0-e2e', 'pg18-security-contracts',
    'preview-deployment', 'sync-auth0-preview', 'Vercel Preview Comments',
    'NEON_RBAC_PR128_TEST_OWNER_DATABASE_URL',
  ]) assert.ok((preflight + workflow).includes(s), s);
});

test("postmerge preflight remains syntactically valid bash", () => {
  if (process.platform === "win32") return;
  const result = spawnSync("bash", ["-n", ".github/trusted/iam-main-postmerge-preflight.sh"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
