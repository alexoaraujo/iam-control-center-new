/**
 * SERVER-SIDE PROTOTYPE ONLY.
 *
 * Issues the canonical short-lived tenant capability consumed by
 * app_private.current_tenant_id() in the SQL proposal. Callers must first
 * validate the OIDC session and resolve an active membership on the server.
 * Do not call from Client Components or expose the signing key to the browser.
 */

import { createHmac } from "node:crypto";

export const MAX_TENANT_CONTEXT_TTL_SECONDS = 120;

export type TenantContextClaims = Readonly<{
  keyId: string;
  tenantId: string;
  identityId: string;
  membershipId: string;
  expiresAtEpoch: number;
}>;

const KEY_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function canonicalUuid(value: string, fieldName: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new TypeError(`${fieldName} must be a canonical UUID`);
  }

  return value.toLowerCase();
}

/**
 * Signs a tenant context after the caller has already validated OIDC and
 * confirmed the selected tenant and active membership. The key must be a
 * server-side secret of at least 256 bits; production key provisioning,
 * rotation, and the OIDC/bootstrap call path remain separate review gates.
 */
export function issueTenantContextCapability(
  claims: TenantContextClaims,
  signingKey: Uint8Array,
): string {
  const nowEpochSeconds = Math.floor(Date.now() / 1000);

  if (!KEY_ID_PATTERN.test(claims.keyId)) {
    throw new TypeError("keyId must contain 1-64 letters, digits, underscores, or hyphens");
  }

  if (!(signingKey instanceof Uint8Array) || signingKey.byteLength < 32) {
    throw new TypeError("signingKey must contain at least 32 bytes");
  }

  if (!Number.isSafeInteger(nowEpochSeconds) || nowEpochSeconds < 0) {
    throw new TypeError("nowEpochSeconds must be a non-negative safe integer");
  }

  if (!Number.isSafeInteger(claims.expiresAtEpoch)) {
    throw new TypeError("expiresAtEpoch must be a safe integer");
  }

  if (
    claims.expiresAtEpoch <= nowEpochSeconds ||
    claims.expiresAtEpoch > nowEpochSeconds + MAX_TENANT_CONTEXT_TTL_SECONDS
  ) {
    throw new RangeError("tenant context expiration must be within the next 120 seconds");
  }

  const tenantId = canonicalUuid(claims.tenantId, "tenantId");
  const identityId = canonicalUuid(claims.identityId, "identityId");
  const membershipId = canonicalUuid(claims.membershipId, "membershipId");
  const payload = [
    claims.keyId,
    tenantId,
    identityId,
    membershipId,
    String(claims.expiresAtEpoch),
  ].join("|");

  const signature = createHmac("sha256", signingKey)
    .update(payload, "utf8")
    .digest("hex");

  return `${payload}|${signature}`;
}
