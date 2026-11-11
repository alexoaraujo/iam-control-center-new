import { getSql } from "./db";

/**
 * A permission decision is ALWAYS obtained using an already-authenticated
 * Auth0 subject plus a database-verified HMAC tenant-context proof.
 *
 * Browser-supplied tenant/identity IDs are selectors, NEVER authority.
 * The DB validates the signature and binds membership to Auth0 issuer/subject.
 * This module never queries as the owner/migrator, and never reads HMAC keys.
 */
export type SignedTenantProof = {
  tenantId: string;
  identityId: string;
  expires: number;
  nonce: string;
  signature: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const permissionPattern = /^iam\.[a-z_]+\.(read|update|manage|revoke)$/;
const signaturePattern = /^[0-9a-f]{64}$/i;
const expectedRuntime = "iam_app_runtime_login";

export function validProof(value: unknown): value is SignedTenantProof {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.tenantId === "string" && uuidPattern.test(v.tenantId)
    && typeof v.identityId === "string" && uuidPattern.test(v.identityId)
    && typeof v.expires === "number" && Number.isSafeInteger(v.expires)
    && v.expires > Math.floor(Date.now() / 1000) && v.expires <= Math.floor(Date.now() / 1000) + 300
    && typeof v.nonce === "string" && v.nonce.length >= 1 && v.nonce.length <= 128
    && typeof v.signature === "string" && signaturePattern.test(v.signature);
}

export function validPermission(value: unknown): value is string {
  return typeof value === "string" && permissionPattern.test(value) && value.length <= 80;
}

export async function checkPermission(subject: string, proof: SignedTenantProof, permission: string): Promise<boolean> {
  const authDomain = process.env.AUTH0_DOMAIN?.trim();
  if (!subject || subject.length > 512 || !validProof(proof) || !validPermission(permission)
      || process.env.DATABASE_RUNTIME_ROLE !== expectedRuntime || !authDomain
      || !/^[a-z0-9][a-z0-9.-]+$/i.test(authDomain)) return false;
  const issuer = `https://${authDomain}/`;

  try {
    const db = getSql();
    // Refuse an owner/migrator connection even if an environment variable was
    // accidentally set to the runtime role's name.
    const roles = await db.query(
      "SELECT current_user AS role, session_user AS login, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
      [],
      { fetchOptions: { signal: AbortSignal.timeout(3000), cache: "no-store" } },
    );
    const role = roles[0];
    if (!role || role.role !== expectedRuntime || role.login !== expectedRuntime
        || role.rolsuper !== false || role.rolbypassrls !== false) return false;

    // RLS evaluates STABLE functions and policy expressions against statement
    // snapshots. A single writable CTE does NOT establish a context reliably:
    // the signed context must be set in a separate statement of the SAME
    // non-interactive PostgreSQL transaction (Neon HTTP transaction API).
    const [, results] = await db.transaction((tx) => [
      tx`SELECT iam.set_tenant_context(
        ${proof.tenantId}::uuid, ${proof.identityId}::uuid,
        ${proof.expires}::bigint, ${proof.nonce}::text, ${proof.signature}::text
      )`,
      tx`SELECT EXISTS(
         SELECT 1
         FROM iam.identities i
         JOIN iam.memberships m ON m.identity_id=i.id
         WHERE i.id=${proof.identityId}::uuid
           AND i.issuer=${issuer}::text
           AND i.subject=${subject}::text
           AND m.tenant_id=${proof.tenantId}::uuid
           AND m.status='active'
           AND app_private.current_tenant_id()=${proof.tenantId}::uuid
           AND EXISTS (
             SELECT 1 FROM iam.effective_permissions(m.id) p
             WHERE p.permission_key=${permission}::text
           )
           -- Policy grammar is not yet frozen. An enabled ABAC policy denies
           -- ALL permissions rather than being silently ignored.
           AND NOT EXISTS(
             SELECT 1 FROM iam.access_policies ap
             WHERE ap.tenant_id=m.tenant_id AND ap.enabled
           )
       ) AS allowed`,
    ], { readOnly: true });
    return results.length === 1 && results[0]?.allowed === true;
  } catch {
    // Failed HMAC, expired context, wrong identity, missing schema or database
    // errors are all denials. Never leak SQL errors, credentials or signatures.
    return false;
  }
}
