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
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
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
  function g3Preview() {
    vi.stubEnv("APP_BASE_URL", "https://iam-control-center-new-pr128-ci.vercel.app");
    vi.stubEnv("IAM_G3_EXPECTED_NEON_BRANCH_ID", "br-super-sound-b63gtz88");
    vi.stubEnv("IAM_G3_NEON_LEASE_EXPIRES_AT", "2026-11-21T22:00:00Z");
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-20T21:00:00Z"));
  }

  it("rejects PR128 Preview without matching exact branch/lease before any SQL", async () => {
    g3Preview();
    for (const [key, value] of [
      ["IAM_G3_EXPECTED_NEON_BRANCH_ID", "br-wrong"],
      ["IAM_G3_NEON_LEASE_EXPIRES_AT", "2026-11-22T22:00:00Z"],
      ["IAM_G3_EXPECTED_NEON_BRANCH_ID", ""],
    ]) {
      const valid = key === "IAM_G3_EXPECTED_NEON_BRANCH_ID"
        ? "br-super-sound-b63gtz88" : "2026-11-21T22:00:00Z";
      vi.stubEnv(key, value);
      expect(await checkReadiness()).toEqual({ ready: false, reason: "g3_fixture_lease_rejected" });
      vi.stubEnv(key, valid);
    }
    expect(getSql).not.toHaveBeenCalled();
  });

  it("rejects expired PR128 fixture even when its metadata otherwise matches", async () => {
    g3Preview();
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-21T21:45:00Z"));
    expect(await checkReadiness()).toEqual({ ready: false, reason: "g3_fixture_lease_rejected" });
    expect(getSql).not.toHaveBeenCalled();
  });

  it("rejects a safe runtime principal connected to the WRONG Neon branch", async () => {
    g3Preview();
    query.mockResolvedValue([{ role: "iam_app_runtime_login",
      rolsuper: false, rolbypassrls: false, branch_id: "br-other" }]);
    expect(await checkReadiness()).toEqual({ ready: false, reason: "g3_database_branch_rejected" });
  });

  it("attests the exact safe PR128 Neon principal and disposable branch", async () => {
    g3Preview();
    query.mockResolvedValue([{ role: "iam_app_runtime_login",
      rolsuper: false, rolbypassrls: false, branch_id: "br-super-sound-b63gtz88" }]);
    expect(await checkReadiness()).toEqual({ ready: true, reason: "dependencies_available" });
    expect(query.mock.calls[0][0]).toContain("current_setting('neon.branch_id',true)");
  });


  it("fails closed in Production before SQL when branch binding is absent", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("IAM_PRODUCTION_EXPECTED_NEON_BRANCH_ID", "");
    expect(await checkReadiness()).toEqual({ ready: false, reason: "production_branch_unconfigured" });
    expect(getSql).not.toHaveBeenCalled();
  });

  it("rejects a wrong Production database branch even with healthy connectivity and role", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("IAM_PRODUCTION_EXPECTED_NEON_BRANCH_ID", "br-muddy-snow-b63cepcv");
    query.mockResolvedValue([{ role: "iam_app_runtime_login", rolsuper: false, rolbypassrls: false, branch_id: "br-unexpected-b6testme" }]);
    expect(await checkReadiness()).toEqual({ ready: false, reason: "production_branch_mismatch" });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("attests the exact allowlisted Production branch without exposing its ID", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("IAM_PRODUCTION_EXPECTED_NEON_BRANCH_ID", "br-muddy-snow-b63cepcv");
    query.mockResolvedValue([{ role: "iam_app_runtime_login", rolsuper: false, rolbypassrls: false, branch_id: "br-muddy-snow-b63cepcv" }]);
    expect(await checkReadiness()).toEqual({ ready: true, reason: "dependencies_available" });
    expect(query).toHaveBeenCalledTimes(1);
  });

});
