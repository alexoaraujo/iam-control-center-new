import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Explicit file sets, not broad /database, /scripts, or workflow globs.
// Any additional path, rename source, or unknown scope defaults to Auth0 E2E.
const scopes = [
  {
    id: "canonical-manifests",
    files: [
      "database/offline/compare-migration-ledgers.mjs",
      "database/offline/compare-migration-ledgers.test.mjs",
      "database/offline/compare-schema-manifests.mjs",
      "database/offline/compare-schema-manifests.test.mjs",
      "database/scripts/schema-manifest.sql",
      "database/tests/run.sh",
      "docs/evidence/neon-canonical-drift-inventory-2026-11-12.md",
      "docs/operations/offline-canonical-schema-comparison.md",
    ],
    checks: [
      ["postgres-18-schema-contract", ".github/workflows/database-tests.yml"],
      ["postgres-18-source-schema-restore", ".github/workflows/database-tests.yml"],
      ["postgres-18-source-schema-restore-manifest", ".github/workflows/database-tests.yml"],
      ["postgres-18-independent-cluster-recovery", ".github/workflows/database-tests.yml"],
    ],
  },
  {
    id: "b2-environment-policy",
    // A changed script is required: a PR-created workflow alone is not proof.
    requiredChanged: ["scripts/iam-g1-b2-environment.sh",
      "scripts/test-iam-g1-b2-environment-policy.py"],
    files: [
      ".github/workflows/iam-g1-b2-policy-test.yml",
      "docs/operations/iam-g1-b2-custody-reconciliation.md",
      "scripts/iam-g1-b2-environment.sh",
      "scripts/test-iam-g1-b2-environment-policy.py",
    ],
    checks: [
      ["quality", ".github/workflows/quality.yml"],
      ["policy-regression", ".github/workflows/iam-g1-b2-policy-test.yml"],
    ],
  },
  {
    id: "b2-readback-policy",
    requiredChanged: ["scripts/iam-g1-b2-readback.py"],
    files: [
      ".github/workflows/iam-g1-b2-readback-regression.yml",
      ".github/workflows/iam-g1-b2-readback.yml",
      "docs/operations/iam-g1-b2-readback.md",
      "scripts/iam-g1-b2-readback.py",
    ],
    checks: [
      ["quality", ".github/workflows/quality.yml"],
      ["readback-regression", ".github/workflows/iam-g1-b2-readback-regression.yml"],
    ],
  },
];

const repository = "alexoaraujo/iam-control-center-new";
const exactSha = /^[a-f0-9]{40}$/;
const jobLink = /^https:\/\/github\.com\/alexoaraujo\/iam-control-center-new\/actions\/runs\/([0-9]+)\/job\/([0-9]+)$/;

function documentary(path) {
  return path.startsWith("docs/") || path === "README.md" || path === "SECURITY.md";
}

export function classifyOfflineScope(changedFiles) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0 ||
      changedFiles.some(file => typeof file !== "string" || !file ||
        file.trim() !== file || file.includes("\n")) ||
      new Set(changedFiles).size !== changedFiles.length) return null;
  for (const scope of scopes) {
    const allowed = new Set(scope.files);
    if (changedFiles.every(file => allowed.has(file)) &&
        changedFiles.some(file => !documentary(file)) &&
        (!scope.requiredChanged || scope.requiredChanged.some(file => changedFiles.includes(file)))) {
      return { id: scope.id, checks: scope.checks };
    }
  }
  return null;
}

// A check name alone can be spoofed by a different workflow; its job URL,
// Actions run path, repo, PR event, complete conclusion and SHA must all agree.
export async function verifyOfflineCheckRuns({ scope, checks, sha, loadRun }) {
  if (!scope || !exactSha.test(sha ?? "") || !Array.isArray(checks) ||
      typeof loadRun !== "function") return false;
  const runCache = new Map();
  for (const [name, path] of scope.checks) {
    let match = false;
    for (const check of checks) {
      if (check.name !== name || check.head_sha !== sha ||
          check.app?.slug !== "github-actions" || check.status !== "completed" ||
          check.conclusion !== "success") continue;
      const url = jobLink.exec(check.details_url ?? "");
      if (!url) continue;
      const runId = url[1];
      if (!runCache.has(runId)) {
        try { runCache.set(runId, await loadRun(runId)); }
        catch { runCache.set(runId, null); }
      }
      const run = runCache.get(runId);
      if (run?.path === path && run.head_sha === sha &&
          run.event === "pull_request" && run.status === "completed" &&
          run.conclusion === "success" &&
          run.repository?.full_name === repository) {
        match = true;
        break;
      }
    }
    if (!match) return false;
  }
  return true;
}

function api(path) {
  const content = execFileSync("gh", ["api", path], {
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(content);
}

function pages(endpoint, key) {
  const result = [];
  for (let page = 1; page <= 20; page += 1) {
    const data = api(endpoint + (endpoint.includes("?") ? "&" : "?") +
      "per_page=100&page=" + page);
    const items = key ? data[key] : data;
    if (!Array.isArray(items)) throw Error("Invalid paginated GitHub response");
    result.push(...items);
    if (items.length < 100) return result;
  }
  throw Error("GitHub result exceeds verification bounds");
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function attestOfflineScope(env) {
  const { REPOSITORY, PR_NUMBER, PR_BASE_SHA, PR_HEAD_SHA } = env;
  if (REPOSITORY !== repository || !/^[1-9][0-9]*$/.test(PR_NUMBER ?? "") ||
      !exactSha.test(PR_HEAD_SHA ?? "") || !exactSha.test(PR_BASE_SHA ?? "")) {
    throw Error("Invalid repository, PR or exact SHA");
  }
  const pr = api("repos/" + repository + "/pulls/" + PR_NUMBER);
  if (pr.head?.sha !== PR_HEAD_SHA || pr.base?.sha !== PR_BASE_SHA ||
      pr.head?.repo?.full_name !== repository) {
    throw Error("PR identity changed or untrusted head repository");
  }
  const fileRecords = pages("repos/" + repository + "/pulls/" + PR_NUMBER + "/files");
  // Never exempt renames or deleted scripts/workflows: the verifier must
  // not trust a self-modified test workflow whose underlying test disappeared.
  if (fileRecords.some(file =>
      (file.status === "removed" && !documentary(file.filename)) ||
      file.status === "renamed" ||
      file.previous_filename || typeof file.filename !== "string")) {
    return { verified: false, scope: "none" };
  }
  const changedFiles = fileRecords.map(file => file.filename);
  const scope = classifyOfflineScope(changedFiles);
  if (!scope) return { verified: false, scope: "none" };

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const checks = pages("repos/" + repository + "/commits/" +
      PR_HEAD_SHA + "/check-runs", "check_runs");
    if (await verifyOfflineCheckRuns({
      scope, checks, sha: PR_HEAD_SHA,
      loadRun: id => api("repos/" + repository + "/actions/runs/" + id),
    })) return { verified: true, scope: scope.id };
    if (attempt < 30) await pause(10000);
  }
  throw Error("Exact-SHA trusted offline workflow evidence is not SUCCESS");
}

async function main() {
  if (!process.env.GITHUB_OUTPUT || !process.env.GH_TOKEN) {
    throw Error("GitHub Actions token/output required");
  }
  const result = await attestOfflineScope(process.env);
  appendFileSync(process.env.GITHUB_OUTPUT,
    "verified=" + String(result.verified) + "\nscope=" + result.scope + "\n");
  console.log(result.verified
    ? "PASS: exact-SHA offline checks in validated GitHub Actions workflows (" +
      result.scope + ")"
    : "NOT_ELIGIBLE: scope requires normal authenticated security gate");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("::error::BLOCKED_OFFLINE_SECURITY_EVIDENCE_NOT_VERIFIED");
    process.exitCode = 1;
  });
}
