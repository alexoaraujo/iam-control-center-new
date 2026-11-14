import test from "node:test";
import assert from "node:assert/strict";
import { hasBuildRelevantChanges, shouldBuild } from "./vercel-ignore-build.mjs";

test("skips Preview for documentation-only changes", () => {
  assert.equal(
    shouldBuild({
      environment: "preview",
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
    shouldBuild({
      environment: "preview",
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

test("never skips Production", () => {
  assert.equal(
    shouldBuild({
      environment: "production",
      previousSha: "base",
      currentSha: "head",
      changedFiles: ["docs/only.md"],
    }),
    true,
  );
});

test("fails closed when commit metadata is missing", () => {
  assert.equal(
    shouldBuild({
      environment: "preview",
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
    shouldBuild({
      environment: "preview",
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

test("does not spend a Preview build for a docs-only main-sync merge", () => {
  assert.equal(
    shouldBuild({
      environment: "preview",
      previousSha: "previous-feature",
      currentSha: "merged-feature",
      changedFiles: ["database/scripts/schema-manifest.sql"],
      mergeParentChangedFiles: ["docs/operations/runbook.md"],
    }),
    false,
  );
});

test("redeploying the same Preview SHA never ignores updated environment settings", () => {
  assert.equal(
    shouldBuild({
      environment: "preview",
      previousSha: "35dd97edd08a92bb4dbc1b1a9c02e5a3c11627d4",
      currentSha: "35dd97edd08a92bb4dbc1b1a9c02e5a3c11627d4",
      changedFiles: [],
      mergeParentChangedFiles: [],
    }),
    true,
  );
});
