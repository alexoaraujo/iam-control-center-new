/**
 * Server-side Auth0 Management API reader for small/medium existing-user populations.
 * Credentials must be obtained via a least-privileged M2M client and never sent to browsers.
 * For >=1000 users, use an Auth0 export job and feed its parsed records to syncExistingUsers.
 */
import type { Auth0Identity } from "./identity-sync";

type UserResponse = {
  user_id?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
};

export async function* readExistingAuth0Users(
  domain: string,
  accessToken: string,
  fetcher: typeof fetch = fetch,
): AsyncGenerator<Auth0Identity> {
  if (!/^[a-z0-9.-]+$/i.test(domain) || domain.startsWith(".") || domain.endsWith(".")) {
    throw new Error("Invalid Auth0 domain");
  }
  if (!accessToken.trim()) throw new Error("Management API token is required");
  const perPage = 100;
  // Auth0 /users search pagination is capped at 1000 results.
  // Never silently treat the cap as a complete full-tenant import.
  for (let page = 0; page < 10; page++) {
    const url = `https://${domain}/api/v2/users?page=${page}&per_page=${perPage}&include_totals=false`;
    const response = await fetcher(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Auth0 Management API request failed (${response.status})`);
    const users: unknown = await response.json();
    if (!Array.isArray(users)) throw new Error("Invalid Auth0 users response");
    for (const item of users as UserResponse[]) {
      if (!item || typeof item.user_id !== "string") throw new Error("Missing Auth0 user_id");
      yield {
        sub: item.user_id,
        email: item.email,
        email_verified: item.email_verified,
        name: item.name,
      };
    }
    if (users.length < perPage) return;
  }
  throw new Error("Auth0 users pagination cap reached; use an export job for complete import");
}
