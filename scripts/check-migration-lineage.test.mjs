import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { collectLineage, sha256, verifyMigrationPolicy } from "./check-migration-lineage.mjs";

const root = resolve(import.meta.dirname, "..");
const policy = JSON.parse(readFileSync(resolve(root, "database/migrations/lineage-policy.json"), "utf8"));
const files = policy.candidates.map((candidate) => candidate.file);

test("inventory exactly three distinct, review-only lineages with SHA256 of exact bytes", () => {
  const report = collectLineage(root);
  assert.equal(report.execution_authorized, false);
  assert.equal(report.canonical_baseline, "BLOCKED");
  assert.equal(report.candidates.length, 3);
  assert.equal(new Set(report.candidates.map(({ lineage }) => lineage)).size, 3);
  for (const candidate of report.candidates) {
    assert.match(candidate.sha256, /^[a-f0-9]{64}$/);
    assert.equal(candidate.sha256, sha256(readFileSync(resolve(root, "database/migrations", candidate.file))));
    assert.equal(candidate.status, "REVIEW_ONLY");
  }
});

test("fail closed for unreviewed migration, missing file, duplicate lineage and execution switch", () => {
  assert.throws(() => verifyMigrationPolicy(policy, [...files, "20261111_new.sql"]), /unregistered/);
  assert.throws(() => verifyMigrationPolicy(policy, files.slice(1)), /unregistered/);
  assert.throws(() => verifyMigrationPolicy({ ...policy, execution_authorized: true }, files), /never authorize/);
  assert.throws(() => verifyMigrationPolicy({ ...policy, candidates: policy.candidates.map((entry) => ({ ...entry, lineage: "same" })) }, files), /duplicate/);
});

test("historical 0001 ledger cannot be rewritten or confused with clean-install 0001", () => {
  assert.notEqual(policy.historical_ledger.migration_id, policy.candidates[0].file.replace(/\.sql$/, ""));
  assert.throws(() => verifyMigrationPolicy({ ...policy, historical_ledger: { ...policy.historical_ledger, checksum_sha256: "a".repeat(64) } }, files), /provenance/);
});
