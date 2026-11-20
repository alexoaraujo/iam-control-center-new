import { getSql } from "./db";

/** Dependency readiness only; not evidence of tenant authorization or RLS isolation. */
export async function checkReadiness() {
  const authKeys = ["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET", "APP_BASE_URL"] as const;
  if (!authKeys.every((key) => process.env[key]?.trim()) || !process.env.DATABASE_URL?.trim()) {
    return { ready: false, reason: "configuration_incomplete" } as const;
  }
  // PR128 has a short-lived validation-only Neon clone. Readiness on this
  // exact Preview origin must fail closed if the lease expired or its expected
  // branch configuration drifted. No Production or unrelated Preview impact.
  const pr128Preview = process.env.APP_BASE_URL?.trim()
    === "https://iam-control-center-new-pr128-ci.vercel.app";
  if (pr128Preview) {
    const expiresAt = "2026-11-21T22:00:00Z";
    if (process.env.IAM_G3_EXPECTED_NEON_BRANCH_ID !== "br-super-sound-b63gtz88"
      || process.env.IAM_G3_NEON_LEASE_EXPIRES_AT !== expiresAt
      || Date.now() + 15 * 60_000 >= Date.parse(expiresAt)) {
      return { ready: false, reason: "g3_fixture_lease_rejected" } as const;
    }
  }
  const expectedRole = process.env.DATABASE_RUNTIME_ROLE?.trim();
  if (!expectedRole) return { ready: false, reason: "runtime_role_unconfigured" } as const;
  try {
    const rows = await getSql().query(
      "SELECT current_user AS role, rolsuper, rolbypassrls, current_setting('neon.branch_id',true) AS branch_id FROM pg_roles WHERE rolname = current_user",
      [],
      { fetchOptions: { signal: AbortSignal.timeout(3000), cache: "no-store" } },
    );
    const role = rows[0];
    if (!role || role.role !== expectedRole || role.rolsuper !== false || role.rolbypassrls !== false) {
      return { ready: false, reason: "runtime_role_rejected" } as const;
    }
    if (pr128Preview && role.branch_id !== "br-super-sound-b63gtz88") {
      return { ready: false, reason: "g3_database_branch_rejected" } as const;
    }
    return { ready: true, reason: "dependencies_available" } as const;
  } catch {
    // Driver errors may contain credentials or hosts. Never return or log them.
    return { ready: false, reason: "database_unavailable" } as const;
  }
}
