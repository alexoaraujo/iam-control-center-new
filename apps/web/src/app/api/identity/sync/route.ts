import { NextResponse } from "next/server";
import { auth0 } from "../../../../lib/auth0";
import { syncAuthenticatedIdentity } from "../../../../lib/identity-sync-db";

export const runtime = "nodejs";

/** Authenticated, opt-in synchronization. Never accepts identity fields from the request body. */
export async function POST() {
  const headers = { "Cache-Control": "no-store" };
  const session = await auth0.getSession();
  if (!session?.user?.sub) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  }
  if (process.env.AUTH0_NEON_SYNC_ENABLED !== "true") {
    return NextResponse.json({ error: "sync_unavailable" }, { status: 503, headers });
  }
  try {
    const identity = await syncAuthenticatedIdentity(session.user);
    return NextResponse.json({ id: identity.id, synchronized: true }, { headers });
  } catch {
    // Never expose database errors, query fragments, or user profile data.
    return NextResponse.json({ error: "sync_unavailable" }, { status: 503, headers });
  }
}
