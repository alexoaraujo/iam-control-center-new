import { describe, expect, it, vi } from "vitest";
import { getAuth0ReadUsersToken } from "./auth0-management-token";

describe("least-privilege Auth0 Management API token request", () => {
  it("requests read:users only, against the configured issuer, without browser credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({
        access_token: "synthetic-token", token_type: "Bearer", scope: "read:users",
      }),
    });
    const token = await getAuth0ReadUsersToken(
      "iam-control-center.us.auth0.com", "synthetic-client", "synthetic-secret",
      fetcher as unknown as typeof fetch,
    );
    expect(token).toBe("synthetic-token");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, params] = fetcher.mock.calls[0];
    expect(url).toBe("https://iam-control-center.us.auth0.com/oauth/token");
    const body = JSON.parse(params.body);
    expect(body).toMatchObject({
      audience: "https://iam-control-center.us.auth0.com/api/v2/",
      grant_type: "client_credentials", scope: "read:users",
    });
    expect(params.method).toBe("POST");
    expect(params.cache).toBe("no-store");
  });

  it("rejects missing credentials, bad domains, invalid bearer type and inadequate scope", async () => {
    const fetcher = vi.fn();
    await expect(getAuth0ReadUsersToken("tenant.auth0.com", "", "secret", fetcher as unknown as typeof fetch)).rejects.toThrow("missing");
    await expect(getAuth0ReadUsersToken("https://invalid.example/", "id", "secret", fetcher as unknown as typeof fetch)).rejects.toThrow("Invalid");
    const response = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({
        access_token: "token", token_type: "Bearer", scope: "read:clients",
      }),
    });
    await expect(getAuth0ReadUsersToken("tenant.auth0.com","id","secret",response as unknown as typeof fetch)).rejects.toThrow("read:users");
    response.mockResolvedValue({ok:true,json:async()=>({access_token:"token",token_type:"mac"})});
    await expect(getAuth0ReadUsersToken("tenant.auth0.com","id","secret",response as unknown as typeof fetch)).rejects.toThrow("Invalid");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not include token endpoint error body or credentials in exceptions", async () => {
    const fetcher=vi.fn().mockResolvedValue({
      ok:false,status:401,json:async()=>({secret:"do-not-emit"}),
    });
    await expect(getAuth0ReadUsersToken(
      "tenant.auth0.com","id","secret",fetcher as unknown as typeof fetch,
    )).rejects.toThrow("token request failed (401)");
  });
});
