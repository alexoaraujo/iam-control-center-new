import { NextRequest, NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { auth0Middleware } = vi.hoisted(() => ({
  auth0Middleware: vi.fn(),
}));

vi.mock("./lib/auth0", () => ({
  auth0: { middleware: auth0Middleware },
}));

import { middleware } from "./middleware";

describe("Auth0 middleware request handling", () => {
  afterEach(() => vi.clearAllMocks());

  it("answers OPTIONS without invoking the Auth0 session middleware", async () => {
    const request = new NextRequest("https://iam-control-center-preview.vercel.app/", {
      method: "OPTIONS",
      headers: {
        origin: "https://iam-control-center-preview.vercel.app",
        "access-control-request-method": "GET",
      },
    });

    const response = await middleware(request);

    expect(response.status).toBe(204);
    expect(response.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    expect(auth0Middleware).not.toHaveBeenCalled();
  });

  it("continues to delegate non-OPTIONS requests to Auth0", async () => {
    auth0Middleware.mockResolvedValueOnce(NextResponse.next());
    const request = new NextRequest("https://iam-control-center-preview.vercel.app/");

    const response = await middleware(request);

    expect(response.status).toBe(200);
    expect(auth0Middleware).toHaveBeenCalledOnce();
    expect(auth0Middleware).toHaveBeenCalledWith(request);
  });
});
