import { NextResponse } from "next/server";
import { getPublicRuntimeStatus } from "../../../lib/env";
import { getSql } from "../../../lib/db";

export const dynamic = "force-dynamic";

const EXPECTED_DATABASE_ROLE = "iam_app_runtime_login";

export async function GET() {
  const runtimeStatus = getPublicRuntimeStatus();

  if (!runtimeStatus.databaseConfigured) {
    return NextResponse.json(
      {
        ok: false,
        service: "iam-control-center-web",
        status: "unavailable",
        ...runtimeStatus,
        databaseReachable: false,
        databaseRoleVerified: false,
      },
      { status: 503 },
    );
  }

  try {
    const sql = getSql();
    const rows = await sql`SELECT current_user = 'iam_app_runtime_login' AS runtime_role_verified`;
    const databaseRoleVerified = rows[0]?.runtime_role_verified === true;

    if (!databaseRoleVerified) {
      return NextResponse.json(
        {
          ok: false,
          service: "iam-control-center-web",
          status: "unavailable",
          ...runtimeStatus,
          databaseReachable: true,
          databaseRoleVerified: false,
        },
        { status: 503 },
      );
    }

    return NextResponse.json({
      ok: true,
      service: "iam-control-center-web",
      status: "healthy",
      ...runtimeStatus,
      databaseReachable: true,
      databaseRoleVerified: true,
    });
  } catch {
    // Do not expose connection strings, credentials, or provider error details.
    return NextResponse.json(
      {
        ok: false,
        service: "iam-control-center-web",
        status: "unavailable",
        ...runtimeStatus,
        databaseReachable: false,
        databaseRoleVerified: false,
      },
      { status: 503 },
    );
  }
}
