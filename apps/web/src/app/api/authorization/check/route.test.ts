import { beforeEach, expect, it, vi } from "vitest";
const { getSession, checkPermission } = vi.hoisted(() => ({ getSession: vi.fn(), checkPermission: vi.fn() }));
vi.mock("../../../../lib/auth0", () => ({ auth0: { getSession } }));
vi.mock("../../../../lib/authorization", () => ({
  validProof: (value: unknown) => typeof value === "object" && value !== null && "signature" in value,
  validPermission: (value: unknown) => value === "iam.tenant.read",
  checkPermission,
}));
import { POST } from "./route";

const makeRequest = (body: unknown, contentType = "application/json") =>
  new Request("https://example.invalid/api/authorization/check", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.resetAllMocks();
  getSession.mockResolvedValue({ user: { sub: "auth0|synthetic-user" } });
});

it("returns 401 without session, without calling RBAC backend", async () => {
  getSession.mockResolvedValue(null);
  const response = await POST(makeRequest({ permission: "iam.tenant.read", context: { signature: "signed" } }));
  expect(response.status).toBe(401);
  expect(checkPermission).not.toHaveBeenCalled();
});
it("rejects unknown permission, missing context or unexpected content-type", async () => {
  for (const [body, type] of [
    [{ permission: "iam.admin.*", context: { signature: "signed" } }, "application/json"],
    [{ permission: "iam.tenant.read" }, "application/json"],
    [{ permission: "iam.tenant.read", context: { signature: "signed" } }, "text/plain"],
  ] as const) {
    const response = await POST(makeRequest(body, type));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
  expect(checkPermission).not.toHaveBeenCalled();
});
it("delegates to authenticated RBAC evaluator and returns only a boolean", async () => {
  checkPermission.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const body = { permission: "iam.tenant.read", context: { signature: "signed" } };
  const allow = await POST(makeRequest(body));
  expect(allow.status).toBe(200);
  expect(await allow.json()).toEqual({ allowed: true });
  const deny = await POST(makeRequest(body));
  expect(deny.status).toBe(403);
  expect(await deny.json()).toEqual({ allowed: false });
  expect(checkPermission).toHaveBeenCalledWith("auth0|synthetic-user", body.context, "iam.tenant.read");
});
