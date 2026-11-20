/**
 * Temporary short-lived application session for the isolated PR #41 Preview
 * expiry test. This is never enabled for Production or another PR/branch.
 *
 * Auth0 IdP session expiry and SDK application session expiry are independent;
 * this exercises the latter without changing Auth0 tenant-wide settings.
 */
export function getPreviewE2ESessionConfig(env: Readonly<Record<string, string | undefined>>) {
  const ttl = env.AUTH0_E2E_SESSION_ABSOLUTE_SECONDS;
  if (ttl === undefined) return undefined;
  if (env.VERCEL_ENV !== "preview" ||
      env.VERCEL_GIT_COMMIT_REF !== "feat/iam-api-rbac-lineage-20261110") {
    throw new Error("Short-lived Auth0 test session must be limited to PR #41 Preview");
  }
  if (!/^[1-9][0-9]{1,2}$/.test(ttl) || Number(ttl) < 40 || Number(ttl) > 180) {
    throw new Error("Auth0 Preview test TTL must be an integer in [40, 180] seconds");
  }
  const seconds = Number(ttl);
  return {
    absoluteDuration: seconds,
    inactivityDuration: seconds,
    rolling: false as const,
  };
}
