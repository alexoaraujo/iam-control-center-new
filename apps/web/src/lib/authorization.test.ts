import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { query, transaction, getSql } = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn(), getSql: vi.fn() }));
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
    getSql.mockReturnValue({ query, transaction });
    query.mockResolvedValue([runtime]);
    transaction.mockResolvedValue([[], [{ allowed: true }]]);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("uses two statements in the SAME transaction to establish context before RLS check", async () => {
    expect(await checkPermission("auth0|subject-a", proof(), "iam.tenant.read")).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(1);
    const [build, options] = transaction.mock.calls[0];
    const fakeTaggedSql = (strings: TemplateStringsArray, ...params: unknown[]) => ({
      sql: strings.join("?"), params,
    });
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
  });

  it("rejects unsigned, expired, malformed and far-future proofs before query", async () => {
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

  it("denies unknown permissions, unknown issuer and unconfigured role", async () => {
    expect(validPermission("iam.tenant.read")).toBe(true);
    expect(validPermission("iam.tenant.*")).toBe(false);
    expect(await checkPermission("auth0|subject-a", proof(), "iam.tenant.*")).toBe(false);
    vi.stubEnv("DATABASE_RUNTIME_ROLE", "neondb_owner");
    expect(await checkPermission("auth0|subject-a", proof(), "iam.tenant.read")).toBe(false);
    vi.stubEnv("DATABASE_RUNTIME_ROLE", "iam_app_runtime_login");
    vi.stubEnv("AUTH0_DOMAIN", "https://evil.invalid/");
    expect(await checkPermission("auth0|subject-a", proof(), "iam.tenant.read")).toBe(false);
    expect(getSql).not.toHaveBeenCalled();
  });

  it.each([
    { ...runtime, login: "neondb_owner" },
    { ...runtime, role: "neondb_owner" },
    { ...runtime, rolsuper: true },
    { ...runtime, rolbypassrls: true },
  ])("rejects unsafe role/LOGIN %j before accessing protected tables", async (role) => {
    query.mockResolvedValueOnce([role]);
    expect(await checkPermission("auth0|subject-a", proof(), "iam.tenant.read")).toBe(false);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("denies missing role grants, enabled policy or a mismatched identity", async () => {
    transaction.mockResolvedValueOnce([[], [{ allowed: false }]]);
    expect(await checkPermission("auth0|subject-b", proof(), "iam.tenant.read")).toBe(false);
  });

  it("fails closed on invalid HMAC or database exceptions without leaking errors", async () => {
    transaction.mockRejectedValueOnce(new Error("postgresql://secret:secret@host"));
    expect(await checkPermission("auth0|subject-a", proof(), "iam.tenant.read")).toBe(false);
  });

  it("rejects absent or overlong subject", async () => {
    expect(await checkPermission("", proof(), "iam.tenant.read")).toBe(false);
    expect(await checkPermission("a".repeat(513), proof(), "iam.tenant.read")).toBe(false);
    expect(getSql).not.toHaveBeenCalled();
  });
});
