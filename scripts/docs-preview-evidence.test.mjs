import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const sha = "a".repeat(40);
const workflow = readFileSync(".github/workflows/quality.yml", "utf8");
const job = workflow.split("\n  docs-preview-evidence:\n")[1]?.split("\n  security-gate:\n")[0];
assert.ok(job, "docs-preview-evidence job must exist");
const shellBlock = job.split("\n        run: |\n")[1];
assert.ok(shellBlock, "docs-preview evidence must be an inline, trusted workflow step");
const shell = shellBlock.split("\n").map(line => line.startsWith("          ") ? line.slice(10) : line).join("\n");

const check = ({ conclusion = "success", head = sha, workflowApp = "github-actions",
  details = "https://github.com/alexoaraujo/iam-control-center-new/actions/runs/123/job/456",
  status = "completed" } = {}) => ({
  check_runs: [{
    id: 456, name: "docs-preview-gate", head_sha: head,
    app: { slug: workflowApp }, status, conclusion, details_url: details,
  }],
});
const run = ({ head = sha, path = ".github/workflows/docs-preview-gate.yml",
  conclusion = "success" } = {}) => ({
  id: 123, path, head_sha: head, event: "pull_request", conclusion,
});

function runEvidence({ files = ["README.md"], checks = check(), workflowRun = run(),
  sourceRepo = "alexoaraujo/iam-control-center-new" } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "iam-docs-bridge-"));
  try {
    const fakeGh = join(directory, "gh");
    writeFileSync(fakeGh, String.raw`#!/bin/sh
case "$*" in
  *"/pulls/"*"/files?per_page=100"*) cat "$MOCK_FILES" ;;
  *"/check-runs?per_page=100"*) cat "$MOCK_CHECKS" ;;
  *"/actions/runs/"*) cat "$MOCK_RUN" ;;
  *) exit 44 ;;
esac
`);
    chmodSync(fakeGh, 0o755);
    const filesPath = join(directory, "files");
    const checksPath = join(directory, "checks");
    const runPath = join(directory, "run");
    writeFileSync(filesPath, files.join("\n") + "\n");
    writeFileSync(checksPath, JSON.stringify(checks));
    writeFileSync(runPath, JSON.stringify(workflowRun));
    const result = spawnSync("bash", ["-c", shell], {
      encoding: "utf8",
      timeout: 10000,
      env: {
        ...process.env,
        PATH: directory + ":" + process.env.PATH,
        GH_TOKEN: "inert-test-token",
        REPOSITORY: "alexoaraujo/iam-control-center-new",
        PR_NUMBER: "88",
        PR_HEAD_SHA: sha,
        PR_HEAD_REPOSITORY: sourceRepo,
        DOCS_PREVIEW_POLL_ATTEMPTS: "2",
        DOCS_PREVIEW_POLL_SECONDS: "0",
        MOCK_FILES: filesPath,
        MOCK_CHECKS: checksPath,
        MOCK_RUN: runPath,
      },
    });
    assert.equal(result.error, undefined, String(result.error));
    return { status: result.status, output: result.stdout + "\n" + result.stderr };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("docs-only README and SECURITY policy require successful trusted docs workflow", () => {
  for (const files of [["README.md"], ["docs/operations/a.md"], ["SECURITY.md"]]) {
    const result = runEvidence({ files });
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /PASS: verified docs-preview-gate SUCCESS/);
  }
});

test("failed, skipped, cancelled and missing docs checks must block", () => {
  for (const conclusion of ["failure", "skipped", "cancelled", "neutral", "timed_out"]) {
    const result = runEvidence({ checks: check({ conclusion }) });
    assert.notEqual(result.status, 0, conclusion + ": " + result.output);
    assert.match(result.output, /not SUCCESS/);
  }
  const missing = runEvidence({ checks: { check_runs: [] } });
  assert.notEqual(missing.status, 0);
  assert.match(missing.output, /absent or timed out/);
});

test("rejects successful checks from a different SHA, application or workflow", () => {
  for (const options of [{ head: "b".repeat(40) }, { workflowApp: "unknown-app" }]) {
    const result = runEvidence({ checks: check(options) });
    assert.notEqual(result.status, 0);
  }
  const wrongPath = runEvidence({ workflowRun: run({ path: ".github/workflows/quality.yml" }) });
  assert.notEqual(wrongPath.status, 0);
  assert.match(wrongPath.output, /approved docs workflow and SHA/);
  const wrongRunSha = runEvidence({ workflowRun: run({ head: "b".repeat(40) }) });
  assert.notEqual(wrongRunSha.status, 0);
  const wrongUrl = runEvidence({ checks: check({ details: "https://example.org/not-a-github-run" }) });
  assert.notEqual(wrongUrl.status, 0);
});

test("code, SQL or workflow changes skip only the docs bridge, not the E2E security gate", () => {
  for (const path of ["apps/web/src/proxy.ts", "database/migrations/0001.sql",
    ".github/workflows/quality.yml", ".github/workflows/docs-preview-gate.yml",
    "SCAFFOLD-MANIFEST.json"]) {
    const result = runEvidence({ files: ["README.md", path], checks: { check_runs: [] } });
    assert.equal(result.status, 0, path + ": " + result.output);
    assert.match(result.output, /NOT_REQUIRED/);
  }
});

test("forked PRs cannot use the documentation exemption", () => {
  const result = runEvidence({ sourceRepo: "untrusted/repository" });
  assert.notEqual(result.status, 0);
  assert.match(result.output, /same-repository PR/);
});
