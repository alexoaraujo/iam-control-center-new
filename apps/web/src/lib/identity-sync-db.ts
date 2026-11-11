import "server-only";
import { getSql } from "./db";
import { canonicalIssuer, syncIdentity, type Auth0Identity } from "./identity-sync";

/**
 * Disabled until the real Neon runtime login is verified, write RLS is reviewed,
 * and a development-only rollout is approved.
 */
export async function syncAuthenticatedIdentity(user: Auth0Identity) {
  if (process.env.AUTH0_NEON_SYNC_ENABLED !== "true") {
    throw new Error("Identity synchronization is disabled");
  }
  if (!process.env.AUTH0_DOMAIN) throw new Error("AUTH0_DOMAIN is not configured");
  const issuer = canonicalIssuer(process.env.AUTH0_DOMAIN);
  // Adapt the Neon query result to the narrow, testable identity writer contract.
  const sql = getSql();
  return syncIdentity({
    query: async (statement, parameters) => {
      const rows = await sql.query(statement, parameters as (string | boolean | null)[]);
      return rows.map((row) => ({
        id: String(row.id),
        issuer: String(row.issuer),
        subject: String(row.subject),
      }));
    },
  }, issuer, user);
}
