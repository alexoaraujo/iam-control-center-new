import { beforeEach, expect, it, vi } from "vitest";
const { getSession, checkReadiness } = vi.hoisted(() => ({ getSession: vi.fn(), checkReadiness: vi.fn() }));
vi.mock("../../../lib/auth0", () => ({ auth0: { getSession } }));
vi.mock("../../../lib/readiness", () => ({ checkReadiness }));
import { GET } from "./route";
beforeEach(() => vi.resetAllMocks());
it("does not probe the database for anonymous callers", async () => {
  getSession.mockResolvedValue(null);
  const response = await GET();
  expect(response.status).toBe(401);
  expect(checkReadiness).not.toHaveBeenCalled();
});
for (const ready of [true, false]) {
  it(`returns uncached ${ready ? 200 : 503} for dependency status`, async () => {
    getSession.mockResolvedValue({ user: { sub: "test" } });
    checkReadiness.mockResolvedValue({ ready });
    const response = await GET();
    expect(response.status).toBe(ready ? 200 : 503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
}
