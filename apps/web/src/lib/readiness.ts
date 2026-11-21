import { getSql } from "./db";
import { g3PreviewBranchValid, g3PreviewLeaseValid } from "./g3-preview-lease";
import { expectedProductionBranch, productionBranchValid } from "./production-branch";

/** Dependency readiness only; not evidence of tenant authorization or RLS isolation. */
export async function checkReadiness() {
  const authKeys = ["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET", "APP_BASE_URL"] as const;
  if (!authKeys.every((key) => process.env[key]?.trim()) || !process.env.DATABASE_URL?.trim()) {
    return { ready: false, reason: "configuration_incomplete" } as const;
  }
  // Readiness and authorization share the same short-lived G3 guard.
  if (!g3PreviewLeaseValid()) {
    return { ready: false, reason: "g3_fixture_lease_rejected" } as const;
  }
  // An unbound Production database is never reported healthy as a tenant runtime.
  if (expectedProductionBranch() === "") {
    return { ready: false, reason: "production_branch_unconfigured" } as const;
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
    if (!g3PreviewBranchValid(role.branch_id)) {
      return { ready: false, reason: "g3_database_branch_rejected" } as const;
    }
    if (!productionBranchValid(role.branch_id)) {
      return { ready: false, reason: "production_branch_mismatch" } as const;
    }
    return { ready: true, reason: "dependencies_available" } as const;
  } catch {
    // Driver errors may contain credentials or hosts. Never return or log them.
    return { ready: false, reason: "database_unavailable" } as const;
  }
}
