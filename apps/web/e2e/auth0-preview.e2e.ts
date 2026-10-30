import { expect, test } from "@playwright/test";

const username = process.env.IAM_TEST_USER;
const password = process.env.IAM_TEST_USER_PASSWORD;

test("Auth0 login, callback, protected session and logout", async ({ page }) => {
  expect(username, "IAM_TEST_USER must be supplied as a workflow input").toBeTruthy();
  expect(password, "IAM_TEST_USER_PASSWORD must be configured as a Preview secret").toBeTruthy();

  let callbackRequested = false;
  page.on("request", (request) => {
    try {
      callbackRequested ||= new URL(request.url()).pathname === "/auth/callback";
    } catch {
      // Ignore non-URL request values; never print request details.
    }
  });

  await page.goto("/auth/login?returnTo=%2Fprotected");
  await expect(page).toHaveURL(/https:\/\/[^/]*auth0\.com\//, { timeout: 30_000 });

  const usernameField = page.locator('input[name="username"], input[name="email"]').first();
  await usernameField.fill(username!);
  await page.locator('input[name="password"]').fill(password!);
  await page.getByRole("button", { name: /continue|log in|sign in|entrar/i }).click();

  await expect(page).toHaveURL(/\/protected(?:$|[?#])/, { timeout: 60_000 });
  await expect(page.getByTestId("protected-page")).toBeVisible();
  expect(callbackRequested, "The Auth0 callback endpoint must be reached").toBe(true);

  const authenticated = await page.request.get("/api/e2e/session");
  expect(authenticated.ok()).toBe(true);
  await expect(authenticated.json()).resolves.toEqual({
    authenticated: true,
    subjectPresent: true,
  });

  await page.goto("/auth/logout?returnTo=%2F");
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });

  const anonymous = await page.request.get("/api/e2e/session");
  expect(anonymous.ok()).toBe(true);
  await expect(anonymous.json()).resolves.toEqual({
    authenticated: false,
    subjectPresent: false,
  });
});

test("anonymous visitor cannot access the protected page", async ({ page }) => {
  await page.goto("/protected");
  await expect(page).toHaveURL(/https:\/\/[^/]*auth0\.com\//, { timeout: 30_000 });
});

test("invalid identity is rejected without using the real test account", async ({ page }) => {
  const invalidIdentity = `iam-e2e-invalid-${process.env.GITHUB_RUN_ID ?? "local"}@example.invalid`;

  await page.goto("/auth/login?returnTo=%2Fprotected");
  await expect(page).toHaveURL(/https:\/\/[^/]*auth0\.com\//, { timeout: 30_000 });

  const usernameField = page.locator('input[name="username"], input[name="email"]').first();
  await usernameField.fill(invalidIdentity);
  await page.locator('input[name="password"]').fill("This-is-not-a-valid-password-123!");
  await page.getByRole("button", { name: /continue|log in|sign in|entrar/i }).click();

  await expect(page.locator('[role="alert"], [data-testid*="error"]').first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page).not.toHaveURL(/\/protected(?:$|[?#])/);
});
