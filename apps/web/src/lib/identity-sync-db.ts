import "server-only";
import { getSql } from "./db";
import { canonicalIssuer, syncIdentity, type Auth0Identity } from "./identity-sync";

/**
 * This is intentionally disabled until the real Neon runtime login is verified,
 * IAM identity write grants/RLS are reviewed, and a development-only rollout is approved.
 */
export async function syncAuthenticatedIdentity(user: Auth0Identity) {
  if (process.env.AUTH0_NEON_SYNC_ENABLED !== "true") {
    throw new Error("Identity synchronization is disabled");
  }
  if (!process.env.AUTH0_DOMAIN) throw new Error("AUTH0_DOMAIN is not configured");
  const issuer = canonicalIssuer(process.env.AUTH0_DOMAIN);
  return syncIdentity(getSql(), issuer, user);
}
