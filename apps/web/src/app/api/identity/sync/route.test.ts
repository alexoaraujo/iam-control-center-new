import { beforeEach, expect, it, vi } from "vitest";
const { getSession, syncAuthenticatedIdentity } = vi.hoisted(() => ({
  getSession: vi.fn(),
  syncAuthenticatedIdentity: vi.fn(),
}));
vi.mock("../../../../lib/auth0", () => ({ auth0: { getSession } }));
vi.mock("../../../../lib/identity-sync-db", () => ({ syncAuthenticatedIdentity }));
import { POST } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.AUTH0_NEON_SYNC_ENABLED;
});

it("returns 401 and does not touch Neon without a session", async () => {
  getSession.mockResolvedValue(null);
  expect((await POST()).status).toBe(401);
  expect(syncAuthenticatedIdentity).not.toHaveBeenCalled();
});
it("defaults to 503 without an approved rollout flag", async () => {
  getSession.mockResolvedValue({ user: { sub: "auth0|1" } });
  expect((await POST()).status).toBe(503);
  expect(syncAuthenticatedIdentity).not.toHaveBeenCalled();
});
it("takes the subject from the verified server session", async () => {
  process.env.AUTH0_NEON_SYNC_ENABLED = "true";
  getSession.mockResolvedValue({ user: { sub: "auth0|1", email: "user@example.com" } });
  syncAuthenticatedIdentity.mockResolvedValue({ id: "id-1" });
  const response = await POST();
  expect(response.status).toBe(200);
  expect(syncAuthenticatedIdentity).toHaveBeenCalledWith({ sub: "auth0|1", email: "user@example.com" });
});
it("does not disclose database errors", async () => {
  process.env.AUTH0_NEON_SYNC_ENABLED = "true";
  getSession.mockResolvedValue({ user: { sub: "auth0|1" } });
  syncAuthenticatedIdentity.mockRejectedValue(new Error("secret connection detail"));
  const response = await POST();
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("secret connection detail");
});
