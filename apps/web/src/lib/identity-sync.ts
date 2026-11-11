/**
 * Auth0 -> IAM identity synchronization.
 * No tenant memberships or RBAC grants may be created by this module.
 * The caller must authenticate the identity before passing its claims.
 */
export type Auth0Identity = {
  sub: string;
  email?: string | null;
  email_verified?: boolean | null;
  name?: string | null;
};

export type IdentityRecord = {
  id: string;
  issuer: string;
  subject: string;
};

export type IdentitySql = {
  query: (statement: string, parameters: unknown[]) => Promise<Array<IdentityRecord>>;
};

export function canonicalIssuer(domain: string): string {
  const raw = domain.trim();
  if (!raw || raw.includes("/") || raw.includes("?") || raw.includes("#") ||
      !/^[a-z0-9.-]+$/i.test(raw) || raw.startsWith(".") || raw.endsWith(".")) {
    throw new Error("Invalid AUTH0_DOMAIN");
  }
  return `https://${raw.toLowerCase()}/`;
}

export function normalizeIdentity(user: Auth0Identity) {
  if (!user || typeof user.sub !== "string" || user.sub.length < 1 || user.sub.length > 255) {
    throw new Error("Invalid Auth0 subject");
  }
  const email = typeof user.email === "string" && user.email.trim()
    ? user.email.trim().slice(0, 320)
    : null;
  const name = typeof user.name === "string" && user.name.trim()
    ? user.name.trim().slice(0, 255)
    : null;
  return { subject: user.sub, email, emailVerified: user.email_verified === true, name };
}

/** One statement per user; requires a separately reviewed, least-privileged write capability. */
export async function syncIdentity(
  sql: IdentitySql,
  issuer: string,
  user: Auth0Identity,
): Promise<IdentityRecord> {
  if (!issuer.startsWith("https://") || !issuer.endsWith("/")) {
    throw new Error("Invalid issuer");
  }
  const identity = normalizeIdentity(user);
  const rows = await sql.query(
    `INSERT INTO iam.identities (issuer, subject, email, email_verified, display_name, last_authenticated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (issuer, subject)
     DO UPDATE SET email = EXCLUDED.email,
                   email_verified = EXCLUDED.email_verified,
                   display_name = EXCLUDED.display_name,
                   last_authenticated_at = NOW()
     RETURNING id, issuer, subject`,
    [issuer, identity.subject, identity.email, identity.emailVerified, identity.name],
  );
  if (rows.length !== 1) throw new Error("Identity sync did not return a single record");
  return rows[0];
}

/** Import existing Auth0 users via a trusted, paginated server-side source.
 * Stop on the first failed write; replay is safe because of issuer/subject uniqueness.
 */
export async function syncExistingUsers(
  sql: IdentitySql,
  issuer: string,
  users: AsyncIterable<Auth0Identity>,
  onProgress?: (count: number) => void,
): Promise<number> {
  let count = 0;
  for await (const user of users) {
    await syncIdentity(sql, issuer, user);
    count += 1;
    onProgress?.(count);
  }
  return count;
}
