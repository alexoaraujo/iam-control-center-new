import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Deployment identity probe for protected Preview E2E tests.
 * Exposes only Vercel system metadata already visible in deployment records.
 * No application/database/session secrets are returned.
 */
export function GET() {
  const headers = {
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
  };

  const evidence = {
    deploymentHost: process.env.VERCEL_URL || null,
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
    branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    repository: process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG
      ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`
      : null,
    environment: process.env.VERCEL_ENV || null,
    pullRequestId: process.env.VERCEL_GIT_PULL_REQUEST_ID || null,
  };

  // A partial/missing system-variable configuration must never be accepted
  // as evidence that two aliases share a specific Git deployment.
  if (!evidence.deploymentHost || !evidence.commitSha || !evidence.branch ||
      !evidence.repository || evidence.environment !== "preview") {
    return NextResponse.json({ ok: false }, { status: 503, headers });
  }

  return NextResponse.json({ ok: true, ...evidence }, { headers });
}
