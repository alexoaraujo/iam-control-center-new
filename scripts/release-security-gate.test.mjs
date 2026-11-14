import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decideSecurityGate } from "./release-security-gate.mjs";

const positive = {
  quality: "success", previewRequired: "true", preview: "success",
  syncAuth0: "success", auth0E2E: "success", auth0Enabled: "true",
  changedFiles: ["apps/web/src/lib/auth0.ts"],
};
test("passes only fully verified Preview and E2E for runtime changes", () => {
  assert.deepEqual(decideSecurityGate(positive), { pass: true, reason: "E2E_VERIFIED" });
});
test("fails closed on skipped, missing or failed security jobs even when quality passes", () => {
  const cases = [
    ["quality", "failure"],
    ["preview", "skipped"],
    ["preview", "failure"],
    ["syncAuth0", "skipped"],
    ["syncAuth0", "failure"],
    ["auth0E2E", "skipped"],
    ["auth0E2E", "failure"],
    ["auth0Enabled", "false"],
    ["previewRequired", "false"],
    ["previewRequired", ""],
  ];
  for (const [key, value] of cases) {
    assert.equal(decideSecurityGate({ ...positive, [key]: value }).pass, false, key);
  }
});
test("allows docs-only PR only after checking changed file paths independently", () => {
  const docs = { ...positive, previewRequired: "false", changedFiles: ["README.md", "docs/security/README.md"] };
  assert.deepEqual(decideSecurityGate(docs), { pass: true, reason: "DOCUMENTATION_ONLY" });
  for (const path of ["database/migrations/0001.sql", ".github/workflows/quality.yml",
    "scripts/ignore-build.mjs", "apps/web/src/page.tsx"]) {
    assert.equal(decideSecurityGate({ ...docs, changedFiles: [path] }).pass, false, path);
  }
});
test("refuses to call unknown scope a safe documentation PR", () => {
  for (const changedFiles of [[], null, [""], ["README.md", null]]) {
    assert.equal(decideSecurityGate({ ...positive, changedFiles }).pass, false);
  }
});
test("CI publishes a stable security-gate context after all four dependencies", () => {
  const yml = readFileSync(".github/workflows/quality.yml", "utf8");
  const job = yml.split("\n  security-gate:\n")[1];
  assert.ok(job);
  assert.ok(job.includes("name: security-gate"));
  assert.ok(job.includes("always()"));
  for (const name of ["quality", "preview-deployment", "sync-auth0-preview", "auth0-e2e"]) {
    assert.ok(job.includes(`- ${name}`));
  }
  assert.ok(job.includes("node scripts/release-security-gate.mjs"));
});
