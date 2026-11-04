import { NextResponse } from "next/server";
import { getPublicRuntimeStatus } from "../../../lib/env";
import { getSql } from "../../../lib/db";

export const dynamic = "force-dynamic";

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
      },
      { status: 503 },
    );
  }

  try {
    const sql = getSql();
    await sql`SELECT 1 AS health_check`;

    return NextResponse.json({
      ok: true,
      service: "iam-control-center-web",
      status: "healthy",
      ...runtimeStatus,
      databaseReachable: true,
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
      },
      { status: 503 },
    );
  }
}
