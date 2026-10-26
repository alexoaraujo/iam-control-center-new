/**
 * Pure domain contract for tenant-scoped RBAC.
 *
 * This module accepts already-resolved, trusted server-side context. It does
 * not validate OIDC claims, query the database, or replace PostgreSQL RLS.
 */

export type IdentityKey = Readonly<{
  issuer: string;
  subject: string;
}>;

export type ActiveMembershipContext = Readonly<{
  identity: IdentityKey;
  tenantId: string;
  membershipId: string;
  active: boolean;
}>;

export type RoleGrant = Readonly<{
  tenantId: string;
  membershipId: string;
  roleId: string;
  permissionKeys: readonly string[];
}>;

export function effectivePermissions(
  context: ActiveMembershipContext | null,
  grants: readonly RoleGrant[],
): readonly string[] {
  if (
    context === null ||
    !context.active ||
    context.tenantId.trim() === "" ||
    context.membershipId.trim() === ""
  ) {
    return [];
  }

  const permissions = new Set<string>();

  for (const grant of grants) {
    if (
      grant.tenantId !== context.tenantId ||
      grant.membershipId !== context.membershipId ||
      grant.roleId.trim() === ""
    ) {
      continue;
    }

    for (const permissionKey of grant.permissionKeys) {
      if (permissionKey.trim() !== "") {
        permissions.add(permissionKey);
      }
    }
  }

  return [...permissions].sort();
}

export function hasPermission(
  context: ActiveMembershipContext | null,
  grants: readonly RoleGrant[],
  permissionKey: string,
): boolean {
  if (permissionKey.trim() === "") {
    return false;
  }

  return effectivePermissions(context, grants).includes(permissionKey);
}
