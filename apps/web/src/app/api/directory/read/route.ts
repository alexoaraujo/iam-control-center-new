import { NextResponse } from "next/server";
import { auth0 } from "../../../../lib/auth0";
import { readTenantDirectory, validSelector } from "../../../../lib/authorization";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 4096;
const deny = () => NextResponse.json({ error: "forbidden" }, { status: 403, headers });

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


export async function POST(request: Request) {
  try {
    const session = await auth0.getSession();
    const subject = session?.user?.sub;
    if (typeof subject !== "string" || !subject) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
    if (request.headers.get("origin") !== process.env.APP_BASE_URL ||
        request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") return deny();
    const body = await readBoundedJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) return deny();
    const input = body as Record<string, unknown>;
    if (Object.keys(input).sort().join(",") !== "cursor,identityId,kind,tenantId"
      || !validSelector(input.tenantId) || !validSelector(input.identityId)
      || (input.kind !== "organizations" && input.kind !== "identities")
      || (input.cursor !== null && !validSelector(input.cursor))) return deny();
    const result = await readTenantDirectory(subject, input.tenantId, input.identityId, input.kind, input.cursor);
    return result ? NextResponse.json(result, { headers }) : deny();
  } catch { return deny(); }
}
