import { getSql } from "./db";

/** Dependency readiness only; not evidence of tenant authorization or RLS isolation. */
export async function checkReadiness() {
  const authKeys = ["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET", "APP_BASE_URL"] as const;
  if (!authKeys.every((key) => process.env[key]?.trim()) || !process.env.DATABASE_URL?.trim()) {
    return { ready: false, reason: "configuration_incomplete" } as const;
  }
  const expectedRole = process.env.DATABASE_RUNTIME_ROLE?.trim();
  if (!expectedRole) return { ready: false, reason: "runtime_role_unconfigured" } as const;
  try {
    const rows = await getSql().query(
      "SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
      [],
      { fetchOptions: { signal: AbortSignal.timeout(3000), cache: "no-store" } },
    );
    const role = rows[0];
    if (!role || role.role !== expectedRole || role.rolsuper !== false || role.rolbypassrls !== false) {
      return { ready: false, reason: "runtime_role_rejected" } as const;
    }
    return { ready: true, reason: "dependencies_available" } as const;
  } catch {
    // Driver errors may contain credentials or hosts. Never return or log them.
    return { ready: false, reason: "database_unavailable" } as const;
  }
}
