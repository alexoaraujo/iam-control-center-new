import { createHash } from "node:crypto";
import { readExistingAuth0Users } from "./auth0-existing-users";
import {
  canonicalIssuer, normalizeIdentity, syncIdentity,
  type Auth0Identity, type IdentitySql,
} from "./identity-sync";

/**
 * Server-side, two-step Auth0 backfill. Never exposed as a public HTTP route.
 * Scans the COMPLETE Management API population before the first database write.
 * Counts and fingerprint do not include email or name; never log individual users.
 */
export type ImportPlan = {
  mode: "dry-run" | "apply";
  scanned: number;
  written: number;
  sourceFingerprint: string;
};

export type ImportOptions = {
  domain: string;
  expectedIssuer: string;
  accessToken: string;
  fetcher?: typeof fetch;
  mode?: "dry-run" | "apply";
  maxUsers?: number;
  sql?: IdentitySql;
  /** Independent, reviewed authorization; never inferred from AUTH0_NEON_SYNC_ENABLED. */
  approval?: "reviewed-preview-import";
  /** Neon child branch id supplied by the trusted operator, never by a browser. */
  targetBranchId?: string;
  approvedBranchId?: string;
  expectedCount?: number;
  expectedFingerprint?: string;
};

export async function importExistingAuth0Users(options: ImportOptions): Promise<ImportPlan> {
  const mode = options.mode ?? "dry-run";
  if (mode !== "dry-run" && mode !== "apply") throw new Error("Invalid import mode");
  const issuer = canonicalIssuer(options.domain);
  if (options.expectedIssuer !== issuer) throw new Error("Auth0 issuer mismatch");

  // The /users endpoint's documented 1000-result search cap MUST NOT be
  // treated as a complete export. Restrict in-memory dry-runs to <1000 users.
  const maxUsers = options.maxUsers ?? 999;
  if (!Number.isSafeInteger(maxUsers) || maxUsers < 1 || maxUsers > 999) {
    throw new Error("Invalid import limit");
  }

  if (mode === "apply") {
    if (!options.sql || options.approval !== "reviewed-preview-import" ||
        !options.targetBranchId || !/^br-[a-z0-9-]+$/.test(options.targetBranchId) ||
        options.targetBranchId !== options.approvedBranchId ||
        !Number.isSafeInteger(options.expectedCount) || (options.expectedCount ?? -1) < 1 ||
        !/^[a-f0-9]{64}$/.test(options.expectedFingerprint ?? "")) {
      throw new Error("Existing-user import is not approved for an isolated target");
    }
  }

  const users: Auth0Identity[] = [];
  const subjects = new Set<string>();
  for await (const user of readExistingAuth0Users(options.domain, options.accessToken, options.fetcher)) {
    const identity = normalizeIdentity(user);
    if (subjects.has(identity.subject)) {
      throw new Error("Auth0 source contains duplicate user IDs");
    }
    subjects.add(identity.subject);
    if (subjects.size > maxUsers) throw new Error("Auth0 population exceeds reviewed import limit");
    users.push(user);
  }

  // Non-secret content fingerprint used only to verify both runs saw the
  // same user_id set, never as authorization, user credential, or account ID.
  const sourceFingerprint = createHash("sha256")
    .update(issuer + "\u0000" + [...subjects].sort().join("\u0000"), "utf8")
    .digest("hex");
  const scanned = users.length;

  if (mode === "dry-run") return { mode, scanned, written: 0, sourceFingerprint };
  if (scanned !== options.expectedCount || sourceFingerprint !== options.expectedFingerprint) {
    throw new Error("Auth0 source changed since dry-run; no identities written");
  }

  let written = 0;
  for (const user of users) {
    await syncIdentity(options.sql!, issuer, user, "import");
    written++;
  }
  return { mode, scanned, written, sourceFingerprint };
}
