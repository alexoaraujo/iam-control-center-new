#!/usr/bin/env node
// Offline review package only. No network, SQL execution, credentials or approval.
import { readFileSync } from "node:fs";
import { createPublicKey, verify } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { collectLineage, sha256 } from "../../scripts/check-migration-lineage.mjs";
import { reconcileCanonicalReadOnly, EXPECTED } from "./reconcile-canonical-readonly.mjs";

const HEX = /^[0-9a-f]{64}$/;
const SHA = /^[0-9a-f]{40}$/;
const BRANCH = /^br-[a-z0-9-]{3,80}$/;
const RUN = /^[1-9][0-9]{0,19}$/;
const CONTRACT = Object.freeze([
  { file: "0001_initial_iam_schema.sql", lineage: "clean-proposal",
    requires: ["EMPTY_REVIEWED_SCHEMA", "APPROVED_ROLE_GRAPH"], route: "ALTERNATIVE_ONLY" },
  { file: "0002_sessions_touch_contract.sql", lineage: "development-corrective",
    requires: ["APPROVED_CANONICAL_BASELINE", "APPROVED_ROLE_GRAPH", "SESSIONS_ORIGINAL_TRIGGER_CONTRACT"], route: "CANONICAL_CANDIDATE" },
  { file: "0003_set_tenant_context_search_path.sql", lineage: "canonical-source-corrective",
    requires: ["APPROVED_CANONICAL_BASELINE", "APPROVED_ROLE_GRAPH", "TENANT_CONTEXT_DEFINITION_CONTRACT"], route: "CANONICAL_CANDIDATE" },
  { file: "0004_auth0_identity_sync_capability.sql", lineage: "auth0-identity-sync-proposal",
    requires: ["APPROVED_CANONICAL_BASELINE", "APPROVED_ROLE_GRAPH", "IDENTITIES_FORCE_RLS_OWNER_POLICY"], route: "CANONICAL_CANDIDATE" },
]);
function assert(ok, code) { if (!ok) throw Error(code); }
function keys(obj, expected, code) {
  assert(obj && typeof obj === "object" && !Array.isArray(obj) &&
    Object.keys(obj).length === expected.length &&
    expected.every(k => Object.hasOwn(obj,k)),code);
}
function digest(b) { return sha256(b); }
function stamp(s) {
  assert(typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s)
    && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s, "INVALID_TIMESTAMP");
  return Date.parse(s);
}
function json(bytes) {
  assert(Buffer.isBuffer(bytes) && bytes.length <= 8*1024*1024 && bytes.length > 0, "INVALID_ARTIFACT_SIZE");
  return JSON.parse(bytes.toString("utf8"));
}

// Only review the exact checked-in candidates. Extract the outer wrapper for
// a separate candidate digest. This is NOT a general SQL parser or executable
// transformation; no payload is returned or written, and reapproval is mandatory.
export function wrapperReview(bytes) {
  const sql = bytes.toString("utf8");
  assert(Buffer.from(sql,"utf8").equals(bytes) && !sql.includes("\r"),"UNSUPPORTED_SQL_ENCODING");
  const m = /^(?:(?:--[^\n]*|\s*)\n)*BEGIN;\n([\s\S]+)\nCOMMIT;\n?$/.exec(sql);
  assert(m,"UNREVIEWED_TRANSACTION_WRAPPER");
  assert(!/^\s*(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|START TRANSACTION|END TRANSACTION|ABORT|RELEASE SAVEPOINT)\s*(?:;|$)/im.test(m[1])
    && !/^\s*\\/m.test(m[1]),"UNREVIEWED_TRANSACTION_BOUNDARY");
  return { source_sha256: digest(bytes), candidate_payload_sha256: digest(Buffer.from(m[1]+"\n")),
    disposition: "REVIEW_ONLY_NOT_EXECUTABLE" };
}
export function reviewInventory(root) {
  const lineage = collectLineage(root);
  return CONTRACT.map(c => {
    const row = lineage.candidates.find(x => x.file === c.file && x.lineage === c.lineage);
    assert(row?.status === "REVIEW_ONLY","INVALID_CANDIDATE_LINEAGE");
    const review = wrapperReview(readFileSync(resolve(root,"database/migrations",c.file)));
    assert(review.source_sha256 === row.sha256,"MIGRATION_BYTES_CHANGED");
    return { ...c, ...review };
  });
}
function ledgerShape(side) {
  const table = side.schema_manifest.relations.find(r => r.schema === "iam" && r.name === "schema_migrations");
  if (!table) return "ABSENT";
  const columns = table.columns;
  if (!Array.isArray(columns) || columns.some(c => typeof c.name !== "string") ||
      new Set(columns.map(c => c.name)).size !== columns.length) return "UNVERIFIED_STRUCTURE";
  const names = columns.map(c=>c.name).sort().join(",");
  if (names === "applied_at,checksum_sha256,execution_role,migration_id,source_sha") return "CANONICAL_COLUMN_NAMES_ONLY";
  if (names === "applied_at,applied_by,checksum,name,version") return "CLEAN_PROPOSAL_INCOMPATIBLE";
  return "UNRECOGNIZED_STRUCTURE";
}
function checkedKey(entry) {
  keys(entry,["public_key_pem","fingerprint_sha256"],"INVALID_TRUST_KEY");
  assert(typeof entry.public_key_pem === "string" && entry.public_key_pem.length < 2048
    && entry.public_key_pem.startsWith("-----BEGIN PUBLIC KEY-----") &&
    HEX.test(entry.fingerprint_sha256),"INVALID_TRUST_KEY");
  const key=createPublicKey(entry.public_key_pem);
  assert(key.asymmetricKeyType==="ed25519" &&
    digest(key.export({type:"spki",format:"der"}))===entry.fingerprint_sha256,"TRUST_KEY_FINGERPRINT_MISMATCH");
  return key;
}
function signature(key, bytes, sig) {
  assert(typeof sig==="string" && /^[A-Za-z0-9+/]{86}==$/.test(sig),"INVALID_SIGNATURE");
  const binary=Buffer.from(sig,"base64");
  assert(binary.length===64 && binary.toString("base64")===sig && verify(null,bytes,key,binary),"INVALID_SIGNATURE");
}
export function prepareBaseline({ packetBytes, evidenceBytes, signatures, trust, root, now=Date.now() }) {
  keys(trust,["format","expected_source_sha","collector","reviewer"],"INVALID_TRUST_CONTRACT");
  assert(trust.format==="iam-baseline-review-trust/v1" && SHA.test(trust.expected_source_sha),"INVALID_TRUST_CONTRACT");
  const collector=checkedKey(trust.collector), reviewer=checkedKey(trust.reviewer);
  assert(trust.collector.fingerprint_sha256!==trust.reviewer.fingerprint_sha256,"CUSTODY_KEYS_NOT_DISTINCT");
  const packet=json(packetBytes);
  keys(signatures,["collector","reviewer"],"INVALID_SIGNATURE_SET");
  // Both signatures cover the same exact bytes, not a mutable reserialization.
  signature(collector,packetBytes,signatures.collector);
  signature(reviewer,packetBytes,signatures.reviewer);
  keys(packet,["format","scope","source_sha","captured_at","project_id","database","evidence_sha256",
    "manifest_sql_sha256","policy_sha256","inventory","recovery","lease"],"INVALID_PACKET");
  assert(packet.format==="iam-baseline-review-packet/v1" && packet.scope==="OFFLINE_REVIEW_ONLY"
    && packet.source_sha===trust.expected_source_sha && packet.project_id===EXPECTED.project
    && packet.database===EXPECTED.database,"WRONG_PACKET_SCOPE");
  const captured=stamp(packet.captured_at);
  assert(captured<=now && now-captured<=24*3600000,"STALE_OR_FUTURE_CAPTURE");
  assert(packet.evidence_sha256===digest(evidenceBytes)
    && packet.manifest_sql_sha256===digest(readFileSync(resolve(root,"database/scripts/schema-manifest.sql")))
    && packet.policy_sha256===digest(readFileSync(resolve(root,"database/migrations/lineage-policy.json"))),
    "ARTIFACT_DIGEST_MISMATCH");
  const inventory=reviewInventory(root);
  assert(Array.isArray(packet.inventory) && packet.inventory.length===inventory.length,"INVALID_INVENTORY");
  for (let i=0;i<inventory.length;i++) {
    const candidate=packet.inventory[i], expected=inventory[i];
    keys(candidate,["file","source_sha256","candidate_payload_sha256"],"INVALID_INVENTORY");
    assert(candidate.file===expected.file && candidate.source_sha256===expected.source_sha256 &&
      candidate.candidate_payload_sha256===expected.candidate_payload_sha256,"INVENTORY_DIGEST_MISMATCH");
  }
  const evidence=json(evidenceBytes);
  const observation=reconcileCanonicalReadOnly(evidence,collectLineage(root));
  const lease=packet.lease;
  keys(lease,["branch_id","parent_branch_id","database","scope","created_at","expires_at","source_sha"],"INVALID_LEASE");
  const created=stamp(lease.created_at), expiry=stamp(lease.expires_at);
  assert(BRANCH.test(lease.branch_id) && ![EXPECTED.development,EXPECTED.production].includes(lease.branch_id)
    && lease.parent_branch_id===EXPECTED.development && lease.database===EXPECTED.database
    && lease.scope==="DISPOSABLE_REHEARSAL_REVIEW_ONLY" && lease.source_sha===packet.source_sha
    && captured<=created && created<=now && now<expiry && expiry-created<=24*3600000,"WRONG_OR_EXPIRED_LEASE");
  const recovery=packet.recovery;
  keys(recovery,["backup_run_id","restore_run_id","archive_sha256","restored_manifest_sha256","restore_branch_id",
    "source_sha","result","completed_at"],"INVALID_RECOVERY_REFERENCE");
  const completed=stamp(recovery.completed_at);
  assert(RUN.test(recovery.backup_run_id) && RUN.test(recovery.restore_run_id)
    && recovery.backup_run_id!==recovery.restore_run_id && HEX.test(recovery.archive_sha256)
    && HEX.test(recovery.restored_manifest_sha256) && recovery.source_sha===packet.source_sha
    && BRANCH.test(recovery.restore_branch_id)
    && ![lease.branch_id,EXPECTED.development,EXPECTED.production].includes(recovery.restore_branch_id)
    && recovery.result==="RESTORE_AND_ROLLBACK_REPORTED_PASS" && completed<=captured
    && now-completed<=24*3600000,"INVALID_RECOVERY_REFERENCE");
  return {
    format:"iam-baseline-preparation-report/v1", verdict:"BLOCKED",
    signature_status:"VALID_AGAINST_CALLER_SUPPLIED_KEYS_ONLY",
    trust_root_status:"NOT_INDEPENDENTLY_ATTESTED",
    packet_sha256:digest(packetBytes), evidence_sha256:digest(evidenceBytes),
    source_sha:packet.source_sha, inventory,
    ledger_structure:{source:ledgerShape(evidence.source),target:ledgerShape(evidence.target)},
    observation:observation.observation, comparison:observation.comparison,
    blockers:[...observation.diagnostics,"TRUST_ROOT_NOT_APPROVED","CHECKOUT_SHA_NOT_ATTESTED",
      "LIVE_LEASE_NOT_ATTESTED","RECOVERY_RUNS_NOT_INDEPENDENTLY_VERIFIED",
      "PAYLOAD_REVIEW_REQUIRED","CANONICAL_DAG_NOT_APPROVED"].sort(),
    controls:{authenticated_provenance:false, baseline_approved:false, recovery_verified:false,
      clone_authorized:false, payload_execution_allowed:false, ledger_backfill_allowed:false,
      g3_allowed:false, production_allowed:false},
  };
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    assert(process.argv.length===6,"INVALID_USAGE");
    const [packet,evidence,sigs,trust]=process.argv.slice(2).map(p=>readFileSync(p));
    const report=prepareBaseline({packetBytes:packet,evidenceBytes:evidence,signatures:json(sigs),
      trust:json(trust),root:resolve(import.meta.dirname,"../..")});
    process.stdout.write(JSON.stringify(report,null,2)+"\n");
    process.exitCode=1;
  } catch {
    process.stderr.write("BLOCKED_INVALID_BASELINE_REVIEW_PACKET\n");
    process.exitCode=2;
  }
}
