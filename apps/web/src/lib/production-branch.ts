import { createHash } from "node:crypto";

/**
 * Production-only, fail-closed Neon branch binding.
 *
 * Do not expose DATABASE_URL, session values, branch metadata or HMAC keys.
 * The expected branch is non-secret Vercel Production configuration, not a
 * browser input. Preview and Development retain their own G3 lease contract.
 */
export function expectedProductionBranch(): string | undefined {
  if (process.env.VERCEL_ENV !== "production") return undefined;
  const expected = process.env.IAM_PRODUCTION_EXPECTED_NEON_BRANCH_ID?.trim() ?? "";
  return /^br-[a-z0-9-]{6,60}$/.test(expected) ? expected : "";
}

export function productionBranchValid(actualBranch: unknown): boolean {
  const expected = expectedProductionBranch();
  return expected === undefined || (expected !== "" && actualBranch === expected);
}

/**
 * One-time authenticated Production diagnostic. Uses a fixed public domain
 * separator and SHA-256, not a token or secret, so branch IDs never enter
 * API responses, logs or CI output. A fingerprint is NOT an authorization
 * proof and the explicit feature flag must be removed after readback.
 */
export function productionBranchFingerprint(actualBranch: unknown): string | undefined {
  if (process.env.VERCEL_ENV !== "production" ||
      process.env.IAM_PRODUCTION_BRANCH_FINGERPRINT_ENABLED !== "true" ||
      typeof actualBranch !== "string" ||
      !/^br-[a-z0-9-]{6,60}$/.test(actualBranch)) {
    return undefined;
  }
  return createHash("sha256")
    .update(`iam-prod-branch-attestation:v1:${actualBranch}`, "utf8")
    .digest("hex")
    .slice(0, 24);
}
