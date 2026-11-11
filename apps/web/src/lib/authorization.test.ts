import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { query, transaction, getSql } = vi.hoisted(() => ({
  query: vi.fn(), transaction: vi.fn(), getSql: vi.fn(),
}));
vi.mock("./db", () => ({ getSql }));
import { checkPermission, validPermission, validSelector } from "./authorization";

const tenantId = "11111111-1111-4111-8111-111111111111";
const identityId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const secret = "42".repeat(32); // synthetic CI-only key, never production.
const runtime = {
  role: "iam_app_runtime_login", login: "iam_app_runtime_login",
  rolsuper: false, rolbypassrls: false,
};
const fakeTaggedSql = (strings: TemplateStringsArray, ...params: unknown[]) => ({
  sql: strings.join("?"), params,
});

describe("trusted server-only authorization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("AUTH0_DOMAIN", "example.auth0.com");
    vi.stubEnv("DATABASE_RUNTIME_ROLE", "iam_app_runtime_login");
    vi.stubEnv("AUTHZ_CONTEXT_SIGNING_KEY_HEX", secret);
    getSql.mockReturnValue({ query, transaction });
    query.mockResolvedValue([runtime]);
    transaction.mockResolvedValue([[], [{ allowed: true }]]);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("mints an HMAC only inside the server and binds issuer, subject and tenant in one DB transaction", async () => {
    expect(await checkPermission("auth0|subject-a", tenantId, identityId, "iam.tenant.read")).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(1);
    const [build, options] = transaction.mock.calls[0];
    const statements = build(fakeTaggedSql);
    expect(statements).toHaveLength(2);
    expect(statements[0].sql).toContain("iam.set_tenant_context");
    expect(statements[1].sql).toContain("iam.effective_permissions");
    expect(statements[1].sql).toContain("app_private.current_tenant_id()");
    expect(statements[1].sql).toContain("m.status='active'");
    expect(statements[1].sql).toContain("i.subject=");
    expect(statements[1].sql).toContain("ap.enabled");
    expect(statements[1].params).toContain("https://example.auth0.com/");
    expect(statements[1].params).toContain("auth0|subject-a");
    expect(statements[1].params).toContain("iam.tenant.read");
    expect(options.readOnly).toBe(true);

    const [tenant, identity, expiry, nonce, signature] = statements[0].params as [
      string, string, number, string, string,
    ];
    expect(tenant).toBe(tenantId);
    expect(identity).toBe(identityId);
    expect(expiry).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(expiry).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 60);
    expect(nonce).toMatch(/^[a-f0-9]{32}$/);
    expect(signature).toBe(createHmac("sha256", Buffer.from(secret, "hex"))
      .update(`${tenant}|${identity}|${expiry}|${nonce}`, "utf8").digest("hex"));
  });

  it("uses a fresh secret nonce for every check and never lets a browser choose a signature", async () => {
    await checkPermission("auth0|subject-a", tenantId, identityId, "iam.tenant.read");
    await checkPermission("auth0|subject-a", tenantId, identityId, "iam.tenant.read");
    const calls = transaction.mock.calls.map(([build]) => build(fakeTaggedSql)[0].params);
    expect(calls[0][3]).not.toBe(calls[1][3]);
    expect(calls[0][4]).not.toBe(calls[1][4]);
  });

  it("fails closed without a protected key or with malformed signing material", async () => {
    for (const key of ["", "00", "not-a-secret", "a".repeat(63)]) {
      vi.stubEnv("AUTHZ_CONTEXT_SIGNING_KEY_HEX", key);
      expect(await checkPermission("auth0|subject-a", tenantId, identityId, "iam.tenant.read")).toBe(false);
    }
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects invalid selectors, permission and Auth0 issuer without database access", async () => {
    expect(validSelector(tenantId)).toBe(true);
    expect(validSelector("not-a-uuid")).toBe(false);
    expect(validPermission("iam.tenant.read")).toBe(true);
    expect(validPermission("iam.tenant.*")).toBe(false);
    expect(await checkPermission("auth0|subject-a", "not-uuid", identityId, "iam.tenant.read")).toBe(false);
    expect(await checkPermission("auth0|subject-a", tenantId, identityId, "iam.tenant.*")).toBe(false);
    vi.stubEnv("AUTH0_DOMAIN", "https://evil.invalid/");
    expect(await checkPermission("auth0|subject-a", tenantId, identityId, "iam.tenant.read")).toBe(false);
    expect(getSql).not.toHaveBeenCalled();
  });

  it.each([
    { ...runtime, login: "neondb_owner" },
    { ...runtime, role: "neondb_owner" },
    { ...runtime, rolsuper: true },
    { ...runtime, rolbypassrls: true },
  ])("rejects an unsafe database principal %j", async (role) => {
    query.mockResolvedValueOnce([role]);
    expect(await checkPermission("auth0|subject-a", tenantId, identityId, "iam.tenant.read")).toBe(false);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("denies missing grants, an ABAC policy or identity mismatch", async () => {
    transaction.mockResolvedValueOnce([[], [{ allowed: false }]]);
    expect(await checkPermission("auth0|subject-b", tenantId, identityId, "iam.tenant.read")).toBe(false);
  });

  it("denies on rejected signature, database errors and never surfaces connection information", async () => {
    transaction.mockRejectedValueOnce(new Error("postgresql://secret:secret@host"));
    expect(await checkPermission("auth0|subject-a", tenantId, identityId, "iam.tenant.read")).toBe(false);
  });

  it("rejects missing Auth0 subject and unexpected runtime role", async () => {
    expect(await checkPermission("", tenantId, identityId, "iam.tenant.read")).toBe(false);
    vi.stubEnv("DATABASE_RUNTIME_ROLE", "neondb_owner");
    expect(await checkPermission("auth0|subject-a", tenantId, identityId, "iam.tenant.read")).toBe(false);
    expect(getSql).not.toHaveBeenCalled();
  });
});
