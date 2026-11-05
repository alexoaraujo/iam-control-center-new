import "server-only";

import { neon } from "@neondatabase/serverless";

/**
 * Creates a server-only Neon SQL client using the runtime DATABASE_URL.
 * Endpoint mode (direct or pooled) must follow the verified Neon connection contract.
 * This function does not execute queries or establish a database session.
 */
export function getSql() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString?.trim()) {
    throw new Error("DATABASE_URL is not configured");
  }

  return neon(connectionString);
}
