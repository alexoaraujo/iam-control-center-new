import { NextResponse } from "next/server";
import { getPublicRuntimeStatus } from "../../../lib/env";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "iam-control-center-web",
    status: "scaffold",
    ...getPublicRuntimeStatus(),
  });
}
