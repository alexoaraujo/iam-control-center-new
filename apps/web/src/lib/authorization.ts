import { createHmac, randomBytes } from "node:crypto";
import { getSql } from "./db";

/**
 * Server-side only: a verified Auth0 session drives all permission checks.
 * Client tenant/identity IDs are untrusted selectors. The proof never leaves
 * this module, and PostgreSQL binds the signed context to issuer+subject.
 *
 * The signing key is a protected deployment secret, matching the one active
 * app_private.context_keys entry in the TARGET Neon branch. Never query keys
 * through the app runtime role, expose proofs, or use a Production key in Preview.
 */
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const permissionPattern = /^iam\.[a-z_]+\.(read|update|manage|revoke)$/;
const expectedRuntime = "iam_app_runtime_login";

export function validSelector(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

export function validPermission(value: unknown): value is string {
  return typeof value === "string" && permissionPattern.test(value) && value.length <= 80;
}

function signTenantContext(tenantId: string, identityId: string) {
  const secret = process.env.AUTHZ_CONTEXT_SIGNING_KEY_HEX;
  if (typeof secret !== "string" || !/^[a-f0-9]{64}$/i.test(secret)) return null;
  const expires = Math.floor(Date.now() / 1000) + 60;
  const nonce = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", Buffer.from(secret, "hex"))
    .update(`${tenantId}|${identityId}|${expires}|${nonce}`, "utf8")
    .digest("hex");
  return { expires, nonce, signature };
}

/**
 * Fail-closed authorization; never an authentication/session issuance API.
 * No browser-supplied HMAC or expiry is accepted. Every call gets a fresh
 * server-only, short-lived nonce/signature, and nothing is cached or returned.
 *
 * No RBAC grant may override an unknown enabled ABAC policy: deny by default.
 */
export async function checkPermission(
  subject: string, tenantId: string, identityId: string, permission: string,
): Promise<boolean> {
  const authDomain = process.env.AUTH0_DOMAIN?.trim();
  if (!subject || subject.length > 512 || !validSelector(tenantId) || !validSelector(identityId)
    || !validPermission(permission) || process.env.DATABASE_RUNTIME_ROLE !== expectedRuntime
    || !authDomain || !/^[a-z0-9][a-z0-9.-]+$/i.test(authDomain)) return false;

  const issuer = `https://${authDomain}/`;
  try {
    const db = getSql();
    // The SQL client MUST be logged in as the actual non-BYPASSRLS runtime
    // principal, not SET ROLE from an owner/migrator account.
    const roles = await db.query(
      "SELECT current_user AS role, session_user AS login, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
      [],
      { fetchOptions: { signal: AbortSignal.timeout(3000), cache: "no-store" } },
    );
    const role = roles[0];
    if (!role || role.role !== expectedRuntime || role.login !== expectedRuntime
      || role.rolsuper !== false || role.rolbypassrls !== false) return false;

    const proof = signTenantContext(tenantId, identityId);
    if (!proof) return false;

    // Context must be set in a distinct SQL statement of the SAME atomic
    // transaction, not a writable CTE (RLS/STABLE visibility is statement-scoped).
    const [, results] = await db.transaction((tx) => [
      tx`SELECT iam.set_tenant_context(
        ${tenantId}::uuid, ${identityId}::uuid,
        ${proof.expires}::bigint, ${proof.nonce}::text, ${proof.signature}::text
      )`,
      tx`SELECT EXISTS(
        SELECT 1 FROM iam.identities i
        JOIN iam.memberships m ON m.identity_id=i.id
        WHERE i.id=${identityId}::uuid
          AND i.issuer=${issuer}::text
          AND i.subject=${subject}::text
          AND m.tenant_id=${tenantId}::uuid
          AND m.status='active'
          AND app_private.current_tenant_id()=${tenantId}::uuid
          AND EXISTS(
            SELECT 1 FROM iam.effective_permissions(m.id) p
            WHERE p.permission_key=${permission}::text
          )
          AND NOT EXISTS(
            SELECT 1 FROM iam.access_policies ap
            WHERE ap.tenant_id=m.tenant_id AND ap.enabled
          )
      ) AS allowed`,
    ], { readOnly: true });
    return results.length === 1 && results[0]?.allowed === true;
  } catch {
    // No raw SQL, secret, connection URL or HMAC appears in logs or responses.
    return false;
  }
}
