/**
 * Additional safety gate for Vercel's Ignored Build Step.
 *
 * This prevents a merge-to-main from automatically authorizing a Production
 * build. GitHub release approval and Vercel Production promotion remain
 * separate controls; this check alone does not approve a release.
 */
const COMMIT_SHA = /^[0-9a-f]{40}$/;

export function isApprovedProductionRelease({ commitSha, approvedSha, ref }) {
  return ref === "main" &&
    typeof commitSha === "string" && COMMIT_SHA.test(commitSha) &&
    typeof approvedSha === "string" && COMMIT_SHA.test(approvedSha) &&
    commitSha === approvedSha;
}
