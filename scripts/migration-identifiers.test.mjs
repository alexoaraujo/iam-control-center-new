import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";

test("migration identifiers are unique even across different schema lineages", () => {
  const folder = join(process.cwd(), "database", "migrations");
  const files = readdirSync(folder).filter((name) => /^\\d{4}_.+\\.sql$/.test(name));
  assert.ok(files.length > 0, "Expected reviewed migration files");
  const versions = new Map();
  for (const name of files) {
    const version = name.slice(0, 4);
    assert.ok(!versions.has(version),
      `Duplicate migration ID ${version}: ${versions.get(version)} and ${name}`);
    versions.set(version, name);
  }
});
