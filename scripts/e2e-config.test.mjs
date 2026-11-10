import { test } from "node:test";
import assert from "node:assert/strict";
import { validateE2EConfig } from "./e2e-config.mjs";
const env = { GITHUB_REPOSITORY: "owner/new", PR_HEAD_REPOSITORY: "owner/new", PR_HEAD_BRANCH: "review", E2E_CALLBACK_BRANCH: "review", E2E_CALLBACK_HOST: "preview.vercel.app", E2E_DEPLOYMENT_HOST: "preview.vercel.app", E2E_AUTH0_DOMAIN: "login.example.com", E2E_OIDC_AUDIENCE: "https://github.com/owner", E2E_OIDC_SUBJECT: "repo:owner/new:environment:Preview" };
test("accepts a configured repository without legacy names", () => assert.equal(validateE2EConfig(env), "https://preview.vercel.app"));
for (const [key, value] of Object.entries({ PR_HEAD_REPOSITORY: "fork/new", PR_HEAD_BRANCH: "other", E2E_DEPLOYMENT_HOST: "other.vercel.app", E2E_CALLBACK_HOST: "preview.vercel.app.evil.test", E2E_AUTH0_DOMAIN: "https://login.example.com", E2E_OIDC_AUDIENCE: "http://github.com/owner", E2E_OIDC_SUBJECT: "repo:owner/new:ref:main" })) {
 test(`rejects invalid ${key}`, () => assert.throws(() => validateE2EConfig({ ...env, [key]: value })));
}
test("rejects missing and multiline configuration", () => {
 for (const key of Object.keys(env)) {
  assert.throws(() => validateE2EConfig({ ...env, [key]: "" }));
  assert.throws(() => validateE2EConfig({ ...env, [key]: env[key] + "\nINJECT=value" }));
 }
});
