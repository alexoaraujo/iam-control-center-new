#!/usr/bin/env node
/**
 * Auth0 Management API read-only population dry-run for a reviewed IAM tenant.
 * No database client, writes, user records, or credentials are logged.
 * Usage: AUTH0_DOMAIN=... AUTH0_MGMT_CLIENT_ID=... AUTH0_MGMT_CLIENT_SECRET=... \
 *        node scripts/auth0-existing-users-dry-run.mjs --dry-run
 * Requires an approved M2M client with read:users on the management audience.
 */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const APPROVED_DOMAIN = "iam-control-center.us.auth0.com";
const PAGE_SIZE = 100;
const MAX_USERS = 999;

export function validateInput(env) {
  if (env.AUTH0_DOMAIN !== APPROVED_DOMAIN) throw new Error("Approved Auth0 domain is required");
  if (!env.AUTH0_MGMT_CLIENT_ID?.trim() || !env.AUTH0_MGMT_CLIENT_SECRET?.trim())
    throw new Error("Management M2M credentials missing");
  return {
    domain: APPROVED_DOMAIN,
    clientId: env.AUTH0_MGMT_CLIENT_ID,
    clientSecret: env.AUTH0_MGMT_CLIENT_SECRET,
  };
}

export async function getReadUsersToken(config, fetcher = fetch) {
  const issuer = `https://${config.domain}/`;
  const result = await fetcher(`${issuer}oauth/token`, {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials", client_id: config.clientId,
      client_secret: config.clientSecret, audience: `${issuer}api/v2/`,
      scope: "read:users",
    }),
  });
  if (!result.ok) throw new Error(`Token endpoint rejected request: HTTP ${result.status}`);
  const body = await result.json();
  if (!body || typeof body.access_token !== "string" || !body.access_token ||
      body.token_type !== "Bearer" ||
      typeof body.scope !== "string" ||
      body.scope.trim().split(/\s+/).filter(Boolean).join(" ") !== "read:users") {
    throw new Error("Management token has invalid type or insufficient read:users scope");
  }
  return body.access_token;
}

export async function scanUsers(config, token, fetcher = fetch) {
  if (!token) throw new Error("Management bearer token missing");
  const records = [];
  const subjects = new Set();
  for (let page = 0; page < 10; page++) {
    const url = new URL(`https://${config.domain}/api/v2/users`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(PAGE_SIZE));
    url.searchParams.set("include_totals", "false");
    url.searchParams.set("fields", "user_id,email,email_verified,name");
    url.searchParams.set("include_fields", "true");
    const response = await fetcher(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Management users request failed: HTTP ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body) || body.length > PAGE_SIZE) throw new Error("Invalid Management users page");
    for (const item of body) {
      if (!item || typeof item.user_id !== "string" ||
          item.user_id.length < 1 || item.user_id.length > 255) {
        throw new Error("Invalid Management user identifier");
      }
      if (subjects.has(item.user_id)) throw new Error("Duplicate Management user identifier");
      subjects.add(item.user_id);
      if (subjects.size > MAX_USERS) throw new Error("Pagination cap: export job required");
      records.push({
        subject: item.user_id,
        email: typeof item.email === "string" && item.email.trim()
          ? item.email.trim().slice(0, 320) : null,
        emailVerified: item.email_verified === true,
        name: typeof item.name === "string" && item.name.trim()
          ? item.name.trim().slice(0, 255) : null,
        verifiedPresent: typeof item.email_verified === "boolean",
      });
    }
    if (body.length < PAGE_SIZE) {
      const sourceFingerprint = createHash("sha256")
        .update(JSON.stringify({
          issuer: `https://${config.domain}/`,
          snapshot: records.sort((a, b) => a.subject.localeCompare(b.subject)),
        }))
        .digest("hex");
      return { mode: "dry-run", scanned: records.length, written: 0, sourceFingerprint };
    }
  }
  throw new Error("Pagination cap: export job required");
}

export async function executeDryRun(env, fetcher = fetch) {
  const config = validateInput(env);
  const token = await getReadUsersToken(config, fetcher);
  return scanUsers(config, token, fetcher);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3 || process.argv[2] !== "--dry-run") {
    process.stderr.write("Usage: node scripts/auth0-existing-users-dry-run.mjs --dry-run\n");
    process.exitCode = 2;
  } else {
    try {
      const summary = await executeDryRun(process.env);
      process.stdout.write(JSON.stringify(summary) + "\n");
    } catch {
      // Errors may contain provider URLs, bodies or PII. Print no secret-bearing detail.
      process.stderr.write("Auth0 read-only dry-run failed; see approved operator diagnostics.\n");
      process.exitCode = 1;
    }
  }
}
