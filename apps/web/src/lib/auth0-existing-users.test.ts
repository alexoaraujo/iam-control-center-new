import { expect, it, vi } from "vitest";
import { readExistingAuth0Users } from "./auth0-existing-users";

it("streams existing Auth0 users with a server-only bearer token", async () => {
  const fetcher = vi.fn().mockResolvedValue({
    ok: true, json: async () => [{ user_id: "auth0|one", email: "one@example.test" }],
  });
  const records = [];
  for await (const user of readExistingAuth0Users("tenant.auth0.com", "test-token", fetcher)) records.push(user);
  expect(records).toEqual([{ sub: "auth0|one", email: "one@example.test", email_verified: undefined, name: undefined }]);
  expect(fetcher.mock.calls[0][0]).toContain("page=0&per_page=100");
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer test-token");
});
it("fails closed when the Management API rejects the request", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 403 });
  const records = readExistingAuth0Users("tenant.auth0.com", "test-token", fetcher);
  await expect(records.next()).rejects.toThrow("403");
});
it("rejects untrusted Auth0 domains", async () => {
  const records = readExistingAuth0Users("https://evil.test/redirect", "token", vi.fn());
  await expect(records.next()).rejects.toThrow("Invalid Auth0 domain");
});
