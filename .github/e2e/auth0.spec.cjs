const { test, expect } = require("@playwright/test");

test("Auth0 login, callback, session persistence and logout", async ({ page }) => {
  const baseURL = process.env.E2E_BASE_URL;
  const username = process.env.AUTH0_E2E_USERNAME;
  const password = process.env.AUTH0_E2E_PASSWORD;
  const trustedOidcToken = process.env.VERCEL_TRUSTED_OIDC_TOKEN;
  const callbackHost = process.env.E2E_CALLBACK_HOST;

  if (!baseURL || !username || !password || !trustedOidcToken || !callbackHost) {
    throw new Error("Required Auth0 E2E configuration is missing.");
  }
  // The host is an explicitly configured/allowlisted branch alias, never an
  // arbitrary URL or wildcard. It must equal the browser's verified origin.
  if (!/^iam-control-center-new-[a-z0-9-]+\.vercel\.app$/.test(callbackHost)) {
    throw new Error("Unexpected Auth0 callback Preview host.");
  }

  const previewHost = new URL(baseURL).hostname;
  if (previewHost !== callbackHost) {
    throw new Error("Auth0 E2E must start and return on the same Preview alias so transaction cookies remain same-origin.");
  }
  const trustedHosts = new Set([callbackHost]);
  let callbackRequestSeen = false;
  const context = page.context();
  const cdp = await context.newCDPSession(page);
  const trustedHeader = "x-vercel-trusted-oidc-idp-token";

  // CDP Fetch pauses every network request, including redirect hops. Playwright
  // route.continue() only modified the first request in the chain, leaving the
  // Auth0 callback without the Trusted Sources header.
  await cdp.send("Fetch.enable", {
    patterns: [{ urlPattern: "*", requestStage: "Request" }],
  });

  cdp.on("Fetch.requestPaused", async ({ requestId, request }) => {
    try {
      const requestUrl = new URL(request.url);
      const headers = Object.entries(request.headers)
        .filter(([name]) => name.toLowerCase() !== trustedHeader)
        .map(([name, value]) => ({ name, value: String(value) }));

      // The exact-SHA deployment URL starts the flow; the configured branch
      // alias receives the Auth0 callback. Trust only these two Preview hosts.
      const trustedHost = trustedHosts.has(requestUrl.hostname);
      if (trustedHost) {
        headers.push({ name: trustedHeader, value: trustedOidcToken });
      }
      if (
        requestUrl.hostname === callbackHost &&
        requestUrl.pathname.startsWith("/auth/callback")
      ) {
        callbackRequestSeen = true;
      }

      if (
        trustedHost ||
        requestUrl.hostname === "iam-control-center.us.auth0.com"
      ) {
        console.log(
          `CDP request: ${request.method} ${requestUrl.hostname}${requestUrl.pathname}; trusted header: ${trustedHost ? "attached" : "stripped"}`
        );
      }

      await cdp.send("Fetch.continueRequest", { requestId, headers });
    } catch {
      // Fail closed: never continue a request if host scoping or header
      // construction fails.
      await cdp.send("Fetch.failRequest", {
        requestId,
        errorReason: "Aborted",
      });
    }
  });

  // Runtime API must reject anonymous callers even when Vercel's
  // infrastructure protection is satisfied with the job-scoped OIDC token.
  // This token authenticates the CI runner to Vercel, never the app user.
  const anonymousAuthz = await fetch(new URL("/api/authorization/check", baseURL), {
    method: "POST",
    redirect: "manual",
    headers: {
      "x-vercel-trusted-oidc-idp-token": trustedOidcToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tenantId: "11111111-1111-4111-8111-111111111111",
      identityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      permission: "iam.tenant.read",
    }),
  });
  expect(anonymousAuthz.status, "Vercel OIDC must not substitute for an Auth0 user session").toBe(401);
  expect(await anonymousAuthz.json()).toEqual({ error: "unauthorized" });

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
  expect(
    callbackRequestSeen,
    "Auth0 callback must reach the configured Preview alias with the Trusted Sources header"
  ).toBe(true);

  // The authenticated session must survive a subsequent request.
  await page.reload();
  await expect(page.getByRole("status")).toHaveText("Acesso autenticado confirmado.");

  // PR #42: positive Auth0 -> Neon sync runs only on the isolated Preview.
  if (process.env.E2E_IDENTITY_SYNC === "true") {
    const postSync = () => page.evaluate(async () => {
      const response = await fetch("/api/identity/sync", {
        method: "POST", credentials: "same-origin", cache: "no-store",
      });
      return { status: response.status, payload: await response.json() };
    });
    const first = await postSync();
    expect(first.status).toBe(200);
    expect(first.payload.synchronized).toBe(true);
    expect(first.payload.id).toMatch(/^[0-9a-f-]{36}$/i);
    const replay = await postSync();
    expect(replay.status).toBe(200);
    expect(replay.payload.id).toBe(first.payload.id);
  }
  // The same Auth0 account selected for the positive RBAC gate must be
  // authenticated here. Check its subject using a reviewed SHA-256 digest;
  // never commit/log the raw user_id or user email.
  const expectedSubHash = process.env.AUTH0_E2E_EXPECTED_SUB_SHA256;
  if (!/^[a-f0-9]{64}$/.test(expectedSubHash || "")) {
    throw new Error("Missing reviewed E2E Auth0 subject digest");
  }
  const profile = await page.evaluate(async () => {
    const response = await fetch("/auth/profile", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) return { status: response.status, sub: null };
    const user = await response.json();
    return { status: response.status, sub: user?.sub };
  });
  expect(profile.status, "Auth0 profile must be available for the signed-in session").toBe(200);
  expect(typeof profile.sub).toBe("string");
  const actualHash = require("node:crypto").createHash("sha256")
    .update(profile.sub, "utf8").digest("hex");
  expect(actualHash, "Auth0 E2E login is not the reviewed test account").toBe(expectedSubHash);

  // An authenticated Auth0 session is NOT authorization by itself. The
  // Preview database has only synthetic identities (synthetic.invalid),
  // so this real Auth0 account must fail closed when requesting RBAC access.
  // No HMAC is ever accepted from the browser or exposed in the response.
  const authzResponse = await page.evaluate(async () => {
    const response = await fetch("/api/authorization/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        tenantId: "11111111-1111-4111-8111-111111111111",
        identityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        permission: "iam.tenant.read",
      }),
    });
    return {
      status: response.status,
      payload: await response.json(),
      cacheControl: response.headers.get("cache-control"),
    };
  });
  expect(authzResponse.status).toBe(403);
  expect(authzResponse.payload).toEqual({ allowed: false });
  expect(authzResponse.cacheControl).toBe("no-store");

  // Even a browser-supplied valid-looking signature cannot turn into
  // authority: the API contract rejects unexpected proof fields.
  const injected = await page.evaluate(async () => {
    const response = await fetch("/api/authorization/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        tenantId: "11111111-1111-4111-8111-111111111111",
        identityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        permission: "iam.tenant.read",
        signature: "f".repeat(64),
      }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(injected).toEqual({ status: 403, body: { allowed: false } });

  // Authenticated identity is not sufficient for tenant-scoped authorization.
  // These cases validate cross-tenant/identity denial and malformed inputs
  // with the real Auth0 session, Vercel Preview runtime and Neon RLS.
  const deniedCases = await page.evaluate(async () => {
    const base = {
      tenantId: "11111111-1111-4111-8111-111111111111",
      identityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      permission: "iam.tenant.read",
    };
    const variants = [
      ["cross-tenant", { ...base, tenantId: "22222222-2222-4222-8222-222222222222" }],
      ["cross-identity", { ...base, identityId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }],
      ["wrong-permission", { ...base, permission: "iam.tenant.admin" }],
      ["extra-context", { ...base, nonce: "f".repeat(32), expires: 9999999999 }],
      ["invalid-selector", { ...base, tenantId: "../tenant-b" }],
      ["oversized-body", { ...base, junk: "x".repeat(5000) }],
    ];
    return await Promise.all(variants.map(async ([name, body]) => {
      const response = await fetch("/api/authorization/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      return { name, status: response.status, payload: await response.json() };
    }));
  });
  expect(deniedCases).toHaveLength(6);
  for (const result of deniedCases) {
    expect(result.status, result.name).toBe(403);
    expect(result.payload, result.name).toEqual({ allowed: false });
  }

  // Logout returns to the app root, which is immediately redirected to
  // Auth0 by the Next.js proxy. Verify the login screen, not a transient URL.
  await page.goto("/auth/logout");
  await expect(page).toHaveURL(/iam-control-center\.us\.auth0\.com\/u\/login/, {
    timeout: 60000,
  });
  await expect(
    page.locator('input[name="username"], input[name="email"]').first()
  ).toBeVisible();

  // A fresh protected request must still require authentication after logout.
  await page.goto("/protected");
  await expect(page).toHaveURL(/iam-control-center\.us\.auth0\.com\/u\/login/, {
    timeout: 30000,
  });
  await expect(
    page.locator('input[name="username"], input[name="email"]').first()
  ).toBeVisible();

  await cdp.send("Fetch.disable");
  await cdp.detach();
});
