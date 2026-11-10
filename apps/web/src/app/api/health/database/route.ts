import { NextResponse } from "next/server";
import { getSql } from "../../../../lib/db";

export const dynamic = "force-dynamic";

/**
 * Public liveness probe: only SELECT 1, never tenant tables or credentials.
 * A successful response proves a real connection, unlike /api/health.
 */
export async function GET() {
  const headers = { "Cache-Control": "no-store" };

  try {
    const sql = getSql();
    const rows = await sql`SELECT 1 AS alive`;
    if (rows.length !== 1 || rows[0].alive !== 1) {
      throw new Error("Unexpected database probe result");
    }

    return NextResponse.json({ ok: true, database: "reachable" }, { headers });
  } catch {
    // Do not leak credentials, hostnames, or database error messages.
    return NextResponse.json(
      { ok: false, database: "unreachable" },
      { status: 503, headers },
    );
  }
}
