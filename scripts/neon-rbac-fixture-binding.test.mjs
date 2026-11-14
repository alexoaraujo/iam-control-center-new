import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const e2e = readFileSync(new URL("../.github/e2e/auth0-rbac.spec.cjs", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/quality.yml", import.meta.url), "utf8");

test("RBAC E2E is pinned to the approved active Neon child, never the expired fixture", () => {
  assert.match(e2e, /project: "tiny-rice-70320263", branch: "br-royal-dream-b6di0p2w"/);
  assert.match(e2e, /parent: "br-muddy-bar-b63ksdy7", name: "validation\/pr-41-auth0-rbac-e2e-20261113"/);
  assert.match(e2e, /host: "ep-shiny-pond-b6zifpoo\.c-2\.sa-east-1\.aws\.neon\.tech"/);
  assert.match(workflow, /^\s+E2E_RBAC_PROJECT_ID: tiny-rice-70320263$/m);
  assert.match(workflow, /^\s+E2E_RBAC_BRANCH_ID: br-royal-dream-b6di0p2w$/m);
  assert.doesNotMatch(e2e + workflow, /br-shy-scene-b67zm2v7/);
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

test("RBAC credentials remain scoped to one protected Preview E2E step", () => {
  assert.match(workflow, /^\s+environment:\n\s+name: Preview$/m);
  assert.match(workflow, /^\s+NEON_RBAC_TEST_OWNER_DATABASE_URL: \$\{\{ secrets\.NEON_RBAC_TEST_OWNER_DATABASE_URL \}\}$/m);
  assert.doesNotMatch(workflow, /NEON_API_KEY: \$\{\{ secrets\./);
});
