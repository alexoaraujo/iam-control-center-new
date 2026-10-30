import { NextResponse, type NextRequest } from "next/server";
import { auth0 } from "./lib/auth0";

export async function middleware(request: NextRequest) {
  // OPTIONS is a protocol capability check, not an authenticated application
  // action. Answer it before the Auth0 session middleware to avoid starting an
  // OIDC redirect for preflight requests. This does not enable cross-origin
  // access; no Access-Control-Allow-* headers are emitted.
  if (request.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: { Allow: "GET, HEAD, OPTIONS" },
    });
  }

  return await auth0.middleware(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
