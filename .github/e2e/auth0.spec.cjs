const { test, expect } = require("@playwright/test");

test("Auth0 login, callback, session persistence and logout", async ({ page }) => {
  const baseURL = process.env.E2E_BASE_URL;
  const username = process.env.AUTH0_E2E_USERNAME;
  const password = process.env.AUTH0_E2E_PASSWORD;
  const trustedOidcToken = process.env.VERCEL_TRUSTED_OIDC_TOKEN;

  if (!baseURL || !username || !password || !trustedOidcToken) {
    throw new Error("Required Auth0 E2E configuration is missing.");
  }

  const previewHost = new URL(baseURL).hostname;
  const context = page.context();

  // Record only non-sensitive navigation metadata for Vercel hosts. This lets
  // CI distinguish an unexpected Preview alias from a missing route interception.
  page.on("request", (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.hostname.endsWith(".vercel.app")) {
      console.log(
        `Browser request: ${request.method()} ${requestUrl.hostname}${requestUrl.pathname}`
      );
    }
  });

  // Vercel Trusted Sources requires the OIDC header on every request to the
  // exact protected Preview origin, including the Auth0 callback navigation.
  // Never forward the token to Auth0 or to a different Vercel deployment.
  await context.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.hostname.endsWith(".vercel.app")) {
      console.log(
        `Playwright route: ${route.request().method()} ${requestUrl.hostname}${requestUrl.pathname}`
      );
    }

    if (requestUrl.hostname !== previewHost) {
      await route.continue();
      return;
    }

    // Fetch only this Preview request with the Trusted Sources token and do not
    // follow redirects in the API client. The browser receives the redirect,
    // then the next Preview navigation is intercepted independently. This keeps
    // the OIDC header off Auth0 and every other origin.
    const headers = {
      ...route.request().headers(),
      "x-vercel-trusted-oidc-idp-token": trustedOidcToken,
    };
    console.log(
      `Trusted Sources header attached: ${route.request().method()} ${requestUrl.pathname}`
    );
    const response = await route.fetch({ headers, maxRedirects: 0 });
    await route.fulfill({ response });
  });

  // Anonymous access must enter the Auth0 Authorization Code + PKCE flow.
  await page.goto("/protected");
  await expect(page).toHaveURL(/auth0\.com/);

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

  // Reaching the protected route with a server-confirmed authenticated status proves
  // the callback completed and the application session was issued.
  await expect(page).toHaveURL((url) => url.pathname === "/protected", { timeout: 60000 });
  await expect(page.getByRole("status")).toHaveText("Acesso autenticado confirmado.");

  // The authenticated session must survive a subsequent request.
  await page.reload();
  await expect(page.getByRole("status")).toHaveText("Acesso autenticado confirmado.");

  // Logout must clear the session; a subsequent protected request returns to Auth0.
  await page.goto("/auth/logout");
  await expect(page).toHaveURL((url) => url.origin === new URL(baseURL).origin, { timeout: 60000 });
  await page.goto("/protected");
  await expect(page).toHaveURL(/auth0\.com/, { timeout: 30000 });
});
