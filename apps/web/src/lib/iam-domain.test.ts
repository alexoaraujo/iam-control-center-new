import { describe, expect, it } from "vitest";
import {
  evaluateAuthorization,
  type AuthorizationInput,
} from "./iam-domain";

const allowedInput: AuthorizationInput = {
  principal: { id: "principal-1", status: "active" },
  tenant: { id: "tenant-1", status: "active" },
  membership: {
    id: "membership-1",
    tenantId: "tenant-1",
    principalId: "principal-1",
    status: "active",
  },
  requestedTenantId: "tenant-1",
  resourceTenantId: "tenant-1",
  requiredPermission: "tenant.read",
  grants: [
    {
      tenantId: "tenant-1",
      membershipId: "membership-1",
      permissionKey: "tenant.read",
    },
  ],
};

describe("evaluateAuthorization", () => {
  it("allows an active principal and membership with a tenant-scoped grant", () => {
    expect(evaluateAuthorization(allowedInput)).toEqual({ outcome: "allow" });
  });

  it.each([
    ["suspended principal", { principal: { id: "principal-1", status: "suspended" as const } }, "principal_inactive"],
    ["deleted principal", { principal: { id: "principal-1", status: "deleted" as const } }, "principal_inactive"],
    ["suspended tenant", { tenant: { id: "tenant-1", status: "suspended" as const } }, "tenant_inactive"],
    ["deleted tenant", { tenant: { id: "tenant-1", status: "deleted" as const } }, "tenant_inactive"],
    ["invited membership", { membership: { ...allowedInput.membership, status: "invited" as const } }, "membership_inactive"],
    ["suspended membership", { membership: { ...allowedInput.membership, status: "suspended" as const } }, "membership_inactive"],
    ["revoked membership", { membership: { ...allowedInput.membership, status: "revoked" as const } }, "membership_inactive"],
    ["membership for another principal", { membership: { ...allowedInput.membership, principalId: "principal-2" } }, "membership_mismatch"],
    ["request for another tenant", { requestedTenantId: "tenant-2" }, "tenant_scope_mismatch"],
    ["resource belonging to another tenant", { resourceTenantId: "tenant-2" }, "tenant_scope_mismatch"],
    ["missing permission", { grants: [] }, "permission_not_granted"],
    ["grant for another tenant", { grants: [{ ...allowedInput.grants[0], tenantId: "tenant-2" }] }, "permission_not_granted"],
    ["grant for another membership", { grants: [{ ...allowedInput.grants[0], membershipId: "membership-2" }] }, "permission_not_granted"],
    ["revoked grant", { grants: [{ ...allowedInput.grants[0], revokedAt: "2026-10-24T00:00:00Z" }] }, "permission_not_granted"],
  ] as const)("denies by default for %s", (_label, override, reason) => {
    const input = { ...allowedInput, ...override } as AuthorizationInput;
    expect(evaluateAuthorization(input)).toEqual({ outcome: "deny", reason });
  });

  it("denies an unsupported permission even when a matching grant exists", () => {
    const input: AuthorizationInput = {
      ...allowedInput,
      requiredPermission: "tenant.admin",
      grants: [
        {
          tenantId: "tenant-1",
          membershipId: "membership-1",
          permissionKey: "tenant.admin",
        },
      ],
    };

    expect(evaluateAuthorization(input)).toEqual({
      outcome: "deny",
      reason: "permission_not_granted",
    });
  });

  it("does not treat an email or provider metadata as a grant", () => {
    const input = { ...allowedInput, grants: [] };
    expect(evaluateAuthorization(input)).toEqual({
      outcome: "deny",
      reason: "permission_not_granted",
    });
  });
});
