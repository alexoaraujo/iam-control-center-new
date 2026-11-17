import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Deliberately invalid source is passed through stdin, never written into the
// app tree. This proves that a green Biome lint cannot silently lose essential
// React Hooks, Next.js Core Web Vitals and accessibility checks.
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const webRoot = join(projectRoot, "apps", "web");
const biome = join(webRoot, "node_modules", ".bin", process.platform === "win32" ? "biome.cmd" : "biome");

function assertViolation(rule, source) {
  assert.ok(existsSync(biome), "Biome must be installed from a frozen pnpm lockfile");
  const run = spawnSync(biome, [
    "lint", "--max-diagnostics=none", "--error-on-warnings",
    "--stdin-file-path=src/__peos_rule_negative_fixture__.tsx",
  ], { cwd: webRoot, input: source, encoding: "utf8", timeout: 15000 });
  assert.equal(run.error, undefined, String(run.error));
  const output = (run.stdout ?? "") + "\n" + (run.stderr ?? "");
  assert.notEqual(run.status, 0, `An unsafe fixture was accepted: ${rule}\n${output}`);
  assert.ok(output.includes(rule), `Expected ${rule} diagnostic, received:\n${output}`);
}

test("React Hooks: conditional hook invocation is rejected", () => {
  assertViolation("useHookAtTopLevel", `
    import { useState } from "react";
    export function Bad({ enabled }: { enabled: boolean }) {
      if (enabled) useState(0);
      return null;
    }
  `);
});

test("React Hooks: missing effect dependencies are rejected", () => {
  assertViolation("useExhaustiveDependencies", `
    import { useEffect } from "react";
    export function Bad({ tenantId }: { tenantId: string }) {
      useEffect(() => { console.log(tenantId); }, []);
      return null;
    }
  `);
});

test("Next.js performance: an unoptimized img element is rejected", () => {
  assertViolation("noImgElement", `
    export default function Bad() {
      return <img src="/avatar.png" alt="avatar" />;
    }
  `);
});

test("JSX accessibility: a non-interactive div with click handler is rejected", () => {
  assertViolation("noStaticElementInteractions", `
    export function Bad() {
      return <div onClick={() => {}}>Activate</div>;
    }
  `);
});
