/** The G3 lease is bound to a single short-lived PR128 Preview fixture.
 * Shared by readiness and authorization so a healthy connection can never
 * silently authorize against a different or expired disposable Neon branch.
 * No secrets, SQL connections or browser-controlled values are accepted here.
 */
export const PR128_PREVIEW_ORIGIN = "https://iam-control-center-new-pr128-ci.vercel.app";
export const PR128_NEON_BRANCH = "br-super-sound-b63gtz88";
export const PR128_LEASE_EXPIRES_AT = "2026-11-21T22:00:00Z";
const LEASE_GUARD_MS = 15 * 60_000;

/** Explicit branch variables also opt into fail-closed mode if the origin drifts. */
export function isG3PreviewScoped() {
  return process.env.APP_BASE_URL?.trim() === PR128_PREVIEW_ORIGIN
    || process.env.IAM_G3_EXPECTED_NEON_BRANCH_ID !== undefined
    || process.env.IAM_G3_NEON_LEASE_EXPIRES_AT !== undefined;
}

export function g3PreviewLeaseValid(now: number = Date.now()) {
  if (!isG3PreviewScoped()) return true;
  return process.env.IAM_G3_EXPECTED_NEON_BRANCH_ID === PR128_NEON_BRANCH
    && process.env.IAM_G3_NEON_LEASE_EXPIRES_AT === PR128_LEASE_EXPIRES_AT
    && Number.isFinite(now)
    && now + LEASE_GUARD_MS < Date.parse(PR128_LEASE_EXPIRES_AT);
}

export function g3PreviewBranchValid(actualBranch: unknown) {
  return !isG3PreviewScoped() || actualBranch === PR128_NEON_BRANCH;
}
