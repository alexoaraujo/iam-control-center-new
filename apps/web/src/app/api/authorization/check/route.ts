import { NextResponse } from "next/server";
import { auth0 } from "../../../../lib/auth0";
import { checkPermission, validPermission, validSelector } from "../../../../lib/authorization";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const deny = () => NextResponse.json({ allowed: false }, { status: 403, headers });

/**
 * POST /api/authorization/check
 *
 * Auth0 session is required. The client provides ONLY tenant/identity
 * selectors and a permission name — never a signature, nonce or expiry.
 * The server mints a private, one-request HMAC bound to the supplied IDs,
 * then the database RLS + Auth0 issuer/subject binding decide access.
 * No signed proof ever crosses the browser/API boundary.
 */
export async function POST(request: Request) {
  const session = await auth0.getSession();
  const subject = session?.user?.sub;
  if (typeof subject !== "string" || !subject) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  }
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") return deny();
  const length = Number(request.headers.get("content-length") || "0");
  if (!Number.isFinite(length) || length > 4096) return deny();

  let body: unknown;
  try {
    const payload = await request.text();
    if (payload.length > 4096) return deny();
    body = JSON.parse(payload);
  } catch {
    return deny();
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return deny();
  const input = body as Record<string, unknown>;
  const keys = Object.keys(input).sort();
  if (keys.length !== 3 || keys.join(",") !== "identityId,permission,tenantId"
    || !validPermission(input.permission)
    || !validSelector(input.tenantId) || !validSelector(input.identityId)) return deny();

  const allowed = await checkPermission(subject, input.tenantId, input.identityId, input.permission);
  return allowed
    ? NextResponse.json({ allowed: true }, { status: 200, headers })
    : deny();
}
