"use strict";
const { test, expect } = require("@playwright/test");
const { createHash } = require("node:crypto");
const { neon } = require("@neondatabase/serverless");

const ID = {
  project: "tiny-rice-70320263",
  branch: "br-super-sound-b63gtz88",
  parent: "br-muddy-bar-b63ksdy7",
  name: "validation/pr-128-rbac-http-isolated-20261120",
  expiresAt: "2026-11-21T22:00:00Z",
  host: "ep-red-sunset-b6ozp5b2.c-2.sa-east-1.aws.neon.tech",
  tenant: "12800000-0000-4000-8000-000000000128",
  tenantB: "12800000-0000-4000-8000-000000000133",
  identity: "12800000-0000-4000-8000-000000000134",
  membership: "12800000-0000-4000-8000-000000000135",
  role: "12800000-0000-4000-8000-000000000136",
  rollbackTenant: "12800000-0000-4000-8000-000000000137",
  issuer: "https://iam-control-center.us.auth0.com/",
  subjectHash: "e8cd8b1bf515f595a4531fb01ed6ae3d42c8929d28a50416759789376423a9f0",
};
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
const countsQuery =
  "SELECT " +
  "(SELECT count(*)::int FROM iam.tenants WHERE id=$1::uuid) tenants, " +
  "(SELECT count(*)::int FROM iam.tenants WHERE id=$5::uuid) tenants_b, " +
  "(SELECT count(*)::int FROM iam.identities WHERE id=$2::uuid) identities, " +
  "(SELECT count(*)::int FROM iam.memberships WHERE id=$3::uuid) memberships, " +
  "(SELECT count(*)::int FROM iam.roles WHERE id=$4::uuid) roles, " +
  "(SELECT count(*)::int FROM iam.membership_roles WHERE tenant_id=$1::uuid AND membership_id=$3::uuid) membership_roles, " +
  "(SELECT count(*)::int FROM iam.role_permissions WHERE tenant_id=$1::uuid AND role_id=$4::uuid) role_permissions, " +
  "(SELECT count(*)::int FROM iam.tenants WHERE id=$6::uuid) rollback_tenants, " +
  "(SELECT count(*)::int FROM app_private.context_keys WHERE active) active_keys, " +
  "(SELECT count(*)::int FROM iam.schema_migrations) ledger_rows";
const countKeys = [
  "tenants", "tenants_b", "identities", "memberships", "roles",
  "membership_roles", "role_permissions", "rollback_tenants",
];
const counts = async (sql) =>
  (await sql.query(countsQuery, [
    ID.tenant, ID.identity, ID.membership, ID.role, ID.tenantB, ID.rollbackTenant,
  ]))[0];
const zero = (result) => countKeys.every((key) => result[key] === 0);
function q(sql, statement, args = []) {
  return sql.query(statement, args);
}
async function owner(sql, queries) {
  return sql.transaction([q(sql, "SET LOCAL ROLE iam_owner"), ...queries]);
}

async function connect() {
  const { assertRbacFixtureLease } = await import("../../scripts/neon-rbac-fixture-lease.mjs");
  assertRbacFixtureLease(ID);
  check(
    process.env.GITHUB_REPOSITORY === "alexoaraujo/iam-control-center-new" &&
      process.env.GITHUB_EVENT_NAME === "pull_request_target" ||
      process.env.GITHUB_EVENT_NAME === "issue_comment",
    "G3 executor repository/event is not trusted",
  );
  check(
    process.env.GITHUB_REF === "refs/heads/main" &&
      process.env.G3_PR_HEAD_SHA === process.env.G3_APPROVED_SHA &&
      /^[0-9a-f]{40}$/.test(process.env.G3_PR_HEAD_SHA || ""),
    "G3 approved SHA or trusted main ref mismatch",
  );
  check(
    process.env.E2E_CALLBACK_HOST === "iam-control-center-new-pr128-ci.vercel.app" &&
      process.env.E2E_CALLBACK_BRANCH === "integration/peos-single-maintainer-bun-20261117" &&
      new URL(process.env.E2E_BASE_URL || "https://invalid.example").hostname ===
        process.env.E2E_CALLBACK_HOST,
    "PR128 Preview/callback binding mismatch",
  );
  check(
    process.env.E2E_RBAC_PROJECT_ID === ID.project &&
      process.env.E2E_RBAC_PR128_BRANCH_ID === ID.branch,
    "G3 Neon project/branch binding mismatch",
  );
  check(
    process.env.AUTH0_E2E_USERNAME &&
      process.env.AUTH0_E2E_PASSWORD &&
      process.env.VERCEL_TRUSTED_OIDC_TOKEN,
    "G3 Auth0 or Vercel Trusted Source credentials are unavailable",
  );

  const connection = process.env.NEON_RBAC_PR128_TEST_OWNER_DATABASE_URL;
  check(typeof connection === "string" && connection.startsWith("postgresql://"),
    "G3 owner URL is missing");
  const uri = new URL(connection);
  check(
    uri.protocol === "postgresql:" &&
      uri.hostname === ID.host &&
      uri.pathname === "/iam_database" &&
      decodeURIComponent(uri.username) === "neondb_owner" &&
      Boolean(uri.password) &&
      uri.searchParams.get("sslmode") === "verify-full" &&
      uri.searchParams.get("sslrootcert") === "system",
    "G3 owner URL failed the direct endpoint/database/role/TLS allowlist",
  );

  const sql = neon(connection);
  const session = await sql.query(
    "SELECT current_database() AS database_name, " +
    "current_setting('neon.branch_id', true) AS branch_id, current_user AS principal",
  );
  check(
    session.length === 1 &&
      session[0].database_name === "iam_database" &&
      session[0].branch_id === ID.branch &&
      session[0].principal === "neondb_owner",
    "G3 SQL session is not the approved disposable Neon branch",
  );

  const topology = await sql.query(
    "SELECT pg_has_role(current_user,'iam_owner','SET') AS may_set_iam_owner, " +
    "(SELECT NOT rolbypassrls AND NOT rolsuper AND NOT rolcanlogin FROM pg_roles WHERE rolname='iam_owner') AS iam_owner_safe, " +
    "(SELECT NOT rolbypassrls AND NOT rolsuper FROM pg_roles WHERE rolname='iam_app_runtime_login') AS runtime_safe",
  );
  check(
    topology.length === 1 &&
      topology[0].may_set_iam_owner === true &&
      topology[0].iam_owner_safe === true &&
      topology[0].runtime_safe === true,
    "G3 owner/runtime role topology is not safe",
  );

  const setRole = await owner(sql, [
    q(sql, "SELECT current_user AS effective_role"),
  ]);
  check(
    setRole[1]?.[0]?.effective_role === "iam_owner",
    "SET LOCAL ROLE iam_owner did not take effect",
  );

  const activeKey = await sql.query(
    "SELECT key_id FROM app_private.context_keys WHERE active",
  );
  check(
    activeKey.length === 1 && activeKey[0].key_id === "synthetic-release-validation",
    "G3 active context-key identity mismatch",
  );
  const baseline = await counts(sql);
  check(
    zero(baseline) && baseline.active_keys === 1 && baseline.ledger_rows === 0,
    "G3 fixture IDs are not clean or protected key/ledger baseline changed",
  );
  const permission = await sql.query(
    "SELECT count(*)::int AS n FROM iam.permissions WHERE permission_key='iam.tenant.read'",
  );
  check(permission[0]?.n === 1, "Canonical iam.tenant.read permission is not unique");
  console.log("PASS_G3_NEON_DIRECT_TLS_DATABASE_BRANCH_OWNER_SET_LOCAL_ROLE_AND_BASELINE");
  return sql;
}

async function create(sql, subject) {
  await owner(sql, [
    q(sql,
      "INSERT INTO iam.tenants(id,slug,display_name) VALUES($1::uuid,'peos-auth0-http-128','PEOS disposable RBAC HTTP gate')",
      [ID.tenant]),
    q(sql,
      "INSERT INTO iam.tenants(id,slug,display_name) VALUES($1::uuid,'peos-auth0-http-128-b','PEOS disposable RBAC tenant B')",
      [ID.tenantB]),
    q(sql,
      "INSERT INTO iam.identities(id,issuer,subject,status) VALUES($1::uuid,$2,$3,'active')",
      [ID.identity, ID.issuer, subject]),
    q(sql,
      "INSERT INTO iam.memberships(id,tenant_id,identity_id,status,joined_at) VALUES($1::uuid,$2::uuid,$3::uuid,'active',clock_timestamp())",
      [ID.membership, ID.tenant, ID.identity]),
    q(sql,
      "INSERT INTO iam.roles(id,tenant_id,role_key,display_name) VALUES($1::uuid,$2::uuid,'peos_auth0_128','PEOS temporary RBAC reader')",
      [ID.role, ID.tenant]),
    q(sql,
      "INSERT INTO iam.role_permissions(tenant_id,role_id,permission_key) VALUES($1::uuid,$2::uuid,'iam.tenant.read')",
      [ID.tenant, ID.role]),
    q(sql,
      "INSERT INTO iam.membership_roles(tenant_id,membership_id,role_id) VALUES($1::uuid,$2::uuid,$3::uuid)",
      [ID.tenant, ID.membership, ID.role]),
  ]);
  const created = await counts(sql);
  check(
    created.tenants === 1 && created.tenants_b === 1 &&
      created.identities === 1 && created.memberships === 1 &&
      created.roles === 1 && created.membership_roles === 1 &&
      created.role_permissions === 1 && created.rollback_tenants === 0,
    "G3 fixture insert integrity failed",
  );
  console.log("PASS_G3_SYNTHETIC_TENANT_IDENTITY_MEMBERSHIP_ROLE_GRANT");
}

async function revoke(sql) {
  await owner(sql, [
    q(sql,
      "DELETE FROM iam.membership_roles WHERE tenant_id=$1::uuid AND membership_id=$2::uuid AND role_id=$3::uuid",
      [ID.tenant, ID.membership, ID.role]),
  ]);
  const result = await counts(sql);
  check(
    result.membership_roles === 0 && result.role_permissions === 1,
    "G3 revoke did not remove only the membership grant",
  );
}

async function proveRollback(sql) {
  await owner(sql, [
    q(sql,
      "INSERT INTO iam.tenants(id,slug,display_name) VALUES($1::uuid,'peos-auth0-http-128-rollback','rollback-before')",
      [ID.rollbackTenant]),
  ]);
  await owner(sql, [
    q(sql,
      "UPDATE iam.tenants SET display_name='rollback-committed' WHERE id=$1::uuid",
      [ID.rollbackTenant]),
  ]);
  const before = await sql.query(
    "SELECT display_name FROM iam.tenants WHERE id=$1::uuid",
    [ID.rollbackTenant],
  );
  check(before[0]?.display_name === "rollback-committed",
    "G3 rollback baseline update did not commit");

  let forcedFailure = false;
  try {
    await owner(sql, [
      q(sql,
        "UPDATE iam.tenants SET display_name='rollback-must-not-commit' WHERE id=$1::uuid",
        [ID.rollbackTenant]),
      q(sql, "SELECT 1 / 0"),
    ]);
  } catch {
    forcedFailure = true;
  }
  check(forcedFailure, "G3 rollback control did not raise the expected transaction failure");
  const after = await sql.query(
    "SELECT display_name FROM iam.tenants WHERE id=$1::uuid",
    [ID.rollbackTenant],
  );
  check(after[0]?.display_name === "rollback-committed",
    "G3 transaction rollback did not restore the committed baseline");
  console.log("PASS_G3_TRANSACTION_ROLLBACK");
}

async function cleanup(sql) {
  await owner(sql, [
    q(sql,
      "DELETE FROM iam.membership_roles WHERE tenant_id=$1::uuid AND membership_id=$2::uuid AND role_id=$3::uuid",
      [ID.tenant, ID.membership, ID.role]),
    q(sql,
      "DELETE FROM iam.role_permissions WHERE tenant_id=$1::uuid AND role_id=$2::uuid AND permission_key='iam.tenant.read'",
      [ID.tenant, ID.role]),
    q(sql,
      "DELETE FROM iam.roles WHERE id=$1::uuid AND tenant_id=$2::uuid",
      [ID.role, ID.tenant]),
    q(sql,
      "DELETE FROM iam.memberships WHERE id=$1::uuid AND tenant_id=$2::uuid AND identity_id=$3::uuid",
      [ID.membership, ID.tenant, ID.identity]),
    q(sql,
      "DELETE FROM iam.identities WHERE id=$1::uuid AND issuer=$2",
      [ID.identity, ID.issuer]),
    q(sql, "DELETE FROM iam.tenants WHERE id=$1::uuid", [ID.tenant]),
    q(sql, "DELETE FROM iam.tenants WHERE id=$1::uuid", [ID.tenantB]),
    q(sql, "DELETE FROM iam.tenants WHERE id=$1::uuid", [ID.rollbackTenant]),
  ]);
  const result = await counts(sql);
  check(
    zero(result) && result.active_keys === 1 && result.ledger_rows === 0,
    "G3 cleanup failed: fixture residue or protected key/ledger baseline changed",
  );
  console.log("PASS_G3_ZERO_RESIDUE tenants=0 identities=0 memberships=0 roles=0 grants=0 rollback=0 key=1 ledger=0");
}

async function checkHttp(page, selectors = {}) {
  const context = {
    tenantId: selectors.tenantId ?? ID.tenant,
    identityId: selectors.identityId ?? ID.identity,
    permission: selectors.permission ?? "iam.tenant.read",
  };
  return page.evaluate(async (input) => {
    const response = await fetch("/api/authorization/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(input),
    });
    return {
      status: response.status,
      body: await response.json(),
      cache: response.headers.get("cache-control"),
    };
  }, context);
}

test("PR128 G3: real Auth0 grant 200, cross-tenant deny, revoke 403, rollback and zero residue", async ({ page }) => {
  const sql = await connect();
  const host = process.env.E2E_CALLBACK_HOST;
  const token = process.env.VERCEL_TRUSTED_OIDC_TOKEN;
  const cdp = await page.context().newCDPSession(page);
  let callback = false;
  let fixtureStarted = false;
  let failure;
  let cleanupFailure;

  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  cdp.on("Fetch.requestPaused", async ({ requestId, request }) => {
    try {
      const url = new URL(request.url);
      const headers = Object.entries(request.headers)
        .filter(([name]) => name.toLowerCase() !== "x-vercel-trusted-oidc-idp-token")
        .map(([name, value]) => ({ name, value: String(value) }));
      if (url.hostname === host) {
        headers.push({ name: "x-vercel-trusted-oidc-idp-token", value: token });
        if (url.pathname === "/auth/callback") callback = true;
      }
      await cdp.send("Fetch.continueRequest", { requestId, headers });
    } catch {
      await cdp.send("Fetch.failRequest", { requestId, errorReason: "Aborted" }).catch(() => {});
    }
  });

  try {
    await page.goto("/protected");
    await expect(page).toHaveURL(/iam-control-center\.us\.auth0\.com/);
    const login = page.locator('input[name="username"],input[name="email"]').first();
    await expect(login).toBeVisible();
    await login.fill(process.env.AUTH0_E2E_USERNAME);
    const password = page.locator('input[name="password"]');
    if (!(await password.isVisible().catch(() => false))) {
      await page.getByRole("button", { name: /continue/i }).first().click();
    }
    await expect(password).toBeVisible();
    await password.fill(process.env.AUTH0_E2E_PASSWORD);
    await page.getByRole("button", { name: /continue|log in|sign in/i }).last().click();
    await expect(page).toHaveURL((url) => url.pathname === "/protected", { timeout: 60000 });
    await expect(page.getByRole("status")).toHaveText("Acesso autenticado confirmado.");
    expect(callback).toBe(true);

    const profile = await page.evaluate(async () => {
      const response = await fetch("/auth/profile", {
        credentials: "same-origin",
        cache: "no-store",
      });
      return { status: response.status, data: response.ok ? await response.json() : null };
    });
    expect(profile.status).toBe(200);
    const subject = profile.data?.sub;
    check(
      typeof subject === "string" &&
        createHash("sha256").update(subject, "utf8").digest("hex") === ID.subjectHash,
      "G3 Auth0 subject is not the approved test identity",
    );

    const databaseHealth = await page.evaluate(async () => {
      const response = await fetch("/api/health/database", {
        credentials: "same-origin",
        cache: "no-store",
      });
      return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
    });
    expect(databaseHealth).toEqual({
      status: 200,
      body: { ok: true, database: "reachable" },
      cache: "no-store",
    });
    const runtimeReady = await page.evaluate(async () => {
      const response = await fetch("/api/ready", {
        credentials: "same-origin",
        cache: "no-store",
      });
      return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
    });
    expect(runtimeReady).toEqual({
      status: 200,
      body: { ready: true, reason: "dependencies_available" },
      cache: "no-store",
    });
    console.log("PASS_G3_PREVIEW_RUNTIME_DATABASE_AND_NOBYPASSRLS_ROLE");

    fixtureStarted = true;
    await create(sql, subject);
    const granted = await checkHttp(page);
    expect(granted).toEqual({ status: 200, body: { allowed: true }, cache: "no-store" });
    console.log("PASS_G3_GRANT_HTTP_200");

    for (const [label, selectors] of [
      ["cross-tenant-B", { tenantId: ID.tenantB }],
      ["cross-identity", { identityId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }],
      ["ungranted-permission", { permission: "iam.tenant.manage" }],
    ]) {
      const denied = await checkHttp(page, selectors);
      expect(denied, label + " must be denied while tenant A grant is active").toEqual({
        status: 403,
        body: { allowed: false },
        cache: "no-store",
      });
    }
    console.log("PASS_G3_CROSS_TENANT_CROSS_IDENTITY_AND_UNGRANTED_PERMISSION_HTTP_403");

    await revoke(sql);
    const revoked = await checkHttp(page);
    expect(revoked).toEqual({ status: 403, body: { allowed: false }, cache: "no-store" });
    console.log("PASS_G3_REVOKE_HTTP_403_SAME_AUTH0_SESSION");

    await proveRollback(sql);
  } catch (error) {
    failure = error;
  } finally {
    if (fixtureStarted) {
      try {
        await cleanup(sql);
      } catch (error) {
        cleanupFailure = error;
      }
    }
    await cdp.send("Fetch.disable").catch(() => {});
    await cdp.detach().catch(() => {});
  }

  if (cleanupFailure) {
    throw new Error("G3 failed: zero-residue cleanup was not proven", { cause: cleanupFailure });
  }
  if (failure) throw failure;
  console.log("PASS_G3_COMPLETE_AUTH0_RBAC_CLEANUP_ROLLBACK_AND_ZERO_RESIDUE");
});
