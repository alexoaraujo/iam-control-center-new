import { canonicalIssuer } from "./identity-sync";

/**
 * Obtains a short-lived least-privileged Management API token server-side.
 * Never log the token, M2M secret, request body, or provider error body.
 * Auth0's M2M app must be explicitly granted read:users beforehand.
 */
export async function getAuth0ReadUsersToken(
  domain: string,
  clientId: string,
  clientSecret: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const issuer = canonicalIssuer(domain);
  if (!clientId?.trim() || !clientSecret?.trim()) {
    throw new Error("Auth0 Management M2M credentials are missing");
  }
  const response = await fetcher(`${issuer}oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      audience: `${issuer}api/v2/`,
      scope: "read:users",
    }),
  });
  if (!response.ok) throw new Error(`Auth0 Management token request failed (${response.status})`);
  const result: unknown = await response.json();
  if (!result || typeof result !== "object") throw new Error("Invalid Auth0 token response");
  const data = result as { access_token?: unknown; token_type?: unknown; scope?: unknown };
  if (typeof data.access_token !== "string" || !data.access_token.trim() ||
      data.token_type !== "Bearer") {
    throw new Error("Invalid Auth0 token response");
  }
  // Fail closed when provider declares an inadequate scope.
  if (typeof data.scope === "string" && !data.scope.split(/\s+/).includes("read:users")) {
    throw new Error("Auth0 token missing read:users permission");
  }
  return data.access_token;
}
