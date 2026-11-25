import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const PIN = Object.freeze({
  project: "twilight-fire-88497009", branch: "br-little-fire-b6adup9f",
  database: "iam_database", migration_id: "0001_context_key_hardening",
  source_sha: "b80c98c51746e1d49039015eb649b9bdd735ef7f",
  checksum_sha256: "2447395628fa0f1230abd95eb522e5b45d1baea1208c9c21b20346a10718fbab",
  git_blob: "a471428ef2f8ec068fbc9b7f7590df3caed997ad",
  path: "database/migrations/0001_context_key_hardening.sql",
  byte_length: 4679
});
const fail = () => { throw new Error("BLOCKED_LEGACY_PROVENANCE"); };

export function verifyPolicy(policy, baseline) {
  const h = policy?.historical_ledger, b = baseline?.legacy_ledger;
  if (policy?.execution_authorized !== false || policy?.canonical_baseline?.status !== "BLOCKED"
      || baseline?.approved_for_migration !== false || b?.adopt_without_execution !== false
      || !h || !b) fail();
  for (const k of ["migration_id","source_sha","checksum_sha256"]) {
    if (h[k] !== PIN[k] || b[k] !== PIN[k]) fail();
  }
  for (const k of ["project","branch","database"]) if (h[k] !== PIN[k]) fail();
}

export function verifyBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== PIN.byte_length
      || createHash("sha256").update(bytes).digest("hex") !== PIN.checksum_sha256) fail();
  const gitHash = createHash("sha1").update("blob "+bytes.length+"\0").update(bytes).digest("hex");
  if (gitHash !== PIN.git_blob) fail();
  return {result:"PASS_HISTORICAL_FILE_BYTES_ONLY", source_sha:PIN.source_sha,
    checksum_sha256:PIN.checksum_sha256, git_blob:PIN.git_blob, byte_length:bytes.length,
    live_ledger_authenticated:false, baseline_approved:false, execution_authorized:false,
    ledger_adoption_authorized:false};
}

export function verify(root) {
  verifyPolicy(JSON.parse(readFileSync(resolve(root,"database/migrations/lineage-policy.json"),"utf8")),
    JSON.parse(readFileSync(resolve(root,"database/baselines/legacy-source-candidate.json"),"utf8")));
  const git = (...args) => execFileSync("git", ["-C",root,...args],
    {encoding:null,timeout:10000,maxBuffer:65536,stdio:["ignore","pipe","pipe"]});
  if (git("rev-parse","--verify",PIN.source_sha+"^{commit}").toString().trim() !== PIN.source_sha
    || git("rev-parse","--verify",PIN.source_sha+":"+PIN.path).toString().trim() !== PIN.git_blob) fail();
  return verifyBytes(git("cat-file","blob",PIN.git_blob));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(verify(resolve(import.meta.dirname,"..")))); }
  catch { console.error("BLOCKED_LEGACY_PROVENANCE"); process.exitCode=1; }
}
