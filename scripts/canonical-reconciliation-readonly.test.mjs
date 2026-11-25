import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { collectLineage } from "./check-migration-lineage.mjs";
import { reconcileCanonicalReadOnly, reconcileFromFile, EXPECTED } from "../database/offline/reconcile-canonical-readonly.mjs";

const root = resolve(import.meta.dirname, "..");
const lineage = () => collectLineage(root);
const sections = [
  "schemas", "relations", "sequences", "routines", "aggregates", "types",
  "triggers", "policies", "extensions", "expanded_object_acls",
  "default_acls", "database_acl", "roles", "role_memberships",
];
function manifest(complete = false) {
  const result = {
    format: "iam-postgresql-schema-manifest/v1",
    database: EXPECTED.database,
    server_version_num: 180007,
    server_version: "18.7",
    ...Object.fromEntries(sections.map((section) => [section, []])),
  };
  result.schemas = complete
    ? ["iam", "audit", "app_private"].map((name) => ({ name, owner: "iam_owner" }))
    : [{ name: "public", owner: "neondb_owner" }];
  result.roles = [{ name: "iam_app_runtime_login",
    login: true, superuser: false, bypass_rls: false }];
  if (complete) {
    result.relations = [
      { schema: "iam", name: "schema_migrations", kind: "r", rls_enabled: false, rls_forced: false },
      { schema: "iam", name: "tenants", kind: "r", rls_enabled: true, rls_forced: true },
      { schema: "audit", name: "events", kind: "r", rls_enabled: true, rls_forced: true },
    ];
    result.policies = [{ schema: "iam", table: "tenants", name: "tenant_read",
      using: "hidden security predicate" }];
    result.routines = [{ schema: "iam", name: "set_tenant_context",
      identity_arguments: "uuid", kind: "f", definition_sha256: "a".repeat(64) }];
  }
  return result;
}
function ledger(branchId, rows = []) {
  return { format: "iam-ledger-provenance/v1", branch_id: branchId, rows };
}
const knownRow = {
  migration_id: "0001_context_key_hardening",
  checksum_sha256: "2447395628fa0f1230abd95eb522e5b45d1baea1208c9c21b20346a10718fbab",
  source_sha: "b80c98c51746e1d49039015eb649b9bdd735ef7f",
  execution_role: "iam_migrator_login",
  applied_at: "2026-11-05T04:16:49.492Z",
};
function evidence(source = manifest(true), target = manifest(false)) {
  return {
    format: "iam-canonical-reconciliation-evidence/v1",
    project_id: EXPECTED.project,
    source: {
      branch_id: EXPECTED.development, database: EXPECTED.database,
      schema_manifest: source, ledger: ledger(EXPECTED.development),
    },
    target: {
      branch_id: EXPECTED.production, database: EXPECTED.database,
      schema_manifest: target, ledger: null,
    },
  };
}

test("real-shaped Neon drift refuses Production and never performs DDL", () => {
  const report = reconcileCanonicalReadOnly(evidence(), lineage());
  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.comparison.schema, "DRIFT");
  assert.equal(report.comparison.ledger, "TARGET_ABSENT");
  for (const code of [
    "SCHEMA_MANIFEST_DRIFT", "TARGET_IAM_SCHEMA_INCOMPLETE",
    "TARGET_MIGRATION_LEDGER_ABSENT", "SOURCE_MIGRATION_LEDGER_EMPTY",
    "CANONICAL_BASELINE_NOT_APPROVED",
  ]) assert.ok(report.diagnostics.includes(code), code);
  assert.equal(report.observation.source.app_tables, 3);
  assert.equal(report.observation.target.app_tables, 0);
  assert.ok(Object.values(report.controls).every((flag) => flag === false));
  assert.deepEqual(report.migration_candidates.map((c) => c.status),
    Array(4).fill("REVIEW_ONLY"));
});

test("even identical schemas and populated immutable ledgers are metadata only", () => {
  const input = evidence(manifest(true), manifest(true));
  input.source.ledger.rows = [knownRow];
  input.target.ledger = ledger(EXPECTED.production, [
    { ...knownRow, applied_at: "2026-11-12T04:00:00Z" },
  ]);
  const report = reconcileCanonicalReadOnly(input, lineage());
  assert.equal(report.comparison.schema, "METADATA_MATCH_ONLY");
  assert.equal(report.comparison.ledger, "METADATA_MATCH_ONLY");
  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.controls.production_release_allowed, false);
  assert.equal(report.controls.migration_ddl_allowed, false);
  assert.ok(report.diagnostics.includes("EVIDENCE_NOT_AUTHENTICATED"));
});

test("both ledgers empty never attest migration lineage", () => {
  const input = evidence(manifest(true), manifest(true));
  input.target.ledger = ledger(EXPECTED.production);
  const report = reconcileCanonicalReadOnly(input, lineage());
  assert.equal(report.comparison.ledger, "BLOCKED");
  assert.equal(report.comparison.ledger_differences, 1);
  assert.ok(report.diagnostics.includes("MIGRATION_LEDGER_DRIFT_OR_EMPTY"));
  assert.ok(report.diagnostics.includes("TARGET_MIGRATION_LEDGER_EMPTY"));
});

test("missing source ledger fails closed, not a clean-install proof", () => {
  const input = evidence(manifest(false), manifest(false));
  input.source.ledger = null;
  const report = reconcileCanonicalReadOnly(input, lineage());
  assert.equal(report.comparison.ledger, "SOURCE_ABSENT");
  assert.ok(report.diagnostics.includes("SOURCE_MIGRATION_LEDGER_ABSENT"));
});

test("rejects forged branch, project, database and injected approval flags", () => {
  for (const mutate of [
    (e) => { e.project_id = "twilight-fire-88497009"; },
    (e) => { e.source.branch_id = EXPECTED.production; },
    (e) => { e.target.branch_id = EXPECTED.development; },
    (e) => { e.target.database = "neondb"; },
    (e) => { e.source.schema_manifest.database = "other_database"; },
    (e) => { e.execution_authorized = true; },
    (e) => { e.target.production_release_allowed = true; },
  ]) {
    const input = evidence();
    mutate(input);
    assert.throws(() => reconcileCanonicalReadOnly(input, lineage()), /INVALID_/);
  }
});

test("rejects forged/mismatched ledger branch, duplicate rows and fake checksum", () => {
  for (const mutate of [
    (e) => { e.source.ledger.branch_id = EXPECTED.production; },
    (e) => { e.source.ledger = null; },
    (e) => { e.source.ledger.rows = [knownRow, knownRow]; },
    (e) => { e.source.ledger.rows = [{ ...knownRow, checksum_sha256: "secret" }]; },
    (e) => { e.target.ledger = ledger(EXPECTED.production); },
  ]) {
    const input = evidence();
    mutate(input);
    assert.throws(() => reconcileCanonicalReadOnly(input, lineage()));
  }
});

test("rejects missing sections, unknown PG major, missing routine SHA and tampered policy", () => {
  const input = evidence();
  delete input.source.schema_manifest.policies;
  assert.throws(() => reconcileCanonicalReadOnly(input, lineage()));
  const wrongPg = evidence();
  wrongPg.source.schema_manifest.server_version_num = 170010;
  assert.throws(() => reconcileCanonicalReadOnly(wrongPg, lineage()));
  const missingHash = evidence();
  delete missingHash.source.schema_manifest.routines[0].definition_sha256;
  assert.throws(() => reconcileCanonicalReadOnly(missingHash, lineage()));
  const forged = lineage();
  forged.execution_authorized = true;
  assert.throws(() => reconcileCanonicalReadOnly(evidence(), forged), /INVALID_OR_EXECUTABLE/);
  const candidate = lineage();
  candidate.candidates[0].status = "EXECUTE";
  assert.throws(() => reconcileCanonicalReadOnly(evidence(), candidate), /INVALID_OR_EXECUTABLE/);
});

test("runtime role BYPASSRLS or absent is reported but cannot authorize", () => {
  const input = evidence();
  input.source.schema_manifest.roles[0].bypass_rls = true;
  input.target.schema_manifest.roles = [];
  const report = reconcileCanonicalReadOnly(input, lineage());
  assert.ok(report.diagnostics.includes("SOURCE_RUNTIME_ROLE_UNSAFE_OR_ABSENT"));
  assert.ok(report.diagnostics.includes("TARGET_RUNTIME_ROLE_UNSAFE_OR_ABSENT"));
  assert.equal(report.controls.production_release_allowed, false);
});

test("read-only CLI refuses parity, prints no SQL or secret-bearing error", () => {
  const tmp = mkdtempSync(join(tmpdir(), "iam-peos-reconcile-"));
  try {
    const file = join(tmp, "observation.json");
    const input = evidence();
    input.source.schema_manifest.policies[0].using = "PRIVATE_SQL_EXPRESSION";
    writeFileSync(file, JSON.stringify(input));
    const report = reconcileFromFile(file, root);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE_SQL_EXPRESSION/);
    const cli = spawnSync(process.execPath, [
      join(root, "database/offline/reconcile-canonical-readonly.mjs"), file,
    ], { encoding: "utf8", cwd: root });
    assert.equal(cli.status, 1);
    assert.equal(JSON.parse(cli.stdout).controls.migration_ddl_allowed, false);
    assert.doesNotMatch(cli.stdout + cli.stderr, /PRIVATE_SQL_EXPRESSION/);
    writeFileSync(file, JSON.stringify({ ...input, sql: "SECRET_CONNECTION_URL" }));
    const rejected = spawnSync(process.execPath, [
      join(root, "database/offline/reconcile-canonical-readonly.mjs"), file,
    ], { encoding: "utf8", cwd: root });
    assert.equal(rejected.status, 2);
    assert.match(rejected.stderr, /BLOCKED_INVALID_RECONCILIATION_EVIDENCE/);
    assert.doesNotMatch(rejected.stdout + rejected.stderr, /SECRET_CONNECTION_URL/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
