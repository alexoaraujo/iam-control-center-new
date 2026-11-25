import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { hasBuildRelevantChanges, shouldBuild, requiresAuthenticatedPreview } from "./vercel-ignore-build.mjs";
import { decideSecurityGate } from "./release-security-gate.mjs";

test("docs-only changes skip authenticated E2E, not the deployment", () => {
  assert.equal(
    requiresAuthenticatedPreview({
      previousSha: "base",
      currentSha: "head",
      changedFiles: ["README.md", "docs/architecture/overview.md"],
    }),
    false,
  );
});

test("builds Preview when the Auth0 E2E harness changes", () => {
  assert.equal(
    hasBuildRelevantChanges([".github/e2e/auth0.spec.cjs"]),
    true,
  );
});

test("builds Preview when the Auth0 CI workflow changes", () => {
  assert.equal(
    hasBuildRelevantChanges([".github/workflows/quality.yml"]),
    true,
  );
});

test("builds Preview when web application code changes", () => {
  assert.equal(
    requiresAuthenticatedPreview({
      previousSha: "base",
      currentSha: "head",
      changedFiles: ["apps/web/src/app/page.tsx"],
    }),
    true,
  );
});

test("builds Preview when shared dependencies or workspace config changes", () => {
  assert.equal(
    hasBuildRelevantChanges(["pnpm-lock.yaml"]),
    true,
  );
  assert.equal(
    hasBuildRelevantChanges(["packages/iam-contracts/src/index.ts"]),
    true,
  );
});

test("denies any unapproved Production Git push, including docs-only changes", () => {
  assert.equal(
    shouldBuild({
      environment: "production", gitRef: "main", currentSha: "a".repeat(40),
      changedFiles: ["docs/only.md"],
    }),
    false,
  );
});

test("permits Production only for an exact reviewed 40-hex SHA on main", () => {
  const sha = "a".repeat(40);
  assert.equal(
    shouldBuild({ environment: "production", gitRef: "main", currentSha: sha,
      approvedProductionSha: sha, changedFiles: [] }),
    true,
  );
  for (const input of [
    { currentSha: "b".repeat(40), approvedProductionSha: sha, gitRef: "main" },
    { currentSha: sha, approvedProductionSha: "b".repeat(40), gitRef: "main" },
    { currentSha: sha, approvedProductionSha: sha, gitRef: "feature" },
    { currentSha: sha, approvedProductionSha: sha, gitRef: "" },
    { currentSha: sha, approvedProductionSha: "a".repeat(39), gitRef: "main" },
    { currentSha: "a".repeat(39), approvedProductionSha: sha, gitRef: "main" },
  ]) {
    assert.equal(shouldBuild({ environment: "production", ...input, changedFiles: ["apps/web/src/app/page.tsx"] }), false);
  }
});

test("release approval does not bypass authenticated Preview classification", () => {
  const sha = "a".repeat(40);
  assert.equal(requiresAuthenticatedPreview({ previousSha: "old",
    currentSha: sha, approvedProductionSha: sha, gitRef: "main",
    changedFiles: ["docs/only.md"] }), false);
  assert.equal(requiresAuthenticatedPreview({ previousSha: "old",
    currentSha: sha, approvedProductionSha: sha, gitRef: "main",
    changedFiles: ["apps/web/src/app/page.tsx"] }), true);
});

test("fails closed when commit metadata is missing", () => {
  assert.equal(
    requiresAuthenticatedPreview({
      previousSha: "",
      currentSha: "head",
      changedFiles: ["docs/only.md"],
    }),
    true,
  );
});

test("builds Preview when integration validation scripts change", () => {
  assert.equal(hasBuildRelevantChanges(["scripts/e2e-config.mjs"]), true);
});

test("builds an exact-SHA Preview for a main-sync merge carrying PR application changes", () => {
  assert.equal(
    requiresAuthenticatedPreview({
      previousSha: "previous-feature",
      currentSha: "merged-feature",
      // A Vercel incremental diff sees only the merged main's database changes.
      changedFiles: [".github/workflows/database-tests.yml", "database/scripts/roles.sql"],
      // The second merge parent is main, which does not contain the PR's app code.
      mergeParentChangedFiles: ["apps/web/src/lib/authorization.ts", ".github/e2e/auth0-rbac.spec.cjs"],
    }),
    true,
  );
});

test("SQL inherited through a main-sync merge must trigger exact-SHA Preview", () => {
  assert.equal(
    requiresAuthenticatedPreview({
      previousSha: "previous-feature",
      currentSha: "merged-feature",
      changedFiles: ["database/scripts/schema-manifest.sql"],
      mergeParentChangedFiles: ["docs/operations/runbook.md"],
    }),
    true,
  );
});

test("documentation-only main-sync merges omit authenticated E2E only", () => {
  assert.equal(
    requiresAuthenticatedPreview({
      previousSha: "previous-feature",
      currentSha: "merged-feature",
      changedFiles: ["docs/operations/runbook.md"],
      mergeParentChangedFiles: ["README.md", "SECURITY.md"],
    }),
    false,
  );
});

test("redeploying the same Preview SHA never ignores updated environment settings", () => {
  assert.equal(
    requiresAuthenticatedPreview({
      previousSha: "35dd97edd08a92bb4dbc1b1a9c02e5a3c11627d4",
      currentSha: "35dd97edd08a92bb4dbc1b1a9c02e5a3c11627d4",
      changedFiles: [],
      mergeParentChangedFiles: [],
    }),
    true,
  );
});

test("Preview impact classification and security-gate agree for SQL, workflows and unknown changes", () => {
  const nonDocs = [
    "database/migrations/0003_set_tenant_context_search_path.sql",
    "database/scripts/schema-manifest.sql",
    ".github/workflows/database-tests.yml",
    ".github/workflows/quality.yml",
    ".github/PULL_REQUEST_TEMPLATE.md",
    "SCAFFOLD-MANIFEST.json",
    "apps/web/src/lib/authorization.ts",
    "scripts/vercel-ignore-build.mjs",
    ".env.example",
    "new-security-policy.json",
  ];
  for (const file of nonDocs) {
    const preview = requiresAuthenticatedPreview({ previousSha: "before", currentSha: "after",
      changedFiles: [file],
    });
    assert.equal(preview, true, file);
    assert.equal(hasBuildRelevantChanges([file]), true, file);
    const gateInputs = {
      quality: "success", previewRequired: String(preview),
      preview: "success", auth0Enabled: "true", syncAuth0: "success",
      auth0E2E: "success", docsPreview: "skipped", changedFiles: [file],
    };
    assert.deepEqual(decideSecurityGate(gateInputs), { pass: true, reason: "E2E_VERIFIED" }, file);
    for (const [name, value] of [["preview", "skipped"], ["syncAuth0", "failure"],
      ["auth0E2E", "skipped"], ["previewRequired", "false"]]) {
      assert.equal(decideSecurityGate({ ...gateInputs, [name]: value }).pass, false, file + ":" + name);
    }
  }
});

test("docs-only scopes require trusted docs Preview evidence, not Auth0 E2E", () => {
  for (const file of ["README.md", "SECURITY.md", "docs/operations/runbook.md"]) {
    const preview = requiresAuthenticatedPreview({ previousSha: "before", currentSha: "after",
      changedFiles: [file],
    });
    assert.equal(preview, false, file);
    assert.deepEqual(decideSecurityGate({
      quality: "success", previewRequired: String(preview),
      preview: "skipped", auth0Enabled: "false", syncAuth0: "skipped",
      auth0E2E: "skipped", docsPreview: "success", changedFiles: [file],
    }), { pass: true, reason: "DOCUMENTATION_ONLY_PREVIEW_VERIFIED" }, file);
    assert.equal(decideSecurityGate({
      quality: "success", previewRequired: "false",
      docsPreview: "failure", changedFiles: [file],
    }).pass, false);
  }
});

test("no/invalid diff cannot suppress a required Preview", () => {
  assert.equal(requiresAuthenticatedPreview({ previousSha: "before", currentSha: "after",
    changedFiles: [], mergeParentChangedFiles: [],
  }), true);
  assert.equal(hasBuildRelevantChanges([""]), true);
  assert.equal(hasBuildRelevantChanges(["docs/runbook.md", "database/migrations/003.sql"]), true);
});

test("unknown Git diff metadata builds Preview instead of suppressing evidence", () => {
  for (const changedFiles of [undefined, null, "docs/only.md", { "0": "docs/only.md" }]) {
    assert.equal(requiresAuthenticatedPreview({ previousSha: "base", currentSha: "head",
      changedFiles,
    }), true);
  }
  for (const mergeParentChangedFiles of [null, "docs/only.md", { "0": "docs/only.md" }]) {
    assert.equal(requiresAuthenticatedPreview({ previousSha: "base", currentSha: "head",
      changedFiles: ["docs/only.md"], mergeParentChangedFiles,
    }), true);
  }
});

test("Preview preserves deleted source paths across code-to-doc renames", (t) => {
  const root = mkdtempSync(join(tmpdir(), "iam-preview-rename-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  git("init", "-q");
  git("config", "user.name", "PEOS Synthetic Runner");
  git("config", "user.email", "peos-synthetic@example.invalid");
  mkdirSync(join(root, "apps", "web"), { recursive: true });
  writeFileSync(join(root, "apps", "web", "authorization.ts"), "export const sensitiveGate = true;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "initial application source");
  const before = git("rev-parse", "HEAD");

  mkdirSync(join(root, "docs"), { recursive: true });
  renameSync(join(root, "apps", "web", "authorization.ts"), join(root, "docs", "archive.md"));
  git("add", "-A");
  git("commit", "-q", "-m", "move application code to docs path");
  const after = git("rev-parse", "HEAD");

  // Rename detection reports only the destination; the release gate must see
  // the removed application source path, as it does with --no-renames.
  const simplified = git("diff", "--find-renames", "--name-only", `${before}...${after}`);
  assert.equal(simplified, "docs/archive.md");
  const full = git("diff", "--no-renames", "--name-only", `${before}...${after}`);
  assert.match(full, /apps\/web\/authorization\.ts/);
  assert.match(full, /docs\/archive\.md/);

  const output = join(root, "github-output");
  writeFileSync(output, "");
  const script = fileURLToPath(new URL("./vercel-ignore-build.mjs", import.meta.url));
  execFileSync(process.execPath, [script, "--github-output"], {
    cwd: root,
    env: { ...process.env, BASE_SHA: before, HEAD_SHA: after, GITHUB_OUTPUT: output },
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.match(readFileSync(output, "utf8"), /^preview_required=true\n$/);
});

test("every Preview deployment builds, including docs-only main-sync and missing metadata", () => {
  for (const options of [
    { changedFiles: ["docs/operations/runbook.md"] },
    { changedFiles: ["README.md"], mergeParentChangedFiles: ["SECURITY.md"] },
    { changedFiles: [] },
    { changedFiles: null },
    {},
  ]) {
    assert.equal(shouldBuild({ environment: "preview", ...options }), true);
  }
});

test("Vercel CLI exit codes preserve exact-SHA Production authorization and build Preview", () => {
  const script = fileURLToPath(new URL("./vercel-ignore-build.mjs", import.meta.url));
  const sha = "a".repeat(40);
  const cases = [
    { environment: "preview", ref: "fix/docs", approved: "", expected: 1 },
    { environment: "production", ref: "main", approved: "", expected: 0 },
    { environment: "production", ref: "main", approved: "b".repeat(40), expected: 0 },
    { environment: "production", ref: "feature", approved: sha, expected: 0 },
    { environment: "production", ref: "main", approved: sha, expected: 1 },
  ];
  for (const { environment, ref, approved, expected } of cases) {
    const result = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { ...process.env, VERCEL_ENV: environment, VERCEL_GIT_COMMIT_REF: ref,
        VERCEL_GIT_COMMIT_SHA: sha, VERCEL_GIT_PREVIOUS_SHA: "b".repeat(40),
        IAM_APPROVED_PRODUCTION_SHA: approved },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, expected, result.stderr);
  }
});

test("real docs-only Git diff requires a deployment but not authenticated E2E", (t) => {
  const root = mkdtempSync(join(tmpdir(), "iam-docs-ready-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  git("init", "-q");
  git("config", "user.name", "PEOS Synthetic Runner");
  git("config", "user.email", "peos-synthetic@example.invalid");
  writeFileSync(join(root, "README.md"), "before");
  git("add", "-A");
  git("commit", "-q", "-m", "initial docs");
  const before = git("rev-parse", "HEAD");
  writeFileSync(join(root, "README.md"), "after");
  git("add", "-A");
  git("commit", "-q", "-m", "docs-only change");
  const after = git("rev-parse", "HEAD");
  const script = fileURLToPath(new URL("./vercel-ignore-build.mjs", import.meta.url));
  const output = join(root, "github-output");
  writeFileSync(output, "");
  const env = { ...process.env, BASE_SHA: before, HEAD_SHA: after, GITHUB_OUTPUT: output,
    VERCEL_ENV: "preview", VERCEL_GIT_PREVIOUS_SHA: before, VERCEL_GIT_COMMIT_SHA: after };
  execFileSync(process.execPath, [script, "--github-output"], { cwd: root, env });
  assert.equal(readFileSync(output, "utf8"), "preview_required=false\n");
  const build = spawnSync(process.execPath, [script], { cwd: root, env, encoding: "utf8" });
  assert.equal(build.error, undefined);
  assert.equal(build.status, 1, build.stderr);
});
