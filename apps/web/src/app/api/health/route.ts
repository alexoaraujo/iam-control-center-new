import { NextResponse } from "next/server";
import { getPublicRuntimeStatus } from "../../../lib/env";

/** Liveness and configuration inventory; does not prove DB or Auth0 connectivity. */
export function GET() {
  return NextResponse.json({
    ok: true,
    service: "iam-control-center-web",
    status: "scaffold",
    ...getPublicRuntimeStatus(),
  }, {
    headers: { "Cache-Control": "no-store", "X-Health-Check": "liveness" },
  });
}
