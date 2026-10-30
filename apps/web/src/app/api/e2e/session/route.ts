import { NextResponse } from "next/server";
import { auth0 } from "../../../../lib/auth0";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth0.getSession();

  return NextResponse.json(
    {
      authenticated: Boolean(session),
      subjectPresent: Boolean(session?.user?.sub),
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}
