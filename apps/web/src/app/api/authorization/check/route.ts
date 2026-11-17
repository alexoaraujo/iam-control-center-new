import { NextResponse } from "next/server";
import { auth0 } from "../../../../lib/auth0";
import { checkPermission, validPermission, validSelector } from "../../../../lib/authorization";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 4096;
const deny = () => NextResponse.json({ allowed: false }, { status: 403, headers });

/**
 * Parse only a bounded number of actual UTF-8 bytes. Request.text() would
 * first buffer an untrusted, potentially unbounded stream in memory.
 */
async function readBoundedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("missing_json_body");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let payload = "";
  let complete = false;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        complete = true;
        break;
      }
      bytesRead += chunk.value.byteLength;
      if (bytesRead > MAX_BODY_BYTES) throw new Error("json_body_too_large");
      payload += decoder.decode(chunk.value, { stream: true });
    }
    payload += decoder.decode();
    return JSON.parse(payload);
  } finally {
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

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
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null &&
      (!/^(0|[1-9][0-9]*)$/.test(declaredLength) ||
       Number(declaredLength) > MAX_BODY_BYTES)) return deny();

  let body: unknown;
  try {
    body = await readBoundedJson(request);
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
