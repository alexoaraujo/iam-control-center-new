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
