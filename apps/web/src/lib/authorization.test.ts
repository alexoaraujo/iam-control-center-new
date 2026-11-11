import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { query, getSql } = vi.hoisted(() => ({ query: vi.fn(), getSql: vi.fn() }));
vi.mock("./db", () => ({ getSql }));
import { checkPermission, validPermission, validProof } from "./authorization";

const proof = () => ({
  tenantId: "11111111-1111-4111-8111-111111111111",
  identityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  expires: Math.floor(Date.now() / 1000) + 120,
  nonce: "synthetic-unit-test",
  signature: "a".repeat(64),
});
const runtime = { role: "iam_app_runtime_login", login: "iam_app_runtime_login", rolsuper: false, rolbypassrls: false };

describe("server authorization evaluator", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("AUTH0_DOMAIN", "example.auth0.com");
    vi.stubEnv("DATABASE_RUNTIME_ROLE", "iam_app_runtime_login");
    getSql.mockReturnValue({ query });
    query.mockResolvedValueOnce([runtime]).mockResolvedValueOnce([{ allowed: true }]);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("permits only exact vetted role + HMAC signed-context query after identity binding", async () => {
    expect(await checkPermission("auth0|subject-a", proof(), "iam.tenant.read")).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
    const [sql, params, options] = query.mock.calls[1];
    expect(sql).toContain("iam.set_tenant_context");
    expect(sql).toContain("iam.effective_permissions");
    expect(sql).toContain("app_private.current_tenant_id()");
    expect(sql).toContain("m.status='active'");
    expect(sql).toContain("i.subject=$7::text");
    expect(sql).toContain("ap.enabled");
    expect(params.slice(-3)).toEqual(["https://example.auth0.com/", "auth0|subject-a", "iam.tenant.read"]);
    expect(options.fetchOptions.cache).toBe("no-store");
  });

  it("rejects unsigned, stale, malformed or remote-future proof without querying", async () => {
    for (const p of [
      { ...proof(), signature: "garbage" },
      { ...proof(), expires: Math.floor(Date.now() / 1000) - 1 },
      { ...proof(), expires: Math.floor(Date.now() / 1000) + 400 },
      { ...proof(), tenantId: "not-a-uuid" },
      { ...proof(), nonce: "" },
    ]) {
      expect(validProof(p)).toBe(false);
      expect(await checkPermission("auth0|subject-a", p, "iam.tenant.read")).toBe(false);
    }
    expect(getSql).not.toHaveBeenCalled();
  });

  it("denies unknown permissions and unconfigured role", async () => {
    expect(validPermission("iam.tenant.read")).toBe(true);
    expect(validPermission("iam.tenant.*")).toBe(false);
    expect(await checkPermission("auth0|subject-a", proof(), "iam.tenant.*")).toBe(false);
    vi.stubEnv("DATABASE_RUNTIME_ROLE", "neondb_owner");
    expect(await checkPermission("auth0|subject-a", proof(), "iam.tenant.read")).toBe(false);
    expect(getSql).not.toHaveBeenCalled();
  });

  it.each([
    { ...runtime, login: "neondb_owner" },
    { ...runtime, role: "neondb_owner" },
    { ...runtime, rolsuper: true },
    { ...runtime, rolbypassrls: true },
  ])("denies unsafe session / role %j before running tenant SQL", async (role) => {
    query.mockReset().mockResolvedValueOnce([role]);
    expect(await checkPermission("auth0|subject-a", proof(), "iam.tenant.read")).toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("denies missing grants, an enabled policy or a mismatched identity from the SQL result", async () => {
    query.mockReset().mockResolvedValueOnce([runtime]).mockResolvedValueOnce([{ allowed: false }]);
    expect(await checkPermission("auth0|subject-b", proof(), "iam.tenant.read")).toBe(false);
  });

  it("fails closed on a rejected HMAC or a Neon error without logging the exception", async () => {
    query.mockReset().mockResolvedValueOnce([runtime]).mockRejectedValueOnce(new Error("postgresql://secret:secret@host"));
    expect(await checkPermission("auth0|subject-a", proof(), "iam.tenant.read")).toBe(false);
  });

  it("rejects absent or overlong identity", async () => {
    expect(await checkPermission("", proof(), "iam.tenant.read")).toBe(false);
    expect(await checkPermission("a".repeat(513), proof(), "iam.tenant.read")).toBe(false);
    expect(getSql).not.toHaveBeenCalled();
  });
});
