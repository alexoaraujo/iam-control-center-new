import { describe, expect, it, vi } from "vitest";
import {
  canonicalIssuer, normalizeIdentity, syncIdentity, syncExistingUsers,
  type Auth0Identity,
} from "./identity-sync";

const issuer = "https://iam-control-center.us.auth0.com/";

describe("Auth0 identity synchronization", () => {
  it("normalizes the configured Auth0 issuer", () => {
    expect(canonicalIssuer("IAM-control-center.US.auth0.com")).toBe(issuer);
    expect(() => canonicalIssuer("https://attacker.example/")).toThrow();
    expect(() => canonicalIssuer("example.com/path")).toThrow();
  });
  it("rejects malformed subjects", () => {
    expect(() => normalizeIdentity({ sub: "" })).toThrow();
    expect(() => normalizeIdentity({ sub: "x".repeat(256) })).toThrow();
  });
  it("upserts by issuer and subject, using only parameterized profile fields", async () => {
    const query = vi.fn().mockResolvedValue([{ id: "test-id", issuer, subject: "auth0|123" }]);
    const profile = { sub: "auth0|123", email: " user@example.com ", name: "Test User", email_verified: true };
    await syncIdentity({ query }, issuer, profile);
    const [statement, params] = query.mock.calls[0];
    expect(statement).toContain("ON CONFLICT (issuer, subject)");
    expect(statement).not.toContain("membership");
    expect(statement).not.toContain("role");
    expect(params).toEqual([issuer, "auth0|123", "user@example.com", true, "Test User", true, true]);
    expect(statement).toContain("COALESCE(EXCLUDED.email");
    expect(statement).toContain("last_authenticated_at = CASE WHEN $6");
  });
  it("synchronizes existing users one at a time without duplicating memberships", async () => {
    const query = vi.fn().mockResolvedValue([{ id: "test-id", issuer, subject: "auth0|123" }]);
    async function* existing(): AsyncIterable<Auth0Identity> {
      yield { sub: "auth0|123" };
      yield { sub: "google-oauth2|456" };
    }
    expect(await syncExistingUsers({ query }, issuer, existing())).toBe(2);
    expect(query).toHaveBeenCalledTimes(2);
    for (const [, params] of query.mock.calls) {
      expect(params[5]).toBe(false); // An import is not an authenticated login.
      expect(params[6]).toBe(false); // Missing verification is not a false verification claim.
    }
  });
  it("stops at the first error so failures cannot be reported as imported", async () => {
    const query = vi.fn().mockRejectedValue(new Error("RLS denied"));
    async function* existing(): AsyncIterable<Auth0Identity> { yield { sub: "auth0|123" }; }
    await expect(syncExistingUsers({ query }, issuer, existing())).rejects.toThrow("RLS denied");
  });
});
