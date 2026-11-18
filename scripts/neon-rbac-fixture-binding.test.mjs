import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const e2e = readFileSync(new URL("../.github/e2e/auth0-rbac.spec.cjs", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/quality.yml", import.meta.url), "utf8");

test("RBAC E2E is pinned to the approved active Neon child, never the expired fixture", () => {
  assert.match(e2e, /project: "tiny-rice-70320263", branch: "br-quiet-night-b6cfeq4j"/);
  assert.match(e2e, /parent: "br-muddy-bar-b63ksdy7", name: "validation\/pr-41-rbac-e2e-20261117"/);
  assert.match(e2e, /host: "ep-broad-bonus-b6c5jc2y\.c-2\.sa-east-1\.aws\.neon\.tech"/);
  assert.match(workflow, /^\s+E2E_RBAC_PROJECT_ID: tiny-rice-70320263$/m);
  assert.match(workflow, /^\s+E2E_RBAC_BRANCH_ID: br-quiet-night-b6cfeq4j$/m);
  assert.doesNotMatch(e2e + workflow, /br-shy-scene-b67zm2v7/);
  assert.doesNotMatch(e2e + workflow, /br-royal-dream-b6di0p2w|ep-shiny-pond-b6zifpoo/);
});

test("RBAC E2E validates approved lease before reading a secret", () => {
  assert.match(e2e, /expiresAt: "2026-11-20T01:30:00Z"/);
  assert.match(e2e, /assertRbacFixtureLease\(ID\)/);
  const leaseCheck = e2e.indexOf("assertRbacFixtureLease(ID)");
  const secretRead = e2e.indexOf("const connection = process.env.NEON_RBAC_TEST_OWNER_DATABASE_URL");
  const sqlSession = e2e.indexOf("const sql = neon(connection)");
  assert.ok(leaseCheck !== -1 && leaseCheck < secretRead && secretRead < sqlSession);
});

test("RBAC E2E denies cross-branch credentials before fixture writes", () => {
  assert.match(e2e, /uri\.hostname === ID\.host/);
  assert.match(e2e, /rows\[0\]\.branch === ID\.branch/);
  assert.match(e2e, /rows\[0\]\.principal === "neondb_owner"/);
  const authenticatedIndex = e2e.indexOf("const sql = neon(connection)");
  const fixtureIndex = e2e.indexOf("async function create(sql, subject)");
  assert.ok(authenticatedIndex > -1 && fixtureIndex > authenticatedIndex);
  assert.match(e2e, /if\(fixtureStarted\)/);
  assert.match(e2e, /FAIL cleanup: fixture residue/);
});

test("RBAC synthetic writes preflight both effective owner role and runtime NOBYPASSRLS", () => {
  assert.match(e2e, /BLOCKED_RBAC_FIXTURE_UNSAFE_ROLE_TOPOLOGY/);
  assert.match(e2e, /pg_has_role\(current_user,'iam_owner','SET'\)/);
  assert.match(e2e, /NOT rolbypassrls AND NOT rolsuper AND NOT rolcanlogin/);
  assert.match(e2e, /NOT rolbypassrls AND NOT rolsuper FROM pg_roles WHERE rolname='iam_app_runtime_login'/);
  const rolePreflight = e2e.indexOf("const roleTopology = await sql.query(");
  const createFixture = e2e.indexOf("async function create(sql, subject)");
  assert.ok(rolePreflight > 0 && createFixture > rolePreflight);
  assert.match(e2e, /SET LOCAL ROLE iam_owner/);
});

test("RBAC credentials remain scoped to one protected Preview E2E step", () => {
  assert.match(workflow, /^\s+environment:\n\s+name: Preview$/m);
  assert.ok(workflow.includes("NEON_RBAC_TEST_OWNER_DATABASE_URL: ${{ github.event.pull_request.head.ref == 'feat/iam-api-rbac-lineage-20261110' && secrets.NEON_RBAC_TEST_OWNER_DATABASE_URL || '' }}"));
  assert.doesNotMatch(workflow, /^\\s+NEON_RBAC_TEST_OWNER_DATABASE_URL: \\$\\{\\{ secrets\\.NEON_RBAC_TEST_OWNER_DATABASE_URL \\}\\}$/m);
  assert.doesNotMatch(workflow, /NEON_API_KEY: \$\{\{ secrets\./);
});

test("RBAC with an active tenant A grant still denies tenant B, identity spoofing, and ungranted permission", () => {
  assert.match(e2e, /tenantB: "22222222-2222-4222-8222-222222222222"/);
  assert.match(e2e, /"tenants_b"/);
  assert.match(e2e, /INSERT INTO iam\.tenants\(id,slug,display_name\).*peos-auth0-http-41-b/);
  assert.match(e2e, /DELETE FROM iam\.tenants WHERE id=\$1::uuid",\[ID\.tenantB\]/);
  for (const variant of ["cross-tenant-B", "cross-identity", "ungranted-permission"]) {
    assert.ok(e2e.includes('["'+variant+'",'), "Missing denied selector "+variant);
  }
  const grant=e2e.indexOf('const yes=await checkHttp(page)');
  const negative=e2e.indexOf('console.log("PASS: tenant B, cross-identity');
  const revoke=e2e.indexOf('await revoke(sql)');
  const cleanup=e2e.indexOf('await cleanup(sql)');
  assert.ok(grant>0 && grant<negative && negative<revoke && revoke<cleanup);
  assert.match(e2e, /status:403,body:\{allowed:false\},cache:"no-store"/);
  assert.match(e2e, /check\(zero\(result\) && result\.active_keys===1 && result\.ledger_rows===0/);
});

const pr132E2E = readFileSync(new URL("../.github/e2e/auth0-rbac-pr132.spec.cjs", import.meta.url), "utf8");

test("PR132 RBAC is exclusively bound to expiring br-crimson-mouse and an SHA-approved GitHub PR", () => {
  assert.match(pr132E2E, /branch: "br-crimson-mouse-b6ltdbyx"/);
  assert.match(pr132E2E, /host: "ep-nameless-breeze-b6mdjzqe\.c-2\.sa-east-1\.aws\.neon\.tech"/);
  assert.match(pr132E2E, /name: "validation\/pr-132-rbac-http-isolated-20261118"/);
  assert.match(pr132E2E, /expiresAt: "2026-11-20T17:03:52Z"/);
  assert.match(pr132E2E, /GITHUB_REF === "refs\/pull\/132\/merge"/);
  assert.match(pr132E2E, /E2E_PR_HEAD_SHA === process\.env\.IAM_PR132_RBAC_APPROVED_SHA/);
  assert.match(pr132E2E, /E2E_RBAC_PR132_BRANCH_ID === ID\.branch/);
  assert.match(pr132E2E, /BLOCKED_PR132_ACTIVE_HMAC_KEY_NOT_BOUND_TO_CLONE/);
  assert.doesNotMatch(pr132E2E, /br-quiet-night-b6cfeq4j|ep-broad-bonus-b6c5jc2y/);
});

test("PR132 privileged lease is never sourced from the PR41 secret or Preview app runtime", () => {
  assert.match(pr132E2E, /NEON_RBAC_PR132_TEST_OWNER_DATABASE_URL/);
  assert.doesNotMatch(pr132E2E, /process\.env\.NEON_RBAC_TEST_OWNER_DATABASE_URL/);
  assert.match(pr132E2E, /uri\.searchParams\.get\("sslmode"\) === "verify-full"/);
  assert.match(pr132E2E, /uri\.searchParams\.get\("sslrootcert"\) === "system"/);
  assert.match(workflow, /NEON_RBAC_PR132_TEST_OWNER_DATABASE_URL: \$\{\{ github\.event\.pull_request\.number == 132/);
  assert.match(workflow, /vars\.IAM_PR132_RBAC_APPROVED_SHA == github\.event\.pull_request\.head\.sha/);
  assert.match(workflow, /E2E_RBAC_PR132_BRANCH_ID: \$\{\{ github\.event\.pull_request\.number == 132/);
  const lease=pr132E2E.indexOf("assertRbacFixtureLease(ID)");
  const secrets=pr132E2E.indexOf("const connection = process.env.NEON_RBAC_PR132_TEST_OWNER_DATABASE_URL");
  assert.ok(lease>0 && secrets>lease);
});

test("PR132 distinct fixture denies active A grant to B and cleans synthetic rows", () => {
  assert.match(pr132E2E, /tenant: "13200000-0000-4000-8000-000000000132"/);
  assert.match(pr132E2E, /tenantB: "13200000-0000-4000-8000-000000000133"/);
  assert.match(pr132E2E, /"tenants_b"/);
  assert.match(pr132E2E, /cross-tenant-B/);
  assert.match(pr132E2E, /cross-identity/);
  assert.match(pr132E2E, /ungranted-permission/);
  assert.match(pr132E2E, /await revoke\(sql\)/);
  assert.match(pr132E2E, /if\(fixtureStarted\)/);
  assert.match(pr132E2E, /await cleanup\(sql\)/);
  assert.match(pr132E2E, /key=1; ledger=0/);
});
