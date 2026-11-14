import test from "node:test";
import assert from "node:assert/strict";
import { assessG1Readiness } from "./g1-readiness-report.mjs";

function contractEvidence() {
  return {
    format: "peos/g1-catalog-observation/v1", project_id: "tiny-rice-70320263",
    source: {
      branch_id: "br-ancient-term-b6mmx5ol", database: "iam_database", tables: 23, ledger_rows: 0,
      roles: [
        { name: "iam_app_runtime_login", login: true, inherit: true, bypassrls: false, superuser: false },
        { name: "iam_migrator_login", login: true, inherit: false, bypassrls: false, superuser: false },
        { name: "iam_worker_login", login: true, inherit: false, bypassrls: false, superuser: false },
      ],
      memberships: [
        { member: "iam_app_runtime_login", role: "iam_app_runtime", admin: false, inherit: true, set: false },
        { member: "iam_migrator_login", role: "iam_migrator", admin: false, inherit: false, set: true },
        { member: "iam_worker_login", role: "iam_worker", admin: false, inherit: true, set: true },
        { member: "iam_migrator", role: "iam_owner", admin: false, inherit: false, set: true },
      ],
      reader: { login: true, bypassrls: false, maintain_tables: 23, broad_tables: 0, usage_schemas: 3, create_schemas: 0 },
    },
    target: {
      branch_id: "br-sweet-union-b6j80a7j", database: "iam_canonical_validation",
      scoped_relations: 0, scoped_schemas: 0, all_non_system_relations: 0, inherited_database: "iam_database",
      roles: [], memberships: [],
    },
    catalog_sha256: { source: "a".repeat(64), inherited_shadow: "a".repeat(64) },
  };
}
const full = () => {
  const evidence = contractEvidence();
  evidence.target.roles = structuredClone(evidence.source.roles);
  evidence.target.memberships = structuredClone(evidence.source.memberships);
  return evidence;
};

test("even the entire canonical role contract cannot authorize operations without independent evidence", () => {
  const report = assessG1Readiness(full());
  assert.equal(report.state, "INDEPENDENT_REVIEW_REQUIRED");
  assert.equal(report.diagnostic_codes.length, 0);
  for (const field of ["external_tls_verified", "backup_restored_and_verified", "independent_change_approved",
    "real_pg_dump_verified", "release_authorized", "production_cutover_authorized"]) {
    assert.equal(report[field], false, field);
  }
});

test("live-known source drift: missing migrator/worker, owner grant and export lock permissions block", () => {
  const evidence = full();
  evidence.source.roles.splice(1);
  evidence.source.memberships.splice(1);
  evidence.source.reader.maintain_tables = 0;
  evidence.source.reader.usage_schemas = 0;
  const report = assessG1Readiness(evidence);
  assert.equal(report.state, "BLOCKED");
  assert.ok(report.diagnostic_codes.includes("SOURCE_iam_migrator_login_MISSING"));
  assert.ok(report.diagnostic_codes.includes("SOURCE_iam_worker_login_MISSING"));
  assert.ok(report.diagnostic_codes.includes("SOURCE_iam_migrator_iam_owner_MISSING"));
  assert.ok(report.diagnostic_codes.includes("SOURCE_READER_INSUFFICIENT_LOCK_PRIVILEGES"));
});

test("restore branch runtime may not SET ROLE even when both catalogs match", () => {
  const evidence = full();
  evidence.target.roles[0].inherit = false;
  evidence.target.memberships[0].set = true;
  const report = assessG1Readiness(evidence);
  assert.ok(report.diagnostic_codes.includes("TARGET_iam_app_runtime_login_OPTIONS_DRIFT"));
  assert.ok(report.diagnostic_codes.includes("TARGET_iam_app_runtime_login_iam_app_runtime_OPTIONS_DRIFT"));
});

test("fail closed on destination confusion, production and forbidden cross-org project", () => {
  for (const mutation of [
    (e) => { e.project_id = "twilight-fire-88497009"; },
    (e) => { e.target.branch_id = "br-muddy-snow-b63cepcv"; },
    (e) => { e.target.database = "iam_database"; },
    (e) => { e.target.inherited_database = "iam_canonical_validation"; },
    (e) => { e.source.branch_id = "br-muddy-snow-b63cepcv"; },
  ]) {
    const evidence = full(); mutation(evidence);
    assert.throws(() => assessG1Readiness(evidence), /INVALID_SOURCE_OR_ISOLATED_TARGET|INVALID_PROJECT_OR_FORMAT/);
  }
});

test("reject excess permissions, unexpected principals, duplicates and bypass", () => {
  const evidence = full();
  evidence.source.reader.broad_tables = 1;
  evidence.source.reader.bypassrls = true;
  evidence.source.memberships.push({ member: "iam_app_runtime_login", role: "iam_owner", admin: true, inherit: true, set: true });
  evidence.source.roles.push({ name: "SECRET_UNTRUSTED_ROLE", login: true, inherit: true, bypassrls: false, superuser: false });
  const report = assessG1Readiness(evidence);
  assert.equal(report.state, "BLOCKED");
  assert.ok(report.diagnostic_codes.includes("SOURCE_READER_EXCESS_PRIVILEGES"));
  assert.ok(report.diagnostic_codes.includes("SOURCE_READER_UNSAFE_IDENTITY"));
  assert.ok(report.diagnostic_codes.includes("SOURCE_UNEXPECTED_MEMBERSHIP"));
  assert.ok(report.diagnostic_codes.includes("SOURCE_UNEXPECTED_ROLE"));
  assert.ok(!JSON.stringify(report).includes("SECRET_UNTRUSTED_ROLE"));
  evidence.source.roles.push(evidence.source.roles[0]);
  assert.ok(assessG1Readiness(evidence).diagnostic_codes.includes("SOURCE_DUPLICATE_ROLE"));
});

test("reject malformed input, fake hashes, unexpected fields and polluted manifests", () => {
  for (const mutation of [
    (e) => { e.catalog_sha256.inherited_shadow = "not-a-sha"; },
    (e) => { e.source.reader.maintain_tables = "23"; },
    (e) => { e.source.roles[0].inherit = "t"; },
    (e) => { e.source.extra_payload = "SECRET"; },
    (e) => { e.target.roles[0].hidden = true; },
  ]) {
    const evidence = full(); mutation(evidence);
    assert.throws(() => assessG1Readiness(evidence), /^Error: INVALID_/);
  }
});

test("detect changed inherited-schema hashes, populated restore, and nonempty migrated ledger without fabrication", () => {
  const evidence = full();
  evidence.catalog_sha256.inherited_shadow = "b".repeat(64);
  evidence.target.scoped_relations = 1;
  evidence.source.ledger_rows = 1;
  const report = assessG1Readiness(evidence);
  for (const code of ["CATALOG_SHA256_DRIFT", "TARGET_NOT_EMPTY", "SOURCE_LEDGER_REVIEW_REQUIRED"]) {
    assert.ok(report.diagnostic_codes.includes(code));
  }
});

test("a public table in the isolated target blocks even with zero IAM schemas", () => {
  const evidence = full();
  evidence.target.all_non_system_relations = 1;
  assert.ok(assessG1Readiness(evidence).diagnostic_codes.includes("TARGET_NOT_EMPTY"));
});
