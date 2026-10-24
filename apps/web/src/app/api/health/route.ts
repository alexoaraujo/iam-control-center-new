import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "iam-control-center-web",
    status: "scaffold",
    authConfigured: false,
    databaseConfigured: false,
  });
}
