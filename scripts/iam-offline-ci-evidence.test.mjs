import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyOfflineScope, verifyOfflineCheckRuns } from "./iam-offline-ci-evidence.mjs";

const canonical = [
  "database/offline/compare-migration-ledgers.mjs",
  "database/offline/compare-migration-ledgers.test.mjs",
  "database/offline/compare-schema-manifests.mjs",
  "database/offline/compare-schema-manifests.test.mjs",
  "database/scripts/schema-manifest.sql",
  "database/tests/run.sh",
  "docs/evidence/neon-canonical-drift-inventory-2026-11-12.md",
  "docs/operations/offline-canonical-schema-comparison.md",
];
const b2Env = [
  ".github/workflows/iam-g1-b2-policy-test.yml",
  "docs/operations/iam-g1-b2-custody-reconciliation.md",
  "scripts/iam-g1-b2-environment.sh",
  "scripts/test-iam-g1-b2-environment-policy.py",
];
const b2Readback = [
  ".github/workflows/iam-g1-b2-readback-regression.yml",
  ".github/workflows/iam-g1-b2-readback.yml",
  "docs/operations/iam-g1-b2-readback.md",
  "scripts/iam-g1-b2-readback.py",
];
const sha = "a".repeat(40);
const repo = "alexoaraujo/iam-control-center-new";

test("recognizes exact, nonempty independently tested offline PR file sets", () => {
  assert.equal(classifyOfflineScope(canonical)?.id, "canonical-manifests");
  assert.equal(classifyOfflineScope(b2Env)?.id, "b2-environment-policy");
  assert.equal(classifyOfflineScope(b2Readback)?.id, "b2-readback-policy");
  assert.equal(classifyOfflineScope(["scripts/iam-g1-b2-readback.py"])?.id,
    "b2-readback-policy");
});

test("unknown, mixed, malformed and sensitive file sets always require Auth0", () => {
  const cases = [
    [], null, [""], ["docs/evidence/a.md"],
    ["README.md"], ["SECURITY.md"],
    [...canonical, "apps/web/src/lib/auth0.ts"],
    [...canonical, "database/migrations/0001.sql"],
    [...canonical, ".github/workflows/database-tests.yml"],
    [...canonical, "scripts/release-security-gate.mjs"],
    [...canonical, "scripts/iam-offline-ci-evidence.mjs"],
    [...canonical, ".github/workflows/quality.yml"],
    [...b2Env, "apps/web/src/proxy.ts"],
    [...b2Readback, "scripts/sync-auth0-e2e-preview.mjs"],
    [...b2Readback, "scripts/iam-g1-b2-readback-extra.py"],
    [...b2Readback, "scripts/iam-g1-b2-environment.sh"],
    ["database/tests/run.sh", "database/tests/runtime-rls-contract.sql"],
    ["database/offline/compare-schema-manifests.mjs", "README.md"],
    ["database/offline/compare-schema-manifests.mjs", "database/offline/compare-schema-manifests.mjs"],
    [null], [" database/tests/run.sh"], ["database/tests/run.sh\napps/web/src/proxy.ts"],
    [".github/workflows/iam-g1-b2-policy-test.yml"],
    [".github/workflows/iam-g1-b2-readback-regression.yml"],
  ];
  for (const files of cases) assert.equal(classifyOfflineScope(files), null,
    JSON.stringify(files));
});

function checked(name, runId = 123, overrides = {}) {
  return {
    name, head_sha: sha, app: { slug: "github-actions" },
    status: "completed", conclusion: "success",
    details_url: "https://github.com/" + repo + "/actions/runs/" + runId + "/job/456",
    ...overrides,
  };
}
function run(path, overrides = {}) {
  return {
    path, head_sha: sha, event: "pull_request", status: "completed",
    conclusion: "success", repository: { full_name: repo },
    pull_requests: [{ number: 98, head: { sha } }],
    ...overrides,
  };
}

test("trusts only matching completed SHA, PR, workflow path and GitHub Actions check", async () => {
  const scope = classifyOfflineScope(b2Env);
  const checks = [checked("quality", 122), checked("policy-regression", 123)];
  const good = id => run(id === "122"
    ? ".github/workflows/quality.yml" : ".github/workflows/iam-g1-b2-policy-test.yml");
  assert.equal(await verifyOfflineCheckRuns({
    scope, checks, sha, prNumber: 98, loadRun: good,
  }), true);
  const wrongCases = [
    { head_sha: "b".repeat(40) },
    { event: "workflow_dispatch" },
    { status: "in_progress" },
    // A failed parent workflow is acceptable if the exact check job succeeded.
    { pull_requests: [{ number: 99, head: { sha } }] },
    { pull_requests: [{ number: 98, head: { sha: "b".repeat(40) } }] },
    { pull_requests: [] },
    { path: ".github/workflows/quality.yml" },
    { repository: { full_name: "somewhere/else" } },
  ];
  for (const delta of wrongCases) {
    assert.equal(await verifyOfflineCheckRuns({
      scope, checks, sha, prNumber: 98, loadRun: id =>
        run(id === "122" ? ".github/workflows/quality.yml"
          : ".github/workflows/iam-g1-b2-policy-test.yml", delta),
    }), false, JSON.stringify(delta));
  }
  assert.equal(await verifyOfflineCheckRuns({
    scope, checks, sha, prNumber: 98,
    loadRun: id => run(id === "122" ? ".github/workflows/quality.yml"
      : ".github/workflows/iam-g1-b2-policy-test.yml", { conclusion: "failure" }),
  }), true, "parent CI can fail only because security-gate depends on this attestation");
  for (const delta of [
    { head_sha: "b".repeat(40) }, { conclusion: "skipped" },
    { app: { slug: "untrusted" } }, { status: "in_progress" },
    { details_url: "https://example.com/forged" },
  ]) {
    assert.equal(await verifyOfflineCheckRuns({
      scope, prNumber: 98, checks: [checked("quality", 122), checked("policy-regression", 123, delta)],
      sha, loadRun: good,
    }), false, JSON.stringify(delta));
  }
});

test("canonical comparison requires all four independent PostgreSQL 18 jobs", async () => {
  const scope = classifyOfflineScope(canonical);
  const checks = scope.checks.map(([name], i) => checked(name, 123 + i));
  const loadRun = () => run(".github/workflows/database-tests.yml");
  assert.equal(await verifyOfflineCheckRuns({ scope, checks, sha, prNumber: 98, loadRun }), true);
  for (let i = 0; i < checks.length; i++) {
    assert.equal(await verifyOfflineCheckRuns({
      scope, prNumber: 98, checks: checks.filter((_, j) => i !== j), sha, loadRun,
    }), false, "Missing independent PG18 job " + i);
  }
});

test("readback policy does not accept a similarly named job from an arbitrary workflow", async () => {
  const scope = classifyOfflineScope(b2Readback);
  const checks = [checked("quality", 124), checked("readback-regression", 125)];
  const quality = id => id === "124" ? ".github/workflows/quality.yml"
    : ".github/workflows/iam-g1-b2-readback-regression.yml";
  assert.equal(await verifyOfflineCheckRuns({
    scope, checks, sha, prNumber: 98, loadRun: id =>
      run(id === "124" ? ".github/workflows/quality.yml"
        : ".github/workflows/iam-g1-b2-readback.yml"),
  }), false);
  assert.equal(await verifyOfflineCheckRuns({
    scope, checks, sha, prNumber: 98, loadRun: id => run(quality(id)),
  }), true);
  assert.equal(await verifyOfflineCheckRuns({
    scope, prNumber: 98, checks: [checked("readback-regression", 125)],
    sha, loadRun: id => run(quality(id)),
  }), false, "PR-defined readback workflow cannot self-attest without quality");
});


test("B2 scopes require independent protected quality checks at same SHA", async () => {
  for (const [scopeFiles, externalName, workflow] of [
    [b2Env, "policy-regression", ".github/workflows/iam-g1-b2-policy-test.yml"],
    [b2Readback, "readback-regression", ".github/workflows/iam-g1-b2-readback-regression.yml"],
  ]) {
    const scope = classifyOfflineScope(scopeFiles);
    const runs = id => run(id === "126" ? ".github/workflows/quality.yml" : workflow);
    const full = [checked("quality", 126), checked(externalName, 127)];
    assert.equal(await verifyOfflineCheckRuns({ scope, checks: full, sha, prNumber: 98, loadRun: runs }), true);
    assert.equal(await verifyOfflineCheckRuns({
      scope, prNumber: 98, checks: full.slice(1), sha, loadRun: runs,
    }), false, "external PR-defined workflow must not self-attest");
    assert.equal(await verifyOfflineCheckRuns({
      scope, checks: full, sha, prNumber: 98, loadRun: id => run(id === "126" ? workflow : workflow),
    }), false, "spoofed quality check must not be accepted from external workflow");
  }
});

test("protected quality job actually executes synthetic B2 checks without private credentials", () => {
  const yml = readFileSync(".github/workflows/quality.yml", "utf8");
  const quality = yml.split("\n  quality:\n")[1]?.split("\n  preview-deployment:\n")[0];
  assert.ok(quality);
  assert.ok(quality.includes("Independently run synthetic B2 regressions from trusted CI"));
  assert.ok(quality.includes("bash -n scripts/iam-g1-b2-environment.sh"));
  assert.ok(quality.includes("python3 scripts/test-iam-g1-b2-environment-policy.py"));
  assert.ok(quality.includes("python3 scripts/iam-g1-b2-readback.py --self-test"));
  assert.ok(!quality.includes("secrets."));
});
