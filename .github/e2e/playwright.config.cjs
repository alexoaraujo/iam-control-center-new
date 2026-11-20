const { defineConfig } = require("@playwright/test");

// Preflight already verifies that the callback domain belongs to the PR's
// exact branch/SHA. Do not execute PR41-only Neon writes or session TTL tests
// on an otherwise authorized identity-sync Preview (PR42).
const RBAC_BRANCH = "feat/iam-api-rbac-lineage-20261110";
const PR132_RBAC_BRANCH = "integration/peos-g1-g2-canonical-bun-20261118";
const IDENTITY_SYNC_BRANCH = "feat/auth0-neon-identity-sync-20261111";

function selectE2ETests(env) {
  const branch = env.E2E_CALLBACK_BRANCH;
  const rbacEnabled = env.E2E_RBAC_HTTP_ENABLED === "true";
  const identitySyncEnabled = env.E2E_IDENTITY_SYNC === "true";
  if ((branch === RBAC_BRANCH || branch === PR132_RBAC_BRANCH) !== rbacEnabled) {
    throw new Error("PR41/PR132 RBAC test enablement does not match verified callback branch");
  }
  if ((branch === IDENTITY_SYNC_BRANCH) !== identitySyncEnabled) {
    throw new Error("PR42 identity-sync test enablement does not match verified callback branch");
  }
  if (rbacEnabled && identitySyncEnabled) {
    throw new Error("PR41 RBAC and PR42 identity-sync must not run on the same Preview");
  }
  // Every approved callback-bound branch retains real Auth0 login/logout.
  // PR41 additionally requires the 45s expiry + grant/revoke Neon HTTP gate.
  if (branch === PR132_RBAC_BRANCH) {
    return ["auth0.spec.cjs", "auth0-rbac-pr132.spec.cjs"];
  }
  return rbacEnabled
    ? ["auth0.spec.cjs", "auth0-expiry.spec.cjs", "auth0-rbac.spec.cjs"]
    : ["auth0.spec.cjs"];
}

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: selectE2ETests(process.env),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  timeout: 90000,
  use: {
    baseURL: process.env.E2E_BASE_URL,
    headless: true,
    // Service workers can take ownership of navigations before Playwright routing.
    // Block them so every Preview request passes through the OIDC-scoped route.
    serviceWorkers: "block",
    actionTimeout: 15000,
    navigationTimeout: 60000,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
