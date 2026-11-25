import { createHmac, randomBytes } from "node:crypto";
import { getSql } from "./db";
import { DIRECTORY_SQL } from "./directory-query";
import { canonicalIssuer } from "./identity-sync";
import { g3PreviewBranchValid, g3PreviewLeaseValid } from "./g3-preview-lease";
import { expectedProductionBranch, productionBranchValid } from "./production-branch";

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
  // A live Auth0 session cannot authorize on an expired or misbound G3 clone.
  // Fail before creating a SQL session or minting a tenant-context signature.
  if (!g3PreviewLeaseValid() || expectedProductionBranch() === "") return false;
  if (!subject || subject.length > 512 || !validSelector(tenantId) || !validSelector(identityId)
    || !validPermission(permission) || process.env.DATABASE_RUNTIME_ROLE !== expectedRuntime
    || !authDomain || !/^[a-z0-9][a-z0-9.-]+$/i.test(authDomain)) return false;

  // PostgreSQL::uuid canonicalizes hex digits to lowercase before verifying
  // the signed tenant context. Normalize both selectors first so the HMAC
  // payload and every SQL comparison use the exact same UUID representation.
  const canonicalTenantId = tenantId.toLowerCase();
  const canonicalIdentityId = identityId.toLowerCase();

  try {
    // Match the canonical issuer used by identity synchronization/import.
    // DNS hostname casing is not an authorization distinction.
    const issuer = canonicalIssuer(authDomain);
    const db = getSql();
    // The SQL client MUST be logged in as the actual non-BYPASSRLS runtime
    // principal, not SET ROLE from an owner/migrator account.
    const roles = await db.query(
      "SELECT current_user AS role, session_user AS login, rolsuper, rolbypassrls, current_setting('neon.branch_id',true) AS branch_id FROM pg_roles WHERE rolname = current_user",
      [],
      { fetchOptions: { signal: AbortSignal.timeout(3000), cache: "no-store" } },
    );
    const role = roles[0];
    if (!role || role.role !== expectedRuntime || role.login !== expectedRuntime
      || role.rolsuper !== false || role.rolbypassrls !== false
      || !g3PreviewBranchValid(role.branch_id)
      || !productionBranchValid(role.branch_id)) return false;

    const proof = signTenantContext(canonicalTenantId, canonicalIdentityId);
    if (!proof) return false;

    // Context must be set in a distinct SQL statement of the SAME atomic
    // transaction, not a writable CTE (RLS/STABLE visibility is statement-scoped).
    const [, results] = await db.transaction((tx) => [
      tx`SELECT iam.set_tenant_context(
        ${canonicalTenantId}::uuid, ${canonicalIdentityId}::uuid,
        ${proof.expires}::bigint, ${proof.nonce}::text, ${proof.signature}::text
      )`,
      tx`SELECT EXISTS(
        SELECT 1 FROM iam.identities i
        JOIN iam.memberships m ON m.identity_id=i.id
        WHERE i.id=${canonicalIdentityId}::uuid
          AND i.issuer=${issuer}::text
          AND i.subject=${subject}::text
          AND m.tenant_id=${canonicalTenantId}::uuid
          AND m.status='active'
          AND app_private.current_tenant_id()=${canonicalTenantId}::uuid
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

export type DirectoryKind = "organizations" | "identities";
export type DirectoryRow = { id: string; displayName: string | null; status: "active" };
export type DirectoryResult = { rows: DirectoryRow[]; nextCursor: string | null };

const directoryHost = "https://iam-control-center-new-p2-directory-ci.vercel.app";
const directoryBranch = "feat/peos-p2-tenant-directory-20261125";

/** Never enabled by default; only an explicitly leased, exact Preview branch. */
export function directoryEnabled(): boolean {
  const start = Date.parse(process.env.IAM_DIRECTORY_PREVIEW_LEASE_START_AT ?? "");
  const expiry = Date.parse(process.env.IAM_DIRECTORY_PREVIEW_EXPIRES_AT ?? "");
  const now = Date.now();
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? "";
  const branchId = process.env.IAM_DIRECTORY_PREVIEW_BRANCH_ID ?? "";
  const reserved = ["br-muddy-snow-b63cepcv", "br-ancient-term-b6mmx5ol", "br-floral-glitter-b6zvytjp", "br-solitary-sunset-b681d15f", "br-calm-forest-b6a1jpzs", "br-muddy-bar-b63ksdy7", "br-nameless-hat-b6j2p4m4", "br-plain-cell-b68uorki"];
  return process.env.IAM_DIRECTORY_PREVIEW_ENABLED === "true"
    && /^[a-f0-9]{40}$/.test(sha)
    && sha === process.env.IAM_DIRECTORY_PREVIEW_APPROVED_SHA
    && !reserved.includes(branchId)
    && Number.isFinite(start) && start <= now
    && expiry > start && expiry - start <= 2 * 60 * 60 * 1000
    && process.env.VERCEL_ENV === "preview"
    && process.env.VERCEL_GIT_COMMIT_REF === directoryBranch
    && process.env.APP_BASE_URL === directoryHost
    && /^br-[a-z0-9-]{3,100}$/.test(branchId)
    && Number.isFinite(expiry) && expiry > now && expiry <= now + 2 * 60 * 60 * 1000;
}

/** Single selected tenant; data and grant checked in the same SQL statement.
 * No global enumeration, no email/issuer/subject in the returned projection.
 * Missing prerequisites, malformed results and SQL errors all deny.
 */
export async function readTenantDirectory(subject: string, tenantId: string, identityId: string, kind: DirectoryKind, cursor: string | null): Promise<DirectoryResult | null> {
  if (!directoryEnabled() || !subject || subject.length > 255 || !validSelector(tenantId) || !validSelector(identityId)
    || (kind !== "organizations" && kind !== "identities")
    || (cursor !== null && (!validSelector(cursor) || kind !== "identities"))
    || process.env.DATABASE_RUNTIME_ROLE !== expectedRuntime) return null;
  const domain = process.env.AUTH0_DOMAIN?.trim();
  if (!domain || !/^[a-z0-9][a-z0-9.-]+$/i.test(domain)) return null;
  const branch = process.env.IAM_DIRECTORY_PREVIEW_BRANCH_ID;
  if (!branch) return null;
  try {
    const tenant = tenantId.toLowerCase(), identity = identityId.toLowerCase();
    const db = getSql();
    const roles = await db.query(
      "SELECT current_user AS role, session_user AS login, rolsuper, rolbypassrls, current_setting('neon.branch_id',true) AS branch_id FROM pg_roles WHERE rolname = current_user",
      [], { fetchOptions: { signal: AbortSignal.timeout(3000), cache: "no-store" } },
    );
    const role = roles[0];
    if (!role || role.role !== expectedRuntime || role.login !== expectedRuntime || role.rolsuper !== false
      || role.rolbypassrls !== false || role.branch_id !== branch || !directoryEnabled()) return null;
    const proof = signTenantContext(tenant, identity);
    if (!proof) return null;
    const [, result] = await db.transaction([
      db.query("SELECT iam.set_tenant_context($1::uuid,$2::uuid,$3::bigint,$4::text,$5::text)", [tenant, identity, proof.expires, proof.nonce, proof.signature]),
      db.query(DIRECTORY_SQL, [tenant, identity, canonicalIssuer(domain), subject, kind, cursor?.toLowerCase() ?? null, branch]),
    ], { readOnly: true, fetchOptions: { signal: AbortSignal.timeout(5000), cache: "no-store" } });
    const rows: unknown = result[0]?.rows;
    if (!directoryEnabled() || result.length !== 1 || result[0]?.allowed !== true || !Array.isArray(rows)
      || rows.length > (kind === "organizations" ? 1 : 51)) return null;
    const clean: DirectoryRow[] = [];
    for (const row of rows) {
      if (!row || !validSelector(row.id) || (row.displayName !== null && typeof row.displayName !== "string") || row.status !== "active") return null;
      if (kind === "organizations" && row.id !== tenant) return null;
      clean.push({ id: row.id, displayName: row.displayName, status: "active" });
    }
    return { rows: clean.slice(0, 50), nextCursor: clean.length === 51 ? clean[49]?.id ?? null : null };
  } catch { return null; }
}
