import { beforeEach, expect, it, vi } from "vitest";

const { getSession, checkPermission } = vi.hoisted(() => ({
  getSession: vi.fn(), checkPermission: vi.fn(),
}));
vi.mock("../../../../lib/auth0", () => ({ auth0: { getSession } }));
vi.mock("../../../../lib/authorization", () => ({
  validSelector: (value: unknown) => typeof value === "string" && /^[0-9a-f-]{36}$/.test(value),
  validPermission: (value: unknown) => value === "iam.tenant.read",
  checkPermission,
}));
import { POST } from "./route";

const selectors = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  identityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  permission: "iam.tenant.read",
};
const makeRequest = (body: unknown, contentType = "application/json") =>
  new Request("https://example.invalid/api/authorization/check", {
    method: "POST", headers: { "Content-Type": contentType }, body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.resetAllMocks();
  getSession.mockResolvedValue({ user: { sub: "auth0|synthetic-user" } });
});

it("401 without Auth0 session, and never reaches the RBAC evaluator", async () => {
  getSession.mockResolvedValue(null);
  const response = await POST(makeRequest(selectors));
  expect(response.status).toBe(401);
  expect(checkPermission).not.toHaveBeenCalled();
});

it("rejects browser-supplied HMAC, nonce, expiry, malformed selectors and content type", async () => {
  for (const [body, type] of [
    [{ ...selectors, signature: "a".repeat(64) }, "application/json"],
    [{ ...selectors, context: { signature: "a".repeat(64) } }, "application/json"],
    [{ ...selectors, nonce: "fake" }, "application/json"],
    [{ ...selectors, expires: 123 }, "application/json"],
    [{ ...selectors, permission: "iam.tenant.*" }, "application/json"],
    [{ ...selectors, tenantId: "evil" }, "application/json"],
    [{ identityId: selectors.identityId, permission: selectors.permission }, "application/json"],
    [selectors, "text/plain"],
  ] as const) {
    const response = await POST(makeRequest(body, type));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
  expect(checkPermission).not.toHaveBeenCalled();
});

it("uses only authenticated subject + selectors; returns boolean without leaking proof", async () => {
  checkPermission.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const allow = await POST(makeRequest(selectors));
  expect(allow.status).toBe(200);
  expect(await allow.json()).toEqual({ allowed: true });
  const deny = await POST(makeRequest(selectors));
  expect(deny.status).toBe(403);
  expect(await deny.json()).toEqual({ allowed: false });
  expect(checkPermission).toHaveBeenCalledWith(
    "auth0|synthetic-user", selectors.tenantId, selectors.identityId, selectors.permission,
  );
});

it("rejects oversized streams even without a trusted Content-Length, without evaluating RBAC", async () => {
  const overLimit = new Request("https://example.invalid/api/authorization/check", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": "0" },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ ...selectors, padding: "x".repeat(5000) })));
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  const response = await POST(overLimit);
  expect(response.status).toBe(403);
  expect(checkPermission).not.toHaveBeenCalled();
});

it("denies malformed UTF-8 and invalid content-length before authorization", async () => {
  const invalidUtf8 = new Request("https://example.invalid/api/authorization/check", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: new Uint8Array([0xc3, 0x28]),
  });
  expect((await POST(invalidUtf8)).status).toBe(403);
  const badLength = new Request("https://example.invalid/api/authorization/check", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": "-1" },
    body: JSON.stringify(selectors),
  });
  expect((await POST(badLength)).status).toBe(403);
  expect(checkPermission).not.toHaveBeenCalled();
});

it("accepts valid streamed JSON split across chunks without trusting headers", async () => {
  const chunks = [JSON.stringify(selectors).slice(0, 30), JSON.stringify(selectors).slice(30)];
  const request = new Request("https://example.invalid/api/authorization/check", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  checkPermission.mockResolvedValue(true);
  const response = await POST(request);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ allowed: true });
  expect(checkPermission).toHaveBeenCalledTimes(1);
});
