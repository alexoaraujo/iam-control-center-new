import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { prepareBaseline, reviewInventory, wrapperReview } from "../database/offline/prepare-canonical-baseline.mjs";
import { sha256 } from "./check-migration-lineage.mjs";
import { EXPECTED } from "../database/offline/reconcile-canonical-readonly.mjs";

const root=resolve(import.meta.dirname,"..");
const now=Date.parse("2026-11-23T23:00:00.000Z");
const sections=["schemas","relations","sequences","routines","aggregates","types","triggers","policies","extensions","expanded_object_acls","default_acls","database_acl","roles","role_memberships"];
const bytes=o=>Buffer.from(JSON.stringify(o));
const stamp=n=>new Date(n).toISOString();
function key() {
  const {publicKey,privateKey}=generateKeyPairSync("ed25519");
  return {privateKey,entry:{public_key_pem:publicKey.export({type:"spki",format:"pem"}),
    fingerprint_sha256:sha256(publicKey.export({type:"spki",format:"der"}))}};
}
function manifest(full) {
  const m={format:"iam-postgresql-schema-manifest/v1",database:EXPECTED.database,
    server_version_num:180007,server_version:"18.7",...Object.fromEntries(sections.map(s=>[s,[]]))};
  m.schemas=full?["iam","audit","app_private"].map(name=>({name,owner:"iam_owner"})):[{name:"public",owner:"neondb_owner"}];
  m.roles=[{name:"iam_app_runtime_login",login:true,superuser:false,bypass_rls:false}];
  if(full) m.relations=[{schema:"iam",name:"schema_migrations",kind:"r",
    columns:["migration_id","checksum_sha256","source_sha","applied_at","execution_role"].map(name=>({name}))}];
  return m;
}
function fixture(){
  const c=key(),r=key(),sha="a".repeat(40);
  const evidence={format:"iam-canonical-reconciliation-evidence/v1",project_id:EXPECTED.project,
    source:{branch_id:EXPECTED.development,database:EXPECTED.database,schema_manifest:manifest(true),
      ledger:{format:"iam-ledger-provenance/v1",branch_id:EXPECTED.development,rows:[]}},
    target:{branch_id:EXPECTED.production,database:EXPECTED.database,schema_manifest:manifest(false),ledger:null}};
  const packet={format:"iam-baseline-review-packet/v1",scope:"OFFLINE_REVIEW_ONLY",source_sha:sha,
    captured_at:stamp(now-120000),project_id:EXPECTED.project,database:EXPECTED.database,
    evidence_sha256:sha256(bytes(evidence)),manifest_sql_sha256:sha256(readFileSync(join(root,"database/scripts/schema-manifest.sql"))),
    policy_sha256:sha256(readFileSync(join(root,"database/migrations/lineage-policy.json"))),
    inventory:reviewInventory(root).map(({file,source_sha256,candidate_payload_sha256})=>({file,source_sha256,candidate_payload_sha256})),
    recovery:{backup_run_id:"1234",restore_run_id:"5678",archive_sha256:"b".repeat(64),restored_manifest_sha256:"c".repeat(64),
      restore_branch_id:"br-synthetic-restore",source_sha:sha,result:"RESTORE_AND_ROLLBACK_REPORTED_PASS",completed_at:stamp(now-180000)},
    lease:{branch_id:"br-synthetic-lease",parent_branch_id:EXPECTED.development,database:EXPECTED.database,
      scope:"DISPOSABLE_REHEARSAL_REVIEW_ONLY",created_at:stamp(now-60000),expires_at:stamp(now+3600000),source_sha:sha}};
  const trust={format:"iam-baseline-review-trust/v1",expected_source_sha:sha,collector:c.entry,reviewer:r.entry};
  const signed=()=>{const packetBytes=bytes(packet);return {packetBytes,evidenceBytes:bytes(evidence),
    signatures:{collector:sign(null,packetBytes,c.privateKey).toString("base64"),reviewer:sign(null,packetBytes,r.privateKey).toString("base64")},
    trust,root,now};};
  return {packet,evidence,trust,signed};
}

test("review inventory binds original bytes and separate non-executable payload digests",()=>{
  const i=reviewInventory(root);
  assert.equal(i.length,4);
  assert.equal(i[0].route,"ALTERNATIVE_ONLY");
  assert.ok(i.every(x=>x.source_sha256!==x.candidate_payload_sha256 && x.disposition==="REVIEW_ONLY_NOT_EXECUTABLE"));
  for(const sql of ["BEGIN;\nSELECT 1;\nCOMMIT;\nCOMMIT;\n","BEGIN;\n\\i x\nCOMMIT;\n","SELECT 1;\n"])
    assert.throws(()=>wrapperReview(Buffer.from(sql)));
});
test("valid dual signatures never establish authorization or historical ledger provenance",()=>{
  const f=fixture(), report=prepareBaseline(f.signed());
  assert.equal(report.verdict,"BLOCKED");
  assert.equal(report.ledger_structure.source,"CANONICAL_COLUMN_NAMES_ONLY");
  assert.equal(report.ledger_structure.target,"ABSENT");
  assert.ok(Object.values(report.controls).every(x=>x===false));
  assert.equal(report.signature_status,"VALID_AGAINST_CALLER_SUPPLIED_KEYS_ONLY");
  assert.ok(report.blockers.includes("SOURCE_MIGRATION_LEDGER_EMPTY"));
});
test("tampered evidence, signatures, inventory, scope and trust roots rejected",()=>{
  const f=fixture(); const a=f.signed();a.evidenceBytes=Buffer.concat([a.evidenceBytes,Buffer.from(" ")]);
  assert.throws(()=>prepareBaseline(a),/ARTIFACT_DIGEST/);
  const b=f.signed();b.packetBytes=Buffer.concat([b.packetBytes,Buffer.from(" ")]);
  assert.throws(()=>prepareBaseline(b),/INVALID_SIGNATURE/);
  const c=f.signed();c.signatures.reviewer=c.signatures.collector;
  assert.throws(()=>prepareBaseline(c),/INVALID_SIGNATURE/);
  for(const mutate of [
    x=>{x.packet.inventory[0].source_sha256="e".repeat(64);},
    x=>{x.packet.inventory[0].candidate_payload_sha256="e".repeat(64);},
    x=>{x.packet.scope="EXECUTE";},x=>{x.packet.approved=true;},
    x=>{x.trust.expected_source_sha="b".repeat(40);},
    x=>{x.trust.reviewer=x.trust.collector;},
    x=>{x.trust.collector.fingerprint_sha256="e".repeat(64);},
    x=>{x.packet.policy_sha256="e".repeat(64);},
  ]){const x=fixture();mutate(x);assert.throws(()=>prepareBaseline(x.signed()));}
});
test("rejects permanent or reused clone, expired lease and unbound recovery",()=>{
  for(const mutate of [
    x=>{x.packet.lease.branch_id=EXPECTED.production;},
    x=>{x.packet.lease.branch_id=EXPECTED.development;},
    x=>{x.packet.lease.parent_branch_id=EXPECTED.production;},
    x=>{x.packet.lease.expires_at=stamp(now-1);},
    x=>{x.packet.lease.expires_at=stamp(now+25*3600000);},
    x=>{x.packet.lease.source_sha="e".repeat(40);},
    x=>{x.packet.recovery.restore_branch_id=x.packet.lease.branch_id;},
    x=>{x.packet.recovery.restore_run_id=x.packet.recovery.backup_run_id;},
    x=>{x.packet.recovery.completed_at=stamp(now+1);},
    x=>{x.packet.recovery.source_sha="e".repeat(40);},
  ]){const x=fixture();mutate(x);assert.throws(()=>prepareBaseline(x.signed()));}
});
test("clean proposal ledger is reported incompatible and no row is generated",()=>{
  const f=fixture();f.evidence.source.schema_manifest.relations[0].columns=
    ["version","name","checksum","applied_at","applied_by"].map(name=>({name}));
  f.packet.evidence_sha256=sha256(bytes(f.evidence));
  const report=prepareBaseline(f.signed());
  assert.equal(report.ledger_structure.source,"CLEAN_PROPOSAL_INCOMPATIBLE");
  assert.equal(report.controls.ledger_backfill_allowed,false);
});
test("CLI rejects invalid inputs without leaking their contents",()=>{
  const tmp=mkdtempSync(join(tmpdir(),"baseline-prep-"));
  try{
    const f=fixture(); const v=f.signed();const inputs=[v.packetBytes,v.evidenceBytes,bytes(v.signatures),bytes(v.trust)];
    const paths=inputs.map((b,i)=>{const p=join(tmp,String(i));writeFileSync(p,b);return p;});
    const cli=()=>spawnSync(process.execPath,[join(root,"database/offline/prepare-canonical-baseline.mjs"),...paths],{encoding:"utf8"});
    // Freshness in the CLI uses wall clock, not the fixture clock.
    writeFileSync(paths[0],"PRIVATE_MALFORMED_EVIDENCE");
    const bad=cli();assert.equal(bad.status,2);assert.doesNotMatch(bad.stderr+bad.stdout,/PRIVATE_MALFORMED/);
  }finally{rmSync(tmp,{recursive:true,force:true});}
});
