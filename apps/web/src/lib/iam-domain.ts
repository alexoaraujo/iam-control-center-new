/**
 * Provider-independent IAM domain contracts.
 *
 * These types model local application authorization state only. They do not
 * validate OIDC tokens/sessions, authenticate callers, or replace database RLS.
 */

export type PrincipalId = string;
export type TenantId = string;
export type MembershipId = string;
export type PermissionKey = string;

export interface ExternalIdentityKey {
  /** Exact issuer value from a successfully validated OIDC identity. */
  readonly issuer: string;
  /** Opaque, case-sensitive subject from a successfully validated identity. */
  readonly subject: string;
}

export type PrincipalStatus = "active" | "suspended" | "deleted";
export type TenantStatus = "active" | "suspended" | "deleted";
export type MembershipStatus = "invited" | "active" | "suspended" | "revoked";

export interface Principal {
  readonly id: PrincipalId;
  readonly status: PrincipalStatus;
}

export interface Tenant {
  readonly id: TenantId;
  readonly status: TenantStatus;
}

export interface Membership {
  readonly id: MembershipId;
  readonly tenantId: TenantId;
  readonly principalId: PrincipalId;
  readonly status: MembershipStatus;
}

export interface MembershipPermission {
  readonly tenantId: TenantId;
  readonly membershipId: MembershipId;
  readonly permissionKey: PermissionKey;
  /** Null/absent means not revoked; timestamps are ISO-8601 UTC strings. */
  readonly revokedAt?: string | null;
}

export type AuthorizationDenyReason =
  | "principal_inactive"
  | "tenant_inactive"
  | "membership_inactive"
  | "membership_mismatch"
  | "tenant_scope_mismatch"
  | "permission_not_granted";

export type AuthorizationDecision =
  | { readonly outcome: "allow" }
  | {
      readonly outcome: "deny";
      readonly reason: AuthorizationDenyReason;
    };

export interface AuthorizationInput {
  readonly principal: Principal;
  readonly tenant: Tenant;
  readonly membership: Membership;
  readonly requestedTenantId: TenantId;
  readonly resourceTenantId: TenantId;
  readonly requiredPermission: PermissionKey;
  readonly grants: readonly MembershipPermission[];
}

/**
 * Evaluates local authorization facts after authentication has succeeded.
 * Default deny; callers must still enforce tenant isolation in the database.
 */
export function evaluateAuthorization(
  input: AuthorizationInput,
): AuthorizationDecision {
  const {
    principal,
    tenant,
    membership,
    requestedTenantId,
    resourceTenantId,
    requiredPermission,
    grants,
  } = input;

  if (principal.status !== "active") {
    return { outcome: "deny", reason: "principal_inactive" };
  }

  if (tenant.status !== "active") {
    return { outcome: "deny", reason: "tenant_inactive" };
  }

  if (membership.status !== "active") {
    return { outcome: "deny", reason: "membership_inactive" };
  }

  if (
    membership.principalId !== principal.id ||
    membership.tenantId !== tenant.id
  ) {
    return { outcome: "deny", reason: "membership_mismatch" };
  }

  if (
    requestedTenantId !== tenant.id ||
    resourceTenantId !== tenant.id
  ) {
    return { outcome: "deny", reason: "tenant_scope_mismatch" };
  }

  const hasGrant = grants.some(
    (grant) =>
      grant.tenantId === tenant.id &&
      grant.membershipId === membership.id &&
      grant.permissionKey === requiredPermission &&
      (grant.revokedAt === undefined || grant.revokedAt === null),
  );

  if (!hasGrant) {
    return { outcome: "deny", reason: "permission_not_granted" };
  }

  return { outcome: "allow" };
}
