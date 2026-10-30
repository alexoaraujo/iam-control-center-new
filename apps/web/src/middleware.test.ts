import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const auth0Mock = vi.hoisted(() => ({
  middleware: vi.fn(),
}));

vi.mock("./lib/auth0", () => ({
  auth0: auth0Mock,
}));

import { middleware } from "./middleware";

describe("Auth0 middleware", () => {
  beforeEach(() => {
    auth0Mock.middleware.mockReset();
  });

  it("answers OPTIONS before invoking Auth0 and does not enable CORS", async () => {
    const request = new NextRequest("https://iam-control-center.vercel.app/", {
      method: "OPTIONS",
    });

    const response = await middleware(request);

    expect(response.status).toBe(204);
    expect(response.headers.get("Allow")).toBe("GET, HEAD, OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(auth0Mock.middleware).not.toHaveBeenCalled();
  });

  it("delegates non-OPTIONS requests to Auth0", async () => {
    const expected = NextResponse.next();
    auth0Mock.middleware.mockResolvedValue(expected);
    const request = new NextRequest("https://iam-control-center.vercel.app/");

    const response = await middleware(request);

    expect(response).toBe(expected);
    expect(auth0Mock.middleware).toHaveBeenCalledOnce();
    expect(auth0Mock.middleware).toHaveBeenCalledWith(request);
  });
});
