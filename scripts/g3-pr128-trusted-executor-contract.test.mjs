import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/iam-g3-pr128-trusted-executor.yml", import.meta.url),
  "utf8",
);
const suite = readFileSync(
  new URL("../.github/trusted/g3-pr128.spec.cjs", import.meta.url),
  "utf8",
);
const config = readFileSync(
  new URL("../.github/trusted/g3-pr128.playwright.config.cjs", import.meta.url),
  "utf8",
);

test("G3 trusted executor is never triggered by an ordinary pull_request workflow", () => {
  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /issue_comment:/);
  assert.doesNotMatch(workflow, /^\s+pull_request:\s*$/m);
  assert.match(workflow, /github\.event\.pull_request\.number == 128/);
  assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(workflow, /github\.event\.comment\.user\.login == 'alexoaraujo'/);
  assert.match(workflow, /github\.event\.comment\.body == '\/peos-g3-pr128-run'/);
  assert.match(workflow, /if \.draft == null then "true" else \(\.draft \| tostring\) end/);
});

test("G3 job checks out the trusted workflow commit, never the PR head", () => {
  assert.match(workflow, /ref:\s+\$\{\{\s*github\.sha\s*\}\}/);
  assert.doesNotMatch(workflow, /ref:\s+\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/);
  assert.match(workflow, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /npm init -y/);
  assert.match(workflow, /npm install --save-exact/);
  assert.match(workflow, /npm audit --audit-level=high/);
  assert.match(workflow, /G3_APPROVED_SHA/);
  assert.match(workflow, /G3_PR_HEAD_SHA/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /actions\/runs\?head_sha=/);
  assert.match(workflow, /actions\/runs\/\$\{ci_run_id\}\/jobs/);
  assert.match(workflow, /for required in quality security-gate auth0-e2e preview-deployment sync-auth0-preview/);
  assert.match(workflow, /PASS_G3_PR128_HEAD_AND_PREVIEW_REVALIDATED_BEFORE_SECRET_USE/);
  assert.match(workflow, /EXPECTED_SHA.*needs\.preflight\.outputs\.head_sha/);
});

test("only the exact dedicated G3 Environment can release owner credentials, after live deployment identity passes", () => {
  const liveIdentity = workflow.indexOf("Verify live Preview and callback deployment identity against the approved PR128 SHA");
  const credentialPreflight = workflow.indexOf("Verify exact approved SHA and protected credential availability");
  const privilegedSuite = workflow.indexOf("Execute trusted PR128 Auth0/RBAC grant, deny, revoke, cleanup and rollback suite");
  assert.ok(liveIdentity >= 0 && credentialPreflight > liveIdentity && privilegedSuite > credentialPreflight);
  assert.ok(workflow.indexOf("secrets.NEON_RBAC_PR128_TEST_OWNER_DATABASE_URL") > liveIdentity);
  assert.match(workflow, /environment:\s*\n\s+name:\s*IAM-G3-PR128-Disposable-RBAC/);
  assert.match(workflow, /secrets\.NEON_RBAC_PR128_TEST_OWNER_DATABASE_URL/);
  assert.match(workflow, /sslmode.*verify-full/);
  assert.match(workflow, /sslrootcert.*system/);
  assert.match(workflow, /NEON_RBAC_PR128_TEST_OWNER_DATABASE_URL/);
  assert.doesNotMatch(workflow, /NEON_RBAC_PR128_TEST_OWNER_DATABASE_URL:\s*\$\{\{\s*secrets\.[^}]*Preview/);
});

test("OIDC identity is bound to the immutable repository, G3 Environment and main workflow", () => {
  assert.match(workflow, /repo:alexoaraujo@325264809\/iam-control-center-new@1451861889:environment:IAM-G3-PR128-Disposable-RBAC/);
  assert.match(workflow, /claims\.workflow_ref !== expectedWorkflow/);
  assert.match(workflow, /claims\.workflow_sha !== process\.env\.GITHUB_SHA/);
  assert.match(workflow, /iam-control-center-new\/\.github\/workflows\/iam-g3-pr128-trusted-executor\.yml@refs\/heads\/main/);
  assert.match(workflow, /x-vercel-trusted-oidc-idp-token/);
  assert.match(workflow, /PASS_G3_VERCEL_ANONYMOUS_NEGATIVE_CONTROL/);
  assert.match(workflow, /PASS_G3_VERCEL_TRUSTED_SOURCE_POSITIVE_CONTROL/);
  assert.match(workflow, /Verify live Preview and callback deployment identity against the approved PR128 SHA/);
  assert.ok(workflow.includes("node scripts/verify-preview-alias.mjs"));
  assert.ok(workflow.includes("PR_HEAD_SHA: ${{ needs.preflight.outputs.head_sha }}"));
});

test("the trusted suite proves grant, tenant isolation, revoke, rollback and zero residue", () => {
  assert.match(suite, /assertRbacFixtureLease\(ID\)/);
  assert.match(suite, /sslmode.*verify-full/);
  assert.match(suite, /sslrootcert.*system/);
  assert.ok(suite.includes('require("postgres")'));
  assert.ok(suite.includes("postgres(connection"));
  assert.match(suite, /sql\.unsafe/);
  assert.match(suite, /sql\.begin/);
  assert.match(suite, /PASS_G3_CLIENT_TLS_VERIFY_FULL_SYSTEM_CA/);
  assert.ok(!suite.includes("@neondatabase/serverless"));
  assert.ok(!suite.includes("pg_stat_ssl"));
  assert.ok(!suite.includes("tls_enabled"));
  assert.match(workflow, /postgres@4\.1\.1/);
  assert.ok(!workflow.includes("@neondatabase/serverless"));
  assert.ok(workflow.includes("node --check .github/trusted/g3-pr128.spec.cjs"));
  assert.ok(workflow.includes("PASS_G3_DIRECT_TCP_POSTGRES_CLIENT_LOAD"));
  assert.match(suite, /SET LOCAL ROLE iam_owner/);
  assert.match(suite, /PASS_G3_GRANT_HTTP_200/);
  assert.match(suite, /cross-tenant-B/);
  assert.match(suite, /PASS_G3_CROSS_TENANT_CROSS_IDENTITY_AND_UNGRANTED_PERMISSION_HTTP_403/);
  assert.match(suite, /PASS_G3_REVOKE_HTTP_403_SAME_AUTH0_SESSION/);
  assert.match(suite, /PASS_G3_TRANSACTION_ROLLBACK/);
  assert.match(suite, /PASS_G3_ZERO_RESIDUE/);
  assert.match(suite, /finally\s*\{[\s\S]*await cleanup\(sql\)/);
  assert.doesNotMatch(suite, /console\.log\([^)]*(OWNER_DATABASE_URL|NEON_RBAC_PR128_TEST_OWNER_DATABASE_URL|connection)/i);
  assert.match(config, /testMatch:\s*\["g3-pr128\.spec\.cjs"\]/);
});
