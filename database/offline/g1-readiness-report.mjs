/**
 * PEOS G1 — offline, read-only catalog inventory preflight.
 *
 * This helper never connects to Neon, performs SQL, approves a change, or
 * executes a restore. Input is an UNTRUSTED, sanitized catalog observation;
 * results are diagnostic only. Independent external evidence is still needed.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const FORMAT = "peos/g1-catalog-observation/v1";
const PROJECT = "tiny-rice-70320263";
const SOURCE_BRANCH = "br-ancient-term-b6mmx5ol";
const TARGET_BRANCH = "br-sweet-union-b6j80a7j";
const SHA256 = /^[a-f0-9]{64}$/;

const ROLE_CONTRACT = new Map([
  ["iam_app_runtime_login", { login: true, inherit: true, bypassrls: false, superuser: false }],
  ["iam_migrator_login", { login: true, inherit: false, bypassrls: false, superuser: false }],
  ["iam_worker_login", { login: true, inherit: false, bypassrls: false, superuser: false }],
]);
const MEMBERSHIP_CONTRACT = new Map([
  ["iam_app_runtime_login|iam_app_runtime", { admin: false, inherit: true, set: false }],
  ["iam_migrator_login|iam_migrator", { admin: false, inherit: false, set: true }],
  ["iam_worker_login|iam_worker", { admin: false, inherit: true, set: true }],
  ["iam_migrator|iam_owner", { admin: false, inherit: false, set: true }],
]);
const ROLE_KEYS = new Set(["name", "login", "inherit", "bypassrls", "superuser"]);
const MEMBER_KEYS = new Set(["member", "role", "admin", "inherit", "set"]);
const OBS_KEYS = new Set(["branch_id", "database", "roles", "memberships", "ledger_rows", "tables", "reader", "scoped_schemas", "scoped_relations"]);
const READER_KEYS = new Set(["login", "bypassrls", "maintain_tables", "broad_tables", "usage_schemas", "create_schemas"]);

function plainObject(value, allowed, kind) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`INVALID_${kind}_SHAPE`);
  }
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.has(key))) throw new Error(`INVALID_${kind}_FIELDS`);
}
function count(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`INVALID_${label}`);
  return value;
}
function bool(value, label) {
  if (typeof value !== "boolean") throw new Error(`INVALID_${label}`);
  return value;
}
function list(value, label) {
  if (!Array.isArray(value) || value.length > 128) throw new Error(`INVALID_${label}`);
  return value;
}
function inspectGraph(observation, location, blockers) {
  const roles = new Map();
  for (const role of list(observation.roles, `${location}_ROLES`)) {
    plainObject(role, ROLE_KEYS, "ROLE");
    if (typeof role.name !== "string" || !ROLE_CONTRACT.has(role.name)) {
      blockers.add(`${location}_UNEXPECTED_ROLE`);
      continue;
    }
    if (roles.has(role.name)) blockers.add(`${location}_DUPLICATE_ROLE`);
    roles.set(role.name, role);
  }
  for (const [name, contract] of ROLE_CONTRACT) {
    const role = roles.get(name);
    if (!role) { blockers.add(`${location}_${name}_MISSING`); continue; }
    for (const field of Object.keys(contract)) {
      if (bool(role[field], "ROLE_FLAG") !== contract[field]) {
        blockers.add(`${location}_${name}_OPTIONS_DRIFT`);
      }
    }
  }
  const memberships = new Map();
  for (const membership of list(observation.memberships, `${location}_MEMBERSHIPS`)) {
    plainObject(membership, MEMBER_KEYS, "MEMBERSHIP");
    if (typeof membership.member !== "string" || typeof membership.role !== "string") {
      throw new Error("INVALID_MEMBERSHIP_NAMES");
    }
    const key = `${membership.member}|${membership.role}`;
    if (!MEMBERSHIP_CONTRACT.has(key)) {
      blockers.add(`${location}_UNEXPECTED_MEMBERSHIP`);
      continue;
    }
    if (memberships.has(key)) blockers.add(`${location}_DUPLICATE_MEMBERSHIP`);
    memberships.set(key, membership);
  }
  for (const [key, contract] of MEMBERSHIP_CONTRACT) {
    const membership = memberships.get(key);
    if (!membership) { blockers.add(`${location}_${key.replace("|", "_")}_MISSING`); continue; }
    for (const field of Object.keys(contract)) {
      if (bool(membership[field], "MEMBERSHIP_FLAG") !== contract[field]) {
        blockers.add(`${location}_${key.replace("|", "_")}_OPTIONS_DRIFT`);
      }
    }
  }
}

/** No result, including one without catalog drift, grants operational approval. */
export function assessG1Readiness(observation) {
  plainObject(observation, new Set(["format", "project_id", "source", "target", "catalog_sha256"]), "OBSERVATION");
  if (observation.format !== FORMAT || observation.project_id !== PROJECT) throw new Error("INVALID_PROJECT_OR_FORMAT");
  plainObject(observation.source, OBS_KEYS, "SOURCE");
  plainObject(observation.target, OBS_KEYS, "TARGET");
  if (observation.source.branch_id !== SOURCE_BRANCH || observation.source.database !== "iam_database" ||
      observation.target.branch_id !== TARGET_BRANCH || observation.target.database !== "iam_canonical_validation") {
    throw new Error("INVALID_SOURCE_OR_ISOLATED_TARGET");
  }
  const blockers = new Set();
  inspectGraph(observation.source, "SOURCE", blockers);
  inspectGraph(observation.target, "TARGET", blockers);
  if (count(observation.source.tables, "SOURCE_TABLES") !== 23) blockers.add("SOURCE_TABLE_COUNT_DRIFT");
  if (count(observation.source.ledger_rows, "SOURCE_LEDGER") !== 0) blockers.add("SOURCE_LEDGER_REVIEW_REQUIRED");
  if (count(observation.target.scoped_relations, "TARGET_RELATIONS") !== 0 ||
      count(observation.target.scoped_schemas, "TARGET_SCHEMAS") !== 0) blockers.add("TARGET_NOT_EMPTY");
  plainObject(observation.source.reader, READER_KEYS, "READER");
  const reader = observation.source.reader;
  if (!bool(reader.login, "READER_LOGIN") || bool(reader.bypassrls, "READER_BYPASSRLS")) {
    blockers.add("SOURCE_READER_UNSAFE_IDENTITY");
  }
  if (count(reader.broad_tables, "READER_BROAD") !== 0 || count(reader.create_schemas, "READER_CREATE") !== 0) {
    blockers.add("SOURCE_READER_EXCESS_PRIVILEGES");
  }
  if (count(reader.maintain_tables, "READER_MAINTAIN") !== 23 ||
      count(reader.usage_schemas, "READER_USAGE") !== 3) blockers.add("SOURCE_READER_INSUFFICIENT_LOCK_PRIVILEGES");
  plainObject(observation.catalog_sha256, new Set(["source", "target"]), "CATALOG_HASHES");
  if (!SHA256.test(observation.catalog_sha256.source) || !SHA256.test(observation.catalog_sha256.target)) {
    throw new Error("INVALID_CATALOG_SHA256");
  }
  if (observation.catalog_sha256.source !== observation.catalog_sha256.target) blockers.add("CATALOG_SHA256_DRIFT");
  // Never elevate self-reported snapshots or a perfectly matching role graph
  // into independent attestation, authorization, restore or rollback evidence.
  const diagnostics = [...blockers].sort();
  return {
    format: "peos/g1-offline-diagnostic/v1",
    state: diagnostics.length ? "BLOCKED" : "INDEPENDENT_REVIEW_REQUIRED",
    diagnostic_codes: diagnostics,
    read_only: true,
    external_tls_verified: false,
    backup_restored_and_verified: false,
    independent_change_approved: false,
    real_pg_dump_verified: false,
    release_authorized: false,
    production_cutover_authorized: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error("USAGE_G1_READINESS_REPORT_INPUT_JSON");
    const document = JSON.parse(readFileSync(process.argv[2], "utf8"));
    const report = assessG1Readiness(document);
    console.log(JSON.stringify(report, null, 2));
    // Nonzero regardless of catalog parity: external recovery/approval never
    // established by offline user-supplied JSON alone.
    process.exitCode = 2;
  } catch (error) {
    // Only fixed error codes; never print input, role names from untrusted
    // sources, secrets, raw JSON, paths, or parser error details.
    const reason = error.message.startsWith("INVALID_") || error.message.startsWith("USAGE_") ? error.message : "INVALID_INPUT";
    console.error(`G1_BLOCKED:${reason}`);
    process.exitCode = 2;
  }
}
