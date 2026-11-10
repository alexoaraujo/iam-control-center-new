import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { query, getSql } = vi.hoisted(() => ({ query: vi.fn(), getSql: vi.fn() }));
vi.mock("./db", () => ({ getSql }));
import { checkReadiness } from "./readiness";
describe("dependency readiness", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    for (const key of ["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET", "APP_BASE_URL", "DATABASE_URL"]) vi.stubEnv(key, "configured");
    vi.stubEnv("DATABASE_RUNTIME_ROLE", "iam_app_runtime_login");
    getSql.mockReturnValue({ query });
  });
  afterEach(() => vi.unstubAllEnvs());
  it("requires complete configuration without connecting", async () => {
    vi.stubEnv("AUTH0_SECRET", " ");
    expect(await checkReadiness()).toEqual({ ready: false, reason: "configuration_incomplete" });
    expect(getSql).not.toHaveBeenCalled();
  });
  it("requires an explicitly expected runtime role", async () => {
    vi.stubEnv("DATABASE_RUNTIME_ROLE", "");
    expect((await checkReadiness()).reason).toBe("runtime_role_unconfigured");
    expect(getSql).not.toHaveBeenCalled();
  });
  it("accepts the expected nonprivileged role with a bounded uncached probe", async () => {
    query.mockResolvedValue([{ role: "iam_app_runtime_login", rolsuper: false, rolbypassrls: false }]);
    expect((await checkReadiness()).ready).toBe(true);
    expect(query.mock.calls[0][2].fetchOptions.signal).toBeInstanceOf(AbortSignal);
    expect(query.mock.calls[0][2].fetchOptions.cache).toBe("no-store");
  });
  for (const role of [undefined, { role: "owner", rolsuper: false, rolbypassrls: false }, { role: "iam_app_runtime_login", rolsuper: true, rolbypassrls: false }, { role: "iam_app_runtime_login", rolsuper: false, rolbypassrls: true }]) {
    it(`rejects unsafe runtime ${JSON.stringify(role)}`, async () => {
      query.mockResolvedValue(role ? [role] : []);
      expect((await checkReadiness()).reason).toBe("runtime_role_rejected");
    });
  }
  it("sanitizes connection errors including timeout", async () => {
    query.mockRejectedValue(new Error("postgres://user:secret@host/database"));
    expect(await checkReadiness()).toEqual({ ready: false, reason: "database_unavailable" });
  });
});
