import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(".github/workflows/quality.yml", "utf8");

test("quality CI only runs automatically for pull requests and main pushes", () => {
  assert.match(
    workflow,
    /^on:\n  push:\n    branches: \[main\]\n  pull_request:\n  workflow_dispatch:\n/m,
    "PR updates and main must be checked; other branches may request a manual run",
  );
  assert.doesNotMatch(workflow, /^(?: {2}| {4})branches-ignore:/m);
});

test("stale PR runs are canceled while main checks cannot be canceled", () => {
  assert.match(workflow, /^  group: ci-\$\{\{ github\.ref \}\}$/m);
  assert.match(
    workflow,
    /^  cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}$/m,
  );
});

test("security and quality steps remain part of the required quality job", () => {
  for (const step of [
    "Dependency audit",
    "Lint",
    "Typecheck",
    "Test",
    "Test Preview build and Auth0 configuration contracts",
    "Build",
  ]) {
    assert.ok(workflow.includes("- name: " + step), "Missing CI gate: " + step);
  }
});
