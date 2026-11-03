import "server-only";

import { neon } from "@neondatabase/serverless";

/**
 * Creates a Neon SQL client using the pooled runtime DATABASE_URL.
 * This function does not execute queries or establish a database session.
 */
export function getSql() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString?.trim()) {
    throw new Error("DATABASE_URL is not configured");
  }

  return neon(connectionString);
}
