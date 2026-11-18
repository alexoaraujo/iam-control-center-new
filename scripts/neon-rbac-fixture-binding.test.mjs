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
