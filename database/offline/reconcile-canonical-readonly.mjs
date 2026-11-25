#!/usr/bin/env node
/**
 * PEOS G2: deterministic, OFFLINE canonical reconciliation of operator-supplied
 * PostgreSQL catalog manifests and migration-ledger provenance.
 *
 * It does not connect to Neon, execute SQL, issue credentials, validate an
 * actual Vercel binding, or approve any DDL/lease/Production promotion.
 * Treat every input as UNTRUSTED, even when the structural comparison passes.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compareManifests } from "./compare-schema-manifests.mjs";
import { compareLedgers } from "./compare-migration-ledgers.mjs";
import { collectLineage } from "../../scripts/check-migration-lineage.mjs";

export const EXPECTED = Object.freeze({
  project: "tiny-rice-70320263",
  database: "iam_database",
  development: "br-ancient-term-b6mmx5ol",
  production: "br-muddy-snow-b63cepcv",
});
const SHA256 = /^[a-f0-9]{64}$/i;
const APP_SCHEMAS = ["iam", "audit", "app_private"];
const TABLE_KINDS = new Set(["r", "p"]);

function requireKeys(value, keys, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Error(code);
  }
  const actual = Object.keys(value).sort();
  if (actual.length !== keys.length ||
      keys.some((key) => !Object.hasOwn(value, key)) ||
      actual.some((key) => !keys.includes(key))) throw Error(code);
}

function assertSide(side, label, branchId) {
  requireKeys(side, ["branch_id", "database", "schema_manifest", "ledger"],
    "INVALID_" + label + "_EVIDENCE");
  if (side.branch_id !== branchId || side.database !== EXPECTED.database) {
    throw Error("INVALID_" + label + "_BRANCH_OR_DATABASE");
  }
  const schema = side.schema_manifest;
  // The existing comparator validates ALL schema sections, duplicate objects,
  // and function-definition digests, including on a Production-empty schema.
  const self = compareManifests(schema, schema);
  if (!self.equal || schema.database !== side.database ||
      !Number.isInteger(schema.server_version_num) ||
      schema.server_version_num < 180000 || schema.server_version_num >= 190000) {
    throw Error("INVALID_" + label + "_SCHEMA_CONTRACT");
  }
  const ledgerPresent = schema.relations.some((r) =>
    r.schema === "iam" && r.name === "schema_migrations" &&
    TABLE_KINDS.has(r.kind));
  if (ledgerPresent !== (side.ledger !== null)) {
    throw Error("INVALID_" + label + "_LEDGER_PRESENCE");
  }
  if (side.ledger !== null) {
    if (side.ledger?.branch_id !== branchId) {
      throw Error("INVALID_" + label + "_LEDGER_BRANCH");
    }
    // Validate row identity, SHA-256, source SHA, role, timestamp, uniqueness
    // even when the other branch has NO ledger relation at all.
    compareLedgers(side.ledger, {
      format: "iam-ledger-provenance/v1",
      branch_id: "br-offline-validator",
      rows: [],
    });
  }
  return { schema, ledgerPresent };
}

function countAppTables(schema) {
  return schema.relations.filter((r) =>
    APP_SCHEMAS.includes(r.schema) && TABLE_KINDS.has(r.kind));
}

function snapshot(side) {
  const schema = side.schema_manifest;
  const tables = countAppTables(schema);
  return {
    app_schemas: schema.schemas.filter((s) => APP_SCHEMAS.includes(s.name)).length,
    app_tables: tables.length,
    views: schema.relations.filter((r) =>
      APP_SCHEMAS.includes(r.schema) && r.kind === "v").length,
    force_rls_tables: tables.filter((r) =>
      r.rls_enabled === true && r.rls_forced === true).length,
    policies: schema.policies.filter((p) =>
      APP_SCHEMAS.includes(p.schema)).length,
    ledger_present: side.ledger !== null,
    ledger_rows: side.ledger === null ? null : side.ledger.rows.length,
  };
}

function safeRuntime(schema) {
  const matching = schema.roles.filter((r) =>
    r.name === "iam_app_runtime_login");
  return matching.length === 1 && matching[0].login === true &&
    matching[0].superuser === false && matching[0].bypass_rls === false;
}

function verifyLineage(lineage) {
  if (lineage?.format !== "iam-migration-lineage/v1" ||
      lineage.execution_authorized !== false ||
      lineage.canonical_baseline !== "BLOCKED" ||
      !Array.isArray(lineage.candidates) || lineage.candidates.length !== 4 ||
      lineage.candidates.some((c) =>
        c.status !== "REVIEW_ONLY" || typeof c.lineage !== "string" ||
        !/^\d{4}_[a-z0-9_]+\.sql$/.test(c.file) ||
        !SHA256.test(c.sha256))) {
    throw Error("INVALID_OR_EXECUTABLE_MIGRATION_LINEAGE");
  }
}

/**
 * Diagnostic result, NEVER an authorization. A perfectly matching untrusted
 * pair still fails closed without authenticated provenance and independent
 * approval. The report contains only counts, fixed codes and file hashes.
 */
export function reconcileCanonicalReadOnly(input, lineage) {
  requireKeys(input, ["format", "project_id", "source", "target"],
    "INVALID_RECONCILIATION_INPUT");
  if (input.format !== "iam-canonical-reconciliation-evidence/v1" ||
      input.project_id !== EXPECTED.project) {
    throw Error("INVALID_RECONCILIATION_PROJECT_OR_FORMAT");
  }
  assertSide(input.source, "SOURCE", EXPECTED.development);
  assertSide(input.target, "TARGET", EXPECTED.production);
  verifyLineage(lineage);

  const source = snapshot(input.source);
  const target = snapshot(input.target);
  const schemaDiff = compareManifests(
    input.source.schema_manifest, input.target.schema_manifest);
  const diagnostics = new Set([
    "EVIDENCE_NOT_AUTHENTICATED",
    "CANONICAL_BASELINE_NOT_APPROVED",
    "VERCEL_PRODUCTION_BINDING_NOT_ATTESTED",
    "RESTORE_AND_ROLLBACK_NOT_ATTESTED",
    "MIGRATIONS_REVIEW_ONLY",
  ]);
  if (source.app_schemas !== 3 || source.app_tables === 0) {
    diagnostics.add("SOURCE_IAM_SCHEMA_INCOMPLETE");
  }
  if (target.app_schemas !== 3 || target.app_tables === 0) {
    diagnostics.add("TARGET_IAM_SCHEMA_INCOMPLETE");
  }
  if (!safeRuntime(input.source.schema_manifest)) {
    diagnostics.add("SOURCE_RUNTIME_ROLE_UNSAFE_OR_ABSENT");
  }
  if (!safeRuntime(input.target.schema_manifest)) {
    diagnostics.add("TARGET_RUNTIME_ROLE_UNSAFE_OR_ABSENT");
  }
  if (!schemaDiff.equal) diagnostics.add("SCHEMA_MANIFEST_DRIFT");

  let ledgerVerdict = "TARGET_ABSENT";
  let ledgerDifferences = 0;
  if (!input.source.ledger) {
    diagnostics.add("SOURCE_MIGRATION_LEDGER_ABSENT");
    ledgerVerdict = "SOURCE_ABSENT";
  } else if (!input.target.ledger) {
    diagnostics.add("TARGET_MIGRATION_LEDGER_ABSENT");
  } else {
    const comparison = compareLedgers(input.source.ledger, input.target.ledger);
    ledgerVerdict = comparison.verdict;
    ledgerDifferences = comparison.differences.length;
    if (comparison.verdict !== "METADATA_MATCH_ONLY") {
      diagnostics.add("MIGRATION_LEDGER_DRIFT_OR_EMPTY");
    }
  }
  if (input.source.ledger?.rows.length === 0) {
    diagnostics.add("SOURCE_MIGRATION_LEDGER_EMPTY");
  }
  if (input.target.ledger?.rows.length === 0) {
    diagnostics.add("TARGET_MIGRATION_LEDGER_EMPTY");
  }

  return {
    format: "iam-canonical-reconciliation-report/v1",
    verdict: "BLOCKED",
    project_id: EXPECTED.project,
    source_branch_id: EXPECTED.development,
    target_branch_id: EXPECTED.production,
    observation: { source, target },
    comparison: {
      schema: schemaDiff.equal ? "METADATA_MATCH_ONLY" : "DRIFT",
      schema_differences: schemaDiff.count,
      ledger: ledgerVerdict,
      ledger_differences: ledgerDifferences,
      migration_lineage: "REVIEW_ONLY",
    },
    migration_candidates: lineage.candidates.map((c) => ({
      file: c.file, lineage: c.lineage, sha256: c.sha256, status: c.status,
    })),
    diagnostics: [...diagnostics].sort(),
    controls: {
      live_neon_connection_executed: false,
      evidence_authenticated: false,
      canonical_baseline_approved: false,
      vercel_production_binding_attested: false,
      restore_rollback_verified: false,
      migration_ddl_allowed: false,
      ledger_backfill_allowed: false,
      g3_privileged_allowed: false,
      production_release_allowed: false,
    },
  };
}

export function reconcileFromFile(path, root) {
  const input = JSON.parse(readFileSync(path, "utf8"));
  const lineage = collectLineage(root);
  return reconcileCanonicalReadOnly(input, lineage);
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // The only CLI interface is one local JSON evidence file. No URL, SQL,
  // connection-string or --execute mode exists; exit 1 even on metadata parity.
  if (process.argv.length !== 3) {
    process.stderr.write("BLOCKED_RECONCILIATION_USAGE: local evidence JSON required\n");
    process.exitCode = 2;
  } else {
    try {
      const result = reconcileFromFile(
        resolve(process.argv[2]), resolve(import.meta.dirname, "../.."));
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      process.exitCode = 1;
    } catch {
      // Errors may contain untrusted fields or paths. Never echo source data.
      process.stderr.write("BLOCKED_INVALID_RECONCILIATION_EVIDENCE\n");
      process.exitCode = 2;
    }
  }
}
