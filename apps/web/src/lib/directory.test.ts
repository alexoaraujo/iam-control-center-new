import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { query, transaction, getSql } = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn(), getSql: vi.fn() }));
vi.mock("./db", () => ({ getSql }));
import { directoryEnabled, readTenantDirectory } from "./authorization";
import { DIRECTORY_SQL } from "./directory-query";
const tenant = "11111111-1111-4111-8111-111111111111";
const identity = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
beforeEach(() => {
  vi.resetAllMocks();
  for (const [key,value] of Object.entries({
    IAM_DIRECTORY_PREVIEW_ENABLED: "true", VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "feat/peos-p2-tenant-directory-20261125", APP_BASE_URL: "https://iam-control-center-new-p2-directory-ci.vercel.app",
    IAM_DIRECTORY_PREVIEW_BRANCH_ID: "br-fixture-directory", IAM_DIRECTORY_PREVIEW_EXPIRES_AT: new Date(Date.now()+600000).toISOString(),
    IAM_DIRECTORY_PREVIEW_LEASE_START_AT: new Date(Date.now()-1000).toISOString(),
    VERCEL_GIT_COMMIT_SHA: "a".repeat(40), IAM_DIRECTORY_PREVIEW_APPROVED_SHA: "a".repeat(40),
    DATABASE_RUNTIME_ROLE: "iam_app_runtime_login", AUTH0_DOMAIN: "example.auth0.com", AUTHZ_CONTEXT_SIGNING_KEY_HEX: "42".repeat(32),
  })) vi.stubEnv(key,value);
  getSql.mockReturnValue({ query, transaction });
  query.mockResolvedValue([{ role: "iam_app_runtime_login", login: "iam_app_runtime_login", rolsuper: false, rolbypassrls: false, branch_id: "br-fixture-directory" }]);
  transaction.mockResolvedValue([[], [{ allowed: true, rows: [{ id: identity, displayName: "Synthetic", status: "active", email: "hidden" }] }]]);
});
afterEach(() => { vi.unstubAllEnvs(); });
it("denies disabled, Production and expired fixtures before SQL", async () => {
  vi.stubEnv("VERCEL_ENV", "production");
  expect(directoryEnabled()).toBe(false);
  expect(await readTenantDirectory("auth0|fixture",tenant,identity,"identities",null)).toBeNull();
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("IAM_DIRECTORY_PREVIEW_EXPIRES_AT", "2000-01-01");
  expect(await readTenantDirectory("auth0|fixture",tenant,identity,"identities",null)).toBeNull();
  expect(getSql).not.toHaveBeenCalled();
});
it("requires exact login and branch before creating the transaction", async () => {
  query.mockResolvedValueOnce([{ role: "iam_app_runtime_login", login: "postgres", rolsuper: false, rolbypassrls: false, branch_id: "br-fixture-directory" }]);
  expect(await readTenantDirectory("auth0|fixture",tenant,identity,"identities",null)).toBeNull();
  expect(transaction).not.toHaveBeenCalled();
});
it("binds data and authorization in one read-only transaction and projects only safe fields", async () => {
  expect(await readTenantDirectory("auth0|fixture",tenant,identity,"identities",null)).toEqual({ rows: [{ id: identity, displayName: "Synthetic", status: "active" }], nextCursor: null });
  expect(query.mock.calls[1][0]).toContain("iam.set_tenant_context");
  expect(query.mock.calls[2][0]).toBe(DIRECTORY_SQL);
  expect(query.mock.calls[2][1]).toEqual([tenant,identity,"https://example.auth0.com/","auth0|fixture","identities",null,"br-fixture-directory"]);
  expect(transaction.mock.calls[0][1]).toMatchObject({readOnly:true});
});
it("fails closed on missing permission and unexpected result", async () => {
  transaction.mockResolvedValueOnce([[], [{ allowed: false, rows: [] }]]);
  expect(await readTenantDirectory("auth0|fixture",tenant,identity,"identities",null)).toBeNull();
  transaction.mockResolvedValueOnce([[], [{ allowed: true, rows: [{ id: identity, displayName: null, status: "revoked" }] }]]);
  expect(await readTenantDirectory("auth0|fixture",tenant,identity,"identities",null)).toBeNull();
});

it("rejects a missing or different approved SHA before any SQL", async () => {
  for (const sha of ["", "b".repeat(40), "a".repeat(12)]) {
    vi.stubEnv("IAM_DIRECTORY_PREVIEW_APPROVED_SHA", sha);
    expect(await readTenantDirectory("auth0|fixture",tenant,identity,"identities",null)).toBeNull();
  }
  expect(getSql).not.toHaveBeenCalled();
});
it("rejects an oversized or future lease and reserved branches", async () => {
  vi.stubEnv("IAM_DIRECTORY_PREVIEW_LEASE_START_AT", new Date(Date.now()-3*60*60*1000).toISOString());
  expect(directoryEnabled()).toBe(false);
  vi.stubEnv("IAM_DIRECTORY_PREVIEW_LEASE_START_AT", new Date(Date.now()+1000).toISOString());
  expect(directoryEnabled()).toBe(false);
  vi.stubEnv("IAM_DIRECTORY_PREVIEW_LEASE_START_AT", new Date(Date.now()-1000).toISOString());
  for (const id of ["br-muddy-snow-b63cepcv","br-ancient-term-b6mmx5ol","br-calm-forest-b6a1jpzs","br-floral-glitter-b6zvytjp","br-solitary-sunset-b681d15f"]) {
    vi.stubEnv("IAM_DIRECTORY_PREVIEW_BRANCH_ID", id);
    expect(await readTenantDirectory("auth0|fixture",tenant,identity,"identities",null)).toBeNull();
  }
  expect(getSql).not.toHaveBeenCalled();
});
