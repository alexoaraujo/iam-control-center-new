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
