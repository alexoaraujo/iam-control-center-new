import { describe, expect, it, vi } from "vitest";
import { importExistingAuth0Users } from "./auth0-existing-users-import";

const domain = "iam-control-center.us.auth0.com";
const expectedIssuer = "https://iam-control-center.us.auth0.com/";

function source(users: Array<{user_id: string; email?: string; email_verified?: boolean}>) {
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => users,
  });
  return fetcher as unknown as typeof fetch;
}

const fixtures = [
  { user_id: "auth0|existing-one", email: "one@example.test", email_verified: true },
  { user_id: "google-oauth2|existing-two", email: "two@example.test" },
];

describe("reviewed Auth0 existing-user backfill", () => {
  it("defaults to a read-only, PII-free dry-run with zero SQL writes", async () => {
    const result = await importExistingAuth0Users({
      domain, expectedIssuer, accessToken: "synthetic-token", fetcher: source(fixtures),
    });
    expect(result).toEqual({
      mode: "dry-run", scanned: 2, written: 0,
      sourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(result)).not.toContain("one@example.test");
    expect(JSON.stringify(result)).not.toContain("auth0|existing-one");
  });

  it("requires explicit independent approval and exact disposable branch binding", async () => {
    const opts = { domain, expectedIssuer, accessToken: "synthetic-token", fetcher: source(fixtures) };
    const dry = await importExistingAuth0Users(opts);
    const sql = { query: vi.fn().mockResolvedValue([
      { id: "id-1", issuer: expectedIssuer, subject: "auth0|existing-one" },
    ]) };
    await expect(importExistingAuth0Users({
      ...opts, mode: "apply", sql, targetBranchId: "br-disposable",
      expectedCount: dry.scanned, expectedFingerprint: dry.sourceFingerprint,
    })).rejects.toThrow("not approved");
    expect(sql.query).not.toHaveBeenCalled();

    const result = await importExistingAuth0Users({
      ...opts, mode: "apply", sql, approval: "reviewed-preview-import",
      targetBranchId: "br-disposable", approvedBranchId: "br-disposable",
      expectedCount: dry.scanned, expectedFingerprint: dry.sourceFingerprint,
    });
    expect(result).toMatchObject({ mode: "apply", scanned: 2, written: 2 });
    expect(sql.query).toHaveBeenCalledTimes(2);
    for (const [statement, params] of sql.query.mock.calls) {
      expect(statement).toContain("iam.sync_auth0_identity");
      expect(params[5]).toBe(false); // Import must not manufacture login events.
    }
  });

  it("refuses changed populations before any database mutations", async () => {
    const dry = await importExistingAuth0Users({
      domain, expectedIssuer, accessToken: "synthetic-token", fetcher: source(fixtures),
    });
    const sql = { query: vi.fn() };
    await expect(importExistingAuth0Users({
      domain, expectedIssuer, accessToken: "synthetic-token",
      fetcher: source([{user_id:"auth0|different"}]),
      mode: "apply", sql, approval: "reviewed-preview-import",
      targetBranchId: "br-disposable", approvedBranchId: "br-disposable",
      expectedCount: dry.scanned, expectedFingerprint: dry.sourceFingerprint,
    })).rejects.toThrow("source changed");
    expect(sql.query).not.toHaveBeenCalled();
  });

  it("rejects changed user attributes even if the subject set matches", async () => {
    const opts = { domain, expectedIssuer, accessToken: "synthetic-token" };
    const dry = await importExistingAuth0Users({ ...opts, fetcher: source(fixtures) });
    const sql = { query: vi.fn() };
    await expect(importExistingAuth0Users({
      ...opts,
      fetcher: source([
        { user_id: "auth0|existing-one", email: "changed@example.test", email_verified: true },
        fixtures[1],
      ]),
      mode: "apply", sql, approval: "reviewed-preview-import",
      targetBranchId: "br-disposable", approvedBranchId: "br-disposable",
      expectedCount: dry.scanned, expectedFingerprint: dry.sourceFingerprint,
    })).rejects.toThrow("source changed");
    expect(sql.query).not.toHaveBeenCalled();
  });

  it("rejects duplicated Auth0 subjects without writing", async () => {
    const sql = { query: vi.fn() };
    await expect(importExistingAuth0Users({
      domain, expectedIssuer, accessToken: "synthetic-token",
      fetcher: source([{user_id:"auth0|one"},{user_id:"auth0|one"}]),
      mode: "dry-run", sql,
    })).rejects.toThrow("duplicate");
    expect(sql.query).not.toHaveBeenCalled();
  });

  it("fails closed on wrong issuer and excess population before writing", async () => {
    const sql = { query: vi.fn() };
    await expect(importExistingAuth0Users({
      domain, expectedIssuer: "https://different-tenant.example/",
      accessToken: "synthetic-token", fetcher: source(fixtures), sql,
    })).rejects.toThrow("issuer mismatch");
    await expect(importExistingAuth0Users({
      domain, expectedIssuer, accessToken: "synthetic-token",
      fetcher: source(fixtures), maxUsers: 1, sql,
    })).rejects.toThrow("exceeds reviewed import limit");
    expect(sql.query).not.toHaveBeenCalled();
  });

  it("does not suppress Management API errors", async () => {
    const fetcher = vi.fn().mockResolvedValue({ok:false,status:429});
    await expect(importExistingAuth0Users({
      domain, expectedIssuer, accessToken:"synthetic-token",
      fetcher: fetcher as unknown as typeof fetch,
    })).rejects.toThrow("429");
  });

  it("stops on first write failure rather than reporting a successful import", async () => {
    const opts={domain,expectedIssuer,accessToken:"synthetic-token",fetcher:source(fixtures)};
    const dry=await importExistingAuth0Users(opts);
    const sql={query:vi.fn().mockRejectedValue(new Error("RLS denied"))};
    await expect(importExistingAuth0Users({
      ...opts,mode:"apply",sql,approval:"reviewed-preview-import",
      targetBranchId:"br-disposable",approvedBranchId:"br-disposable",
      expectedCount:dry.scanned,expectedFingerprint:dry.sourceFingerprint,
    })).rejects.toThrow("RLS denied");
    expect(sql.query).toHaveBeenCalledTimes(1);
  });
});
