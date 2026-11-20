import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertRbacFixtureLease } from "./neon-rbac-fixture-lease.mjs";

const suite = readFileSync(new URL("../.github/e2e/auth0-rbac-pr128.spec.cjs", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/quality.yml", import.meta.url), "utf8");
const playwrightConfig = readFileSync(new URL("../.github/e2e/playwright.config.cjs", import.meta.url), "utf8");

const lease = {
  project: "tiny-rice-70320263",
  parent: "br-muddy-bar-b63ksdy7",
  branch: "br-super-sound-b63gtz88",
  expiresAt: "2026-11-21T22:00:00Z",
};

test("PR128 Neon fixture identity and TTL are exact, fail closed on expiry", () => {
  assert.match(suite, /project: "tiny-rice-70320263", branch: "br-super-sound-b63gtz88"/);
  assert.match(suite, /parent: "br-muddy-bar-b63ksdy7", name: "validation\/pr-128-rbac-http-isolated-20261120"/);
  assert.match(suite, /host: "ep-red-sunset-b6ozp5b2\.c-2\.sa-east-1\.aws\.neon\.tech"/);
  assert.match(suite, /expiresAt: "2026-11-21T22:00:00Z"/);
  assert.equal(assertRbacFixtureLease(lease, Date.parse("2026-11-20T20:00:00Z")),
    "PASS_RBAC_FIXTURE_LEASE_TIME_WINDOW_OFFLINE");
  assert.throws(() => assertRbacFixtureLease(lease, Date.parse("2026-11-21T21:45:01Z")),
    /BLOCKED_RBAC_FIXTURE_LEASE_EXPIRED_OR_EXPIRING/);
  assert.doesNotMatch(suite, /br-crimson-mouse-b6ltdbyx|br-quiet-night-b6cfeq4j/);
});

test("PR128 requires exact GitHub branch, PR, SHA, callback and protected credential", () => {
  for (const claim of [
    'GITHUB_HEAD_REF === "integration/peos-single-maintainer-bun-20261117"',
    'GITHUB_REF === "refs/pull/128/merge"',
    'E2E_PR_NUMBER === "128"',
    "E2E_PR_HEAD_SHA === process.env.IAM_RBAC_PR128_APPROVED_SHA",
    "E2E_RBAC_PR128_BRANCH_ID === ID.branch",
    'E2E_CALLBACK_HOST === "iam-control-center-new-pr128-ci.vercel.app"',
    "NEON_RBAC_PR128_TEST_OWNER_DATABASE_URL",
    'uri.searchParams.get("sslmode") === "verify-full"',
    'uri.searchParams.get("sslrootcert") === "system"',
  ]) {
    assert.ok(suite.includes(claim), "Missing strict PR128 scope claim: " + claim);
  }
  const leaseAt = suite.indexOf("assertRbacFixtureLease(ID)");
  const credentialAt = suite.indexOf("const connection = process.env.NEON_RBAC_PR128_TEST_OWNER_DATABASE_URL");
  const connectAt = suite.indexOf("const sql = neon(connection)");
  assert.ok(leaseAt >= 0 && leaseAt < credentialAt && credentialAt < connectAt);
  assert.doesNotMatch(suite, /process\.env\.NEON_RBAC_TEST_OWNER_DATABASE_URL\b|process\.env\.NEON_RBAC_PR132_TEST_OWNER_DATABASE_URL\b/);
});

test("PR128 SQL writes only through safe owner role and checks exact key ID", () => {
  assert.match(suite, /SET LOCAL ROLE iam_owner/);
  assert.match(suite, /NOT rolbypassrls AND NOT rolsuper AND NOT rolcanlogin/);
  assert.match(suite, /NOT rolbypassrls AND NOT rolsuper FROM pg_roles WHERE rolname='iam_app_runtime_login'/);
  assert.match(suite, /activeKey\[0\]\.key_id === "synthetic-release-validation"/);
  assert.match(suite, /rows\[0\]\.branch === ID\.branch/);
  assert.match(suite, /rows\[0\]\.principal === "neondb_owner"/);
  assert.match(suite, /base\.active_keys === 1 && base\.ledger_rows === 0/);
});

test("PR128 proves authorization 200 then negative cases, revoke 403 and zero cleanup", () => {
  for (const check of ["cross-tenant-B", "cross-identity", "ungranted-permission",
    'const yes=await checkHttp(page)', "await revoke(sql)", 'const no=await checkHttp(page)',
    "if(fixtureStarted)", "await cleanup(sql)", "FAIL cleanup: fixture residue"]) {
    assert.ok(suite.includes(check), "Missing RBAC control: " + check);
  }
  assert.ok(suite.indexOf('const yes=await checkHttp(page)') <
    suite.indexOf("await revoke(sql)"));
  assert.ok(suite.indexOf("await revoke(sql)") <
    suite.indexOf('const no=await checkHttp(page)'));
  assert.match(suite, /status:200,body:\{allowed:true\},cache:"no-store"/);
  assert.match(suite, /status:403,body:\{allowed:false\},cache:"no-store"/);
});

test("staged source is NOT deployed or granted owner secrets by the current CI", () => {
  // A separate verified Environment and exact-SHA operational approval must
  // exist BEFORE any later integration into the Playwright configuration.
  assert.doesNotMatch(playwrightConfig, /auth0-rbac-pr128\.spec\.cjs/);
  assert.doesNotMatch(workflow, /NEON_RBAC_PR128_TEST_OWNER_DATABASE_URL/);
  assert.doesNotMatch(workflow, /E2E_RBAC_PR128_BRANCH_ID/);
  assert.doesNotMatch(workflow, /IAM_RBAC_PR128_APPROVED_SHA/);
  assert.doesNotMatch(suite, /process\.env\.NEON_API_KEY|process\.env\.DATABASE_URL/);
});
