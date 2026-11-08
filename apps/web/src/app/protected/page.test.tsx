import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, redirect } = vi.hoisted(() => ({
  getSession: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("../../lib/auth0", () => ({
  auth0: { getSession },
}));

vi.mock("next/navigation", () => ({
  redirect,
}));

import ProtectedPage from "./page";

describe("protected page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redirect.mockImplementation((destination: string) => {
      throw new Error(`NEXT_REDIRECT:${destination}`);
    });
  });

  it("redirects anonymous requests to Auth0 login with a fixed return path", async () => {
    getSession.mockResolvedValue(null);

    await expect(ProtectedPage()).rejects.toThrow(
      "NEXT_REDIRECT:/auth/login?returnTo=%2Fprotected",
    );

    expect(getSession).toHaveBeenCalledOnce();
    expect(redirect).toHaveBeenCalledWith(
      "/auth/login?returnTo=%2Fprotected",
    );
  });

  it("renders the protected page when an Auth0 session exists", async () => {
    getSession.mockResolvedValue({
      user: { sub: "auth0|e2e-test-user" },
    });

    const page = await ProtectedPage();
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Área protegida");
    expect(html).toContain("Acesso autenticado confirmado.");
    expect(redirect).not.toHaveBeenCalled();
  });
});
