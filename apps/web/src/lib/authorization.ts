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

    // One SQL statement: the signed context is LOCAL to this query's transaction.
    // Materialized CTE enforces evaluation before reading the RLS-protected rows.
    // Unknown enabled access_policies cause deny until a separately reviewed
    // rule grammar/evaluator supports them. Role and group grants never bypass
    // an enabled policy by accident.
    const results = await db.query(
      `WITH signed_context AS MATERIALIZED (
         SELECT iam.set_tenant_context($1::uuid, $2::uuid, $3::bigint, $4::text, $5::text) AS proof
       ),
       checked_identity AS MATERIALIZED (
         SELECT m.id AS membership_id
         FROM signed_context c
         JOIN iam.identities i ON i.id=$2::uuid AND i.issuer=$6::text AND i.subject=$7::text
         JOIN iam.memberships m ON m.identity_id=i.id AND m.tenant_id=$1::uuid
         WHERE m.status='active' AND app_private.current_tenant_id()=$1::uuid
       )
       SELECT EXISTS(
         SELECT 1 FROM checked_identity m
         WHERE EXISTS(
           SELECT 1 FROM iam.effective_permissions(m.membership_id) p
           WHERE p.permission_key=$8::text
         )
         AND NOT EXISTS(
           SELECT 1 FROM iam.access_policies ap
           WHERE ap.tenant_id=$1::uuid AND ap.enabled
         )
       ) AS allowed`,
      [proof.tenantId, proof.identityId, proof.expires, proof.nonce, proof.signature, issuer, subject, permission],
      { fetchOptions: { signal: AbortSignal.timeout(3000), cache: "no-store" } },
    );
    return results.length === 1 && results[0]?.allowed === true;
  } catch {
    // Failed HMAC, expired context, wrong identity, missing schema or database
    // errors are all denials. Never leak SQL errors, credentials or signatures.
    return false;
  }
}
