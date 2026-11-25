/**
 * PEOS isolated reconciliation contract for PR #41 + PR #70.
 *
 * Keep the stricter PR #41 Preview/Auth0 rules and the exact-SHA Production
 * predicate already identical to PR #70. This is a synthetic, offline contract:
 * it never authenticates to Auth0 or connects to Vercel/Neon.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { isApprovedProductionRelease } from "./production-deploy-approval.mjs";
import { shouldBuild, requiresAuthenticatedPreview } from "./vercel-ignore-build.mjs";
import { decideSecurityGate } from "./release-security-gate.mjs";

const releaseSha = "a".repeat(40);
const otherSha = "b".repeat(40);

test("PR41+PR70: Production remains denied unless branch and complete SHA both match", () => {
  const cases = [
    { ref: "main", commitSha: releaseSha, approvedSha: releaseSha, expected: true },
    { ref: "main", commitSha: releaseSha, approvedSha: otherSha, expected: false },
    { ref: "feature", commitSha: releaseSha, approvedSha: releaseSha, expected: false },
    { ref: "", commitSha: releaseSha, approvedSha: releaseSha, expected: false },
    { ref: "main", commitSha: releaseSha, approvedSha: "", expected: false },
    { ref: "main", commitSha: releaseSha, approvedSha: null, expected: false },
    { ref: "main", commitSha: releaseSha.slice(0, -1), approvedSha: releaseSha, expected: false },
    { ref: "main", commitSha: releaseSha.toUpperCase(), approvedSha: releaseSha, expected: false },
  ];
  for (const { expected, ...args } of cases) {
    assert.equal(isApprovedProductionRelease(args), expected, JSON.stringify(args));
    assert.equal(shouldBuild({
      environment: "production", currentSha: args.commitSha,
      approvedProductionSha: args.approvedSha, gitRef: args.ref,
      changedFiles: ["apps/web/src/lib/authorization.ts"],
    }), expected);
  }
});

test("PR41+PR70: exact-SHA Preview must not be skipped for non-documentation security changes", () => {
  for (const file of [
    "database/migrations/0003_set_tenant_context_search_path.sql",
    ".github/workflows/quality.yml",
    "scripts/sync-auth0-e2e-preview.mjs",
    "scripts/vercel-ignore-build.mjs",
    "scripts/production-deploy-approval.mjs",
    "apps/web/src/lib/authorization.ts",
  ]) {
    assert.equal(shouldBuild({
      environment: "preview", previousSha: otherSha, currentSha: releaseSha,
      changedFiles: [file],
    }), true, file);
  }
});

test("PR41+PR70: security-gate never treats skipped/failed Auth0 E2E as a pass", () => {
  const files = ["database/migrations/0003_set_tenant_context_search_path.sql"];
  const valid = {
    quality: "success", previewRequired: "true",
    preview: "success", auth0Enabled: "true",
    syncAuth0: "success", auth0E2E: "success",
    docsPreview: "skipped", changedFiles: files,
  };
  assert.deepEqual(decideSecurityGate(valid), { pass: true, reason: "E2E_VERIFIED" });
  for (const [key, value] of [
    ["auth0E2E", "skipped"],
    ["auth0E2E", "failure"],
    ["syncAuth0", "skipped"],
    ["preview", "skipped"],
    ["previewRequired", "false"],
  ]) {
    assert.equal(decideSecurityGate({ ...valid, [key]: value }).pass, false, key);
  }
});

test("PR41+PR70: docs-only changes need real documentation Preview evidence", () => {
  const changedFiles = ["docs/operations/release-runbook.md"];
  assert.equal(requiresAuthenticatedPreview({
    previousSha: otherSha, currentSha: releaseSha, changedFiles,
  }), false);
  assert.equal(shouldBuild({ environment: "preview", currentSha: releaseSha }), true);
  const evidence = {
    quality: "success", previewRequired: "false", preview: "skipped",
    auth0Enabled: "false", syncAuth0: "skipped", auth0E2E: "skipped",
    docsPreview: "success", changedFiles,
  };
  assert.deepEqual(decideSecurityGate(evidence), {
    pass: true, reason: "DOCUMENTATION_ONLY_PREVIEW_VERIFIED",
  });
  assert.equal(decideSecurityGate({ ...evidence, docsPreview: "failure" }).pass, false);
  assert.equal(decideSecurityGate({ ...evidence, docsPreview: "skipped" }).pass, false);
});
