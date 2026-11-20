import { describe, expect, it } from "vitest";
import { getPreviewE2ESessionConfig } from "./auth0-session";

const preview = {
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "feat/iam-api-rbac-lineage-20261110",
  AUTH0_E2E_SESSION_ABSOLUTE_SECONDS: "45",
};
describe("isolated Auth0 E2E session expiry configuration", () => {
  it("sets an explicit fixed expiry in PR #41 Preview only", () => {
    expect(getPreviewE2ESessionConfig(preview)).toEqual({
      absoluteDuration: 45, inactivityDuration: 45, rolling: false,
    });
  });
  it("preserves SDK defaults when no test TTL is configured", () => {
    expect(getPreviewE2ESessionConfig({})).toBeUndefined();
    expect(getPreviewE2ESessionConfig({ VERCEL_ENV: "production" })).toBeUndefined();
  });
  it.each([
    { ...preview, VERCEL_ENV: "production" },
    { ...preview, VERCEL_GIT_COMMIT_REF: "main" },
    { ...preview, VERCEL_GIT_COMMIT_REF: "another-preview-branch" },
    { ...preview, AUTH0_E2E_SESSION_ABSOLUTE_SECONDS: "0" },
    { ...preview, AUTH0_E2E_SESSION_ABSOLUTE_SECONDS: "39" },
    { ...preview, AUTH0_E2E_SESSION_ABSOLUTE_SECONDS: "181" },
    { ...preview, AUTH0_E2E_SESSION_ABSOLUTE_SECONDS: "45s" },
  ])("rejects an unsafe TTL scope or value: %j", (env) => {
    expect(() => getPreviewE2ESessionConfig(env)).toThrow();
  });
});
