import test from "node:test";
import assert from "node:assert/strict";
import { PIN, verifyPolicy, verifyBytes, verify } from "./verify-legacy-provenance.mjs";
const valid=()=>[{execution_authorized:false,canonical_baseline:{status:"BLOCKED"},historical_ledger:{...PIN}},
 {approved_for_migration:false,legacy_ledger:{...PIN,adopt_without_execution:false}}];
test("policy remains fail closed",()=>{
  assert.doesNotThrow(()=>verifyPolicy(...valid()));
  for(const key of ["migration_id","source_sha","checksum_sha256","project","branch","database"]){
    const [p,b]=valid();p.historical_ledger[key]="wrong";
    assert.throws(()=>verifyPolicy(p,b),/BLOCKED/);
  }
  for(const [target,key] of [[0,"execution_authorized"],[1,"approved_for_migration"]]){
    const pair=valid();pair[target][key]=true;assert.throws(()=>verifyPolicy(...pair),/BLOCKED/);
  }
  const [p,b]=valid();b.legacy_ledger.adopt_without_execution=true;
  assert.throws(()=>verifyPolicy(p,b),/BLOCKED/);
});
test("reject altered or truncated bytes",()=>{
  assert.throws(()=>verifyBytes(Buffer.alloc(PIN.byte_length)),/BLOCKED/);
  assert.throws(()=>verifyBytes(Buffer.alloc(1)),/BLOCKED/);
});
test("real pinned git object verifies without authorization",()=>{
  const r=verify(new URL("..",import.meta.url).pathname);
  assert.equal(r.result,"PASS_HISTORICAL_FILE_BYTES_ONLY");
  for(const k of ["live_ledger_authenticated","baseline_approved","execution_authorized","ledger_adoption_authorized"])
    assert.equal(r[k],false);
});
