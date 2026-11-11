import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const evidence = JSON.parse(readFileSync(resolve(root, "database/baselines/legacy-source-candidate.json"), "utf8"));
const lineage = JSON.parse(readFileSync(resolve(root, "database/migrations/lineage-policy.json"), "utf8"));
const source = readFileSync(resolve(root, "iam_database_schema.sql"));
const digest = (algo, bytes) => createHash(algo).update(bytes).digest("hex");

test("pinned canonical source candidate is byte-for-byte reproducible", () => {
  assert.equal(evidence.format, "iam-source-baseline-candidate/v1");
  assert.equal(evidence.status, "REVIEW_CANDIDATE");
  assert.equal(evidence.approved_for_migration, false);
  assert.equal(evidence.source.pinned_main_sha, "e95b938c889c3d2d45f056f946f2351df68b7823");
  assert.equal(evidence.source.byte_length, source.length);
  assert.equal(digest("sha256", source), evidence.source.sha256);
  const gitBlob = Buffer.concat([Buffer.from(`blob ${source.length}\0`), source]);
  assert.equal(digest("sha1", gitBlob), evidence.source.git_blob_sha1);
  assert.equal(evidence.source.git_blob_sha1, "1920b7946c88e624ec224917dc0f7742d2174904");
});

test("source lineage and legacy checksum remain segregated from upgrade candidates", () => {
  assert.equal(evidence.legacy_ledger.checksum_sha256, lineage.historical_ledger.checksum_sha256);
  assert.equal(evidence.legacy_ledger.source_sha, lineage.historical_ledger.source_sha);
  assert.equal(evidence.legacy_ledger.adopt_without_execution, false);
  assert.equal(lineage.execution_authorized, false);
  assert.equal(lineage.canonical_baseline.status, "BLOCKED");
  assert.equal(evidence.approved_for_migration, false);
  assert.equal(evidence.requires_approval.length, 6);
  assert.equal(evidence.source.pg_major, 18);
});

test("candidate documents provider and search_path differences before promotion", () => {
  const deltas = evidence.known_deltas.map((x) => x.object);
  assert.ok(deltas.includes("iam.set_tenant_context"));
  assert.ok(deltas.includes("provider_roles_acls"));
  assert.ok(deltas.includes("new_neon_development_ledger"));
  assert.equal(evidence.restore_evidence.tables, 23);
  assert.equal(evidence.restore_evidence.policies, 41);
  assert.equal(evidence.restore_evidence.force_rls_tables, 20);
});
