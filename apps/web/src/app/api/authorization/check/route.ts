import { NextResponse } from "next/server";
import { auth0 } from "../../../../lib/auth0";
import { checkPermission, validPermission, validProof } from "../../../../lib/authorization";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };
const deny = () => NextResponse.json({ allowed: false }, { status: 403, headers });

/**
 * POST /api/authorization/check
 * The client cannot mint a valid tenant proof. A trusted issuance mechanism
 * must be built and approved before this endpoint can return 200 in Preview.
 * Never infer authorization from Auth0 authentication alone.
 */
export async function POST(request: Request) {
  const session = await auth0.getSession();
  const subject = session?.user?.sub;
  if (typeof subject !== "string" || !subject) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  }
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") return deny();
  const length = Number(request.headers.get("content-length") || "0");
  if (length > 4096) return deny();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return deny();
  }
  if (!body || typeof body !== "object") return deny();
  const input = body as Record<string, unknown>;
  if (!validPermission(input.permission) || !validProof(input.context)) return deny();
  const allowed = await checkPermission(subject, input.context, input.permission);
  return allowed
    ? NextResponse.json({ allowed: true }, { status: 200, headers })
    : deny();
}
