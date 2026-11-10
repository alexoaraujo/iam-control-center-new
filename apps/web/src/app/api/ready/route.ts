import { NextResponse } from "next/server";
import { auth0 } from "../../../lib/auth0";
import { checkReadiness } from "../../../lib/readiness";

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  if (!(await auth0.getSession())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  }
  const result = await checkReadiness();
  return NextResponse.json(result, { status: result.ready ? 200 : 503, headers });
}
