import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  issueTenantContextCapability,
  MAX_TENANT_CONTEXT_TTL_SECONDS,
  type TenantContextClaims,
} from "./tenant-context";

const NOW = 1_800_000_000;
const TENANT_A = "00000000-0000-0000-0000-000000000001";
const IDENTITY_A = "00000000-0000-0000-0000-000000000101";
const MEMBERSHIP_A = "00000000-0000-0000-0000-000000000201";
const KEY = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW * 1000));
});

afterEach(() => {
  vi.useRealTimers();
});

const claims: TenantContextClaims = {
  keyId: "test-v1",
  tenantId: TENANT_A,
  identityId: IDENTITY_A,
  membershipId: MEMBERSHIP_A,
  expiresAtEpoch: NOW + 60,
};

describe("signed tenant context capability", () => {
  it("produces the SQL verifier's canonical payload and HMAC-SHA-256", () => {
    const token = issueTenantContextCapability(claims, KEY);
    const payload = [
      "test-v1",
      TENANT_A,
      IDENTITY_A,
      MEMBERSHIP_A,
      String(NOW + 60),
    ].join("|");
    const expectedSignature = createHmac("sha256", KEY)
      .update(payload, "utf8")
      .digest("hex");

    expect(token).toBe(payload + "|" + expectedSignature);
    expect(token.split("|")).toHaveLength(6);
  });

  it("canonicalizes UUID casing before signing", () => {
    const token = issueTenantContextCapability(
      {
        ...claims,
        tenantId: TENANT_A.toUpperCase(),
        identityId: IDENTITY_A.toUpperCase(),
        membershipId: MEMBERSHIP_A.toUpperCase(),
      },
      KEY,
    );

    expect(token.split("|").slice(0, 5)).toEqual([
      "test-v1",
      TENANT_A,
      IDENTITY_A,
      MEMBERSHIP_A,
      String(NOW + 60),
    ]);
  });

  it("accepts the maximum allowed TTL", () => {
    expect(() =>
      issueTenantContextCapability(
        { ...claims, expiresAtEpoch: NOW + MAX_TENANT_CONTEXT_TTL_SECONDS },
        KEY,
      ),
    ).not.toThrow();
  });

  it("rejects expired or overlong capabilities", () => {
    expect(() =>
      issueTenantContextCapability({ ...claims, expiresAtEpoch: NOW }, KEY),
    ).toThrow(RangeError);

    expect(() =>
      issueTenantContextCapability(
        { ...claims, expiresAtEpoch: NOW + MAX_TENANT_CONTEXT_TTL_SECONDS + 1 },
        KEY,
      ),
    ).toThrow(RangeError);
  });

  it("rejects keys shorter than 256 bits", () => {
    expect(() =>
      issueTenantContextCapability(claims, Buffer.alloc(31, 1)),
    ).toThrow(/at least 32 bytes/);
  });

  it("rejects invalid key identifiers", () => {
    expect(() =>
      issueTenantContextCapability({ ...claims, keyId: "invalid|key" }, KEY),
    ).toThrow(/keyId/);
    expect(() =>
      issueTenantContextCapability({ ...claims, keyId: "" }, KEY),
    ).toThrow(/keyId/);
  });

  it("rejects non-UUID tenant, identity, or membership identifiers", () => {
    expect(() =>
      issueTenantContextCapability({ ...claims, tenantId: "tenant-a" }, KEY),
    ).toThrow(/tenantId/);
    expect(() =>
      issueTenantContextCapability({ ...claims, identityId: "identity-a" }, KEY),
    ).toThrow(/identityId/);
    expect(() =>
      issueTenantContextCapability({ ...claims, membershipId: "membership-a" }, KEY),
    ).toThrow(/membershipId/);
  });

  it("rejects non-safe integer timestamps", () => {
    expect(() =>
      issueTenantContextCapability({ ...claims, expiresAtEpoch: Number.NaN }, KEY),
    ).toThrow(/safe integer/);
    expect(() =>
      issueTenantContextCapability(
        { ...claims, expiresAtEpoch: Number.POSITIVE_INFINITY },
        KEY,
      ),
    ).toThrow(/safe integer/);
  });
});
