import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function verifyMigrationPolicy(policy, sqlFiles) {
  if (policy?.format !== "iam-migration-lineage/v1") throw new Error("unknown lineage manifest");
  if (policy.execution_authorized !== false || policy.canonical_baseline?.status !== "BLOCKED") {
    throw new Error("unreviewed lineage policy must never authorize migration execution");
  }
  if (policy.historical_ledger?.migration_id !== "0001_context_key_hardening"
    || policy.historical_ledger.checksum_sha256 !== "2447395628fa0f1230abd95eb522e5b45d1baea1208c9c21b20346a10718fbab"
    || policy.historical_ledger.source_sha !== "b80c98c51746e1d49039015eb649b9bdd735ef7f") {
    throw new Error("historical migration provenance changed");
  }
  const declared = policy.candidates;
  if (!Array.isArray(declared) || declared.length !== 3) throw new Error("unexpected migration candidate count");
  const candidates = new Set(declared.map((entry) => entry.file));
  const seenLineages = new Set(declared.map((entry) => entry.lineage));
  if (candidates.size !== declared.length || seenLineages.size !== declared.length) {
    throw new Error("duplicate migration candidate or incompatible lineage identifier");
  }
  const expected = new Set(["0001_initial_iam_schema.sql", "0002_sessions_touch_contract.sql", "0003_set_tenant_context_search_path.sql"]);
  if (candidates.size !== expected.size || [...candidates].some((file) => !expected.has(file))
    || sqlFiles.length !== expected.size || sqlFiles.some((name) => !candidates.has(name))) {
    throw new Error("unregistered, missing or unexpected migration SQL file");
  }
  if (declared.some((candidate) => candidate.status !== "REVIEW_ONLY" || !candidate.precondition)) {
    throw new Error("migration marked executable without an approved canonical baseline");
  }
  // Candidate numbering is historical, not an execution order. Intentionally
  // produce a review inventory, NOT a list of runnable migrations.
  return declared.map(({ file, lineage, status }) => ({ file, lineage, status }));
}

export function collectLineage(root) {
  const migrationDirectory = resolve(root, "database/migrations");
  const policy = JSON.parse(readFileSync(resolve(migrationDirectory, "lineage-policy.json"), "utf8"));
  const sqlFiles = readdirSync(migrationDirectory).filter((f) => f.endsWith(".sql")).sort();
  const entries = verifyMigrationPolicy(policy, sqlFiles);
  return {
    format: policy.format,
    execution_authorized: false,
    canonical_baseline: policy.canonical_baseline.status,
    historical_ledger: { id: policy.historical_ledger.migration_id, sha256: policy.historical_ledger.checksum_sha256, source_sha: policy.historical_ledger.source_sha },
    candidates: entries.map((entry) => ({
      ...entry,
      sha256: sha256(readFileSync(resolve(migrationDirectory, entry.file))),
    })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = collectLineage(resolve(import.meta.dirname, ".."));
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    process.stdout.write("BLOCKED: no canonical baseline or approved complete migration DAG; audit only.\n");
  } catch (error) {
    process.stderr.write(`FAIL lineage check: ${error.message}\n`);
    process.exitCode = 1;
  }
}
