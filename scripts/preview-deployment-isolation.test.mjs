import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const text = readFileSync(new URL("../.github/workflows/quality.yml", import.meta.url), "utf8");
function job(name) {
  const marker = `  ${name}:\n`;
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, `job ${name} missing`);
  const end = text.slice(start + marker.length).search(/^  [\w-]+:\s*$/m);
  return end < 0 ? text.slice(start) : text.slice(start, start + marker.length + end);
}
test("read-only preview lookup never opens protected Preview Environment", () => {
  const preview = job("preview-deployment");
  assert.doesNotMatch(preview, /^    environment:/m);
  assert.doesNotMatch(preview, /^      deployments:\s*write\s*$/m);
  assert.match(preview, /^      checks:\s*read\s*$/m);
  assert.match(preview, /^      statuses:\s*read\s*$/m);
  assert.match(preview, /github\.event\.pull_request\.head\.sha/);
  assert.match(preview, /\.app\.slug == "vercel"/);
  assert.match(preview, /\.name == "Vercel Preview Comments"/);
});
test("Auth0 sync and browser E2E still use protected Preview Environment", () => {
  for (const name of ["sync-auth0-preview", "auth0-e2e"]) {
    const content = job(name);
    assert.match(content, /^    environment:\s*$/m);
    assert.match(content, /^      name:\s*Preview\s*$/m);
  }
});
test("security-gate still requires positive Auth0 and Preview checks for code", () => {
  const gate = job("security-gate");
  assert.match(gate, /needs:/);
  for (const prerequisite of ["quality", "preview-deployment", "sync-auth0-preview", "auth0-e2e"]) {
    assert.match(gate, new RegExp(`^      - ${prerequisite}$`, "m"));
  }
  assert.match(gate, /release-security-gate\.mjs/);
});
