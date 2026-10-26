import { describe, expect, it } from "vitest";
import {
  effectivePermissions,
  hasPermission,
  type ActiveMembershipContext,
  type RoleGrant,
} from "./rbac";

const tenantA: ActiveMembershipContext = {
  identity: { issuer: "https://issuer.example/", subject: "subject-a" },
  tenantId: "tenant-a",
  membershipId: "membership-a",
  active: true,
};

const grants: readonly RoleGrant[] = [
  {
    tenantId: "tenant-a",
    membershipId: "membership-a",
    roleId: "role-admin-a",
    permissionKeys: ["iam.control_center.read", "iam.membership.manage"],
  },
  {
    tenantId: "tenant-b",
    membershipId: "membership-b",
    roleId: "role-admin-b",
    permissionKeys: ["iam.control_center.read", "iam.production.deploy"],
  },
];

describe("tenant-scoped RBAC contract", () => {
  it("returns only permission keys for the active membership in the selected tenant", () => {
    expect(effectivePermissions(tenantA, grants)).toEqual([
      "iam.control_center.read",
      "iam.membership.manage",
    ]);
  });

  it("denies when the context is missing or the membership is inactive", () => {
    expect(effectivePermissions(null, grants)).toEqual([]);
    expect(
      effectivePermissions({ ...tenantA, active: false }, grants),
    ).toEqual([]);
  });

  it("does not accept grants from another tenant or membership", () => {
    expect(
      hasPermission(tenantA, grants, "iam.production.deploy"),
    ).toBe(false);
    expect(
      hasPermission(
        { ...tenantA, membershipId: "different-membership" },
        grants,
        "iam.membership.manage",
      ),
    ).toBe(false);
  });

  it("denies unknown or empty permission keys", () => {
    expect(hasPermission(tenantA, grants, "iam.unknown")).toBe(false);
    expect(hasPermission(tenantA, grants, "  ")).toBe(false);
  });

  it("deduplicates permission keys from multiple roles", () => {
    const extraGrant: RoleGrant = {
      tenantId: "tenant-a",
      membershipId: "membership-a",
      roleId: "role-reader-a",
      permissionKeys: ["iam.control_center.read"],
    };

    expect(effectivePermissions(tenantA, [...grants, extraGrant])).toEqual([
      "iam.control_center.read",
      "iam.membership.manage",
    ]);
  });
});
