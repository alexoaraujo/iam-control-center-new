import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decideSecurityGate } from "./release-security-gate.mjs";

const positive = {
  quality: "success", previewRequired: "true", preview: "success",
  syncAuth0: "success", auth0E2E: "success", auth0Enabled: "true", docsPreview: "success",
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
  assert.deepEqual(decideSecurityGate(docs), { pass: true, reason: "DOCUMENTATION_ONLY_PREVIEW_VERIFIED" });
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

test("docs-only scope requires positive exact-SHA Preview evidence, never SKIPPED/missing/failure", () => {
  for (const file of ["README.md", "SECURITY.md", "docs/operations/recovery.md"]) {
    const docs = { ...positive, previewRequired: "false", changedFiles: [file] };
    assert.deepEqual(decideSecurityGate(docs), { pass: true, reason: "DOCUMENTATION_ONLY_PREVIEW_VERIFIED" }, file);
    for (const docsPreview of ["failure", "skipped", "cancelled", "timed_out", "neutral", null, undefined, ""]) {
      assert.deepEqual(
        decideSecurityGate({ ...docs, docsPreview }),
        { pass: false, reason: "DOCS_PREVIEW_NOT_SUCCESS" },
        String(docsPreview) + ":" + file,
      );
    }
  }
});
test("a successful docs Preview never exempts mixed or sensitive changes from Auth0 E2E", () => {
  const docs = { ...positive, previewRequired: "false", changedFiles: ["docs/security.md", "apps/web/src/proxy.ts"] };
  const forbidden = ["apps/web/src/lib/auth0.ts", "database/migrations/0001.sql",
    ".github/workflows/quality.yml", ".github/workflows/docs-preview-gate.yml",
    "scripts/release-security-gate.mjs", "SCAFFOLD-MANIFEST.json",
    ".github/PULL_REQUEST_TEMPLATE.md"];
  for (const path of forbidden) {
    assert.equal(decideSecurityGate({ ...docs, changedFiles: ["README.md", path] }).pass, false, path);
  }
  assert.equal(decideSecurityGate(docs).pass, false);
  assert.equal(decideSecurityGate({ ...docs, previewRequired: "true", auth0E2E: "skipped" }).pass, false);
  assert.deepEqual(
    decideSecurityGate({ ...positive, docsPreview: "missing" }),
    { pass: true, reason: "E2E_VERIFIED" },
  );
});
test("trusted docs evidence is in the required security-gate dependency chain", () => {
  const workflow = readFileSync(".github/workflows/quality.yml", "utf8");
  const bridge = workflow.split("\n  docs-preview-evidence:\n")[1]?.split("\n  security-gate:\n")[0];
  const gate = workflow.split("\n  security-gate:\n")[1];
  assert.ok(bridge);
  assert.ok(bridge.includes("name: docs-preview-evidence"));
  assert.ok(bridge.includes("actions: read"));
  assert.ok(bridge.includes("checks: read"));
  assert.ok(bridge.includes("No checkout or PR-controlled code executes"));
  assert.ok(bridge.includes('.name == "docs-preview-gate"'));
  assert.ok(bridge.includes('.head_sha == $sha'));
  assert.ok(bridge.includes('.app.slug == "github-actions"'));
  assert.ok(bridge.includes('.path == ".github/workflows/docs-preview-gate.yml"'));
  assert.ok(bridge.includes("run_status="));
  assert.ok(bridge.includes("run_conclusion="));
  assert.ok(bridge.includes('if [[ "${run_conclusion}" != success ]]'));
  for (const status of ["completed", "queued", "in_progress", "pending", "waiting", "requested"]) {
    assert.ok(bridge.includes(status), status);
  }
  assert.ok(bridge.includes("README.md|SECURITY.md|docs/*"));
  assert.ok(gate.includes("      - docs-preview-evidence"));
  assert.ok(gate.includes("DOCS_PREVIEW_RESULT: ${{ needs.docs-preview-evidence.result }}"));
  assert.ok(gate.includes("node scripts/release-security-gate.mjs"));
});
test("the documentation Preview workflow includes every docs-only security scope", () => {
  const workflow = readFileSync(".github/workflows/docs-preview-gate.yml", "utf8");
  for (const path of ['"README.md"', '"SECURITY.md"', '"docs/**"']) {
    assert.ok(workflow.includes(path), path);
  }
  assert.ok(workflow.includes("README.md|SECURITY.md|docs/*) return 0"));
  assert.ok(workflow.includes("for sample in README.md SECURITY.md docs/operations/roadmap.md; do"));
  const denyLine = workflow.split("\n").find((line) => line.includes("for sample in apps/web"));
  for (const path of [".github/workflows/docs-preview-gate.yml", "SCAFFOLD-MANIFEST.json", ".github/PULL_REQUEST_TEMPLATE.md"]) {
    assert.ok(denyLine?.includes(path), `Sensitive path must fail docs-only classification: ${path}`);
  }
});
