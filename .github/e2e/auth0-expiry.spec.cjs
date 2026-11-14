const { test, expect } = require("@playwright/test");

// This test deliberately waits for the real app-session absolute TTL configured
// ONLY on the PR #41 Vercel Preview branch. It does not fake browser time,
// clear cookies manually, or pretend that logout proves session expiration.
test("Auth0 Preview absolute application-session expiry denies subsequent API access", async ({ page }) => {
  test.setTimeout(150000);
  const host = process.env.E2E_CALLBACK_HOST;
  const baseURL = process.env.E2E_BASE_URL;
  const token = process.env.VERCEL_TRUSTED_OIDC_TOKEN;
  const username = process.env.AUTH0_E2E_USERNAME;
  const password = process.env.AUTH0_E2E_PASSWORD;
  const ttl = Number(process.env.AUTH0_E2E_SESSION_ABSOLUTE_SECONDS);
  if (!host || !baseURL || !token || !username || !password ||
      host !== new URL(baseURL).hostname ||
      !/^iam-control-center-new-[a-z0-9-]+\.vercel\.app$/.test(host) ||
      ttl !== 45) {
    throw new Error("PR #41 Preview session expiry inputs are absent or not reviewed");
  }

  const trustedHeader = "x-vercel-trusted-oidc-idp-token";
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  cdp.on("Fetch.requestPaused", async ({ requestId, request }) => {
    try {
      const url = new URL(request.url);
      const headers = Object.entries(request.headers)
        .filter(([name]) => name.toLowerCase() !== trustedHeader)
        .map(([name, value]) => ({ name, value: String(value) }));
      // Vercel Trusted Sources only; NEVER forward an OIDC token to Auth0.
      if (url.hostname === host) {
        headers.push({ name: trustedHeader, value: token });
      }
      await cdp.send("Fetch.continueRequest", { requestId, headers });
    } catch {
      await cdp.send("Fetch.failRequest", { requestId, errorReason: "Aborted" }).catch(() => {});
    }
  });

  await page.goto("/protected");
  await expect(page).toHaveURL(/iam-control-center\.us\.auth0\.com/);
  const identifier = page.locator('input[name="username"], input[name="email"]').first();
  await expect(identifier).toBeVisible();
  await identifier.fill(username);
  const passwordInput = page.locator('input[name="password"]');
  if (!(await passwordInput.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: /continue/i }).first().click();
  }
  await expect(passwordInput).toBeVisible();
  await passwordInput.fill(password);
  await page.getByRole("button", { name: /continue|log in|sign in/i }).last().click();

  await expect(page).toHaveURL((url) => url.pathname === "/protected", { timeout: 60000 });
  await expect(page.getByRole("status")).toHaveText("Acesso autenticado confirmado.");

  // A real authenticated session reaches authorization but remains denied for
  // this synthetic tenant. Absence of a session instead returns HTTP 401.
  const selector = {
    tenantId: "11111111-1111-4111-8111-111111111111",
    identityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    permission: "iam.tenant.read",
  };
  async function permissionResponse() {
    return await page.evaluate(async (body) => {
      const response = await fetch("/api/authorization/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      return { status: response.status, payload: await response.json() };
    }, selector);
  }
  expect(await permissionResponse()).toEqual({ status: 403, payload: { allowed: false } });

  // Wait longer than the SDK's absolute TTL; unlike rolling session tests this
  // cannot be extended by periodic middleware touches (rolling=false).
  await page.waitForTimeout((ttl + 12) * 1000);
  expect(await permissionResponse()).toEqual({ status: 401, payload: { error: "unauthorized" } });
  console.log("PASS: real 45-second Preview app-session TTL expired and API rejected the old session");

  await cdp.send("Fetch.disable");
  await cdp.detach();
});
