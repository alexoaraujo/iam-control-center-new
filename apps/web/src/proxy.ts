import { auth0 } from "./lib/auth0";

const previewAlias = "iam-control-center-new-preview.vercel.app";
const canonicalPreview = "iam-control-center-new-ci-preview.vercel.app";

/** Redirect before Auth0 issues an OAuth state cookie on the wrong origin.
 * Auth0 APP_BASE_URL for PR #41 is the CI Preview alias. This is deliberately
 * scoped to that PR's Preview, never to Production or arbitrary Host headers.
 */
export async function proxy(request: Request) {
  const url = new URL(request.url);
  if (process.env.VERCEL_ENV === "preview" &&
      process.env.VERCEL_GIT_COMMIT_REF === "feat/iam-api-rbac-lineage-20261110" &&
      process.env.APP_BASE_URL === `https://${canonicalPreview}` &&
      url.protocol === "https:" && url.hostname === previewAlias) {
    url.hostname = canonicalPreview;
    return Response.redirect(url, 307);
  }
  return await auth0.middleware(request);
}

export const config = {
  matcher: [
    "/((?!api/health(?:/|$)|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
