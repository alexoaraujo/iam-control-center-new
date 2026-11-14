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

test("release approval does not bypass Preview impact detection", () => {
  const sha = "a".repeat(40);
  assert.equal(shouldBuild({ environment: "preview", previousSha: "old",
    currentSha: sha, approvedProductionSha: sha, gitRef: "main",
    changedFiles: ["docs/only.md"] }), false);
  assert.equal(shouldBuild({ environment: "preview", previousSha: "old",
    currentSha: sha, approvedProductionSha: sha, gitRef: "main",
    changedFiles: ["apps/web/src/app/page.tsx"] }), true);
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
