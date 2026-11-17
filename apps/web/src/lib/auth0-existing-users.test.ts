import { expect, it, vi } from "vitest";
import { readExistingAuth0Users } from "./auth0-existing-users";

// Next 16 extends the global fetch contract with a preconnect method.
// Preserve that exact surface instead of casting mocks to any or weakening
// the production fetcher type. The shim records real RequestInit arguments.
function mockFetch(response: Response) {
  return Object.assign(
    vi.fn(async (_request: RequestInfo | URL, _options?: RequestInit): Promise<Response> => response),
    { preconnect: (_url: string | URL): void => {} },
  );
}

it("streams existing Auth0 users with a server-only bearer token", async () => {
  const fetcher = mockFetch(new Response(
    JSON.stringify([{ user_id: "auth0|one", email: "one@example.test" }]),
    { status: 200, headers: { "Content-Type": "application/json" } },
  ));
  const records = [];
  for await (const user of readExistingAuth0Users("tenant.auth0.com", "test-token", fetcher)) records.push(user);
  expect(records).toEqual([{ sub: "auth0|one", email: "one@example.test", email_verified: undefined, name: undefined }]);
  expect(fetcher.mock.calls[0]?.[0]).toContain("page=0&per_page=100");
  expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe("Bearer test-token");
});
it("fails closed when the Management API rejects the request", async () => {
  const fetcher = mockFetch(new Response(null, { status: 403 }));
  const records = readExistingAuth0Users("tenant.auth0.com", "test-token", fetcher);
  await expect(records.next()).rejects.toThrow("403");
});
it("rejects untrusted Auth0 domains", async () => {
  const fetcher = mockFetch(new Response(null, { status: 200 }));
  const records = readExistingAuth0Users("https://evil.test/redirect", "token", fetcher);
  await expect(records.next()).rejects.toThrow("Invalid Auth0 domain");
  expect(fetcher).not.toHaveBeenCalled();
});
