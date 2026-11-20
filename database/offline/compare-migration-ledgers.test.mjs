import test from 'node:test';
import assert from 'node:assert/strict';
import {compareLedgers,printResult} from './compare-migration-ledgers.mjs';
const row={migration_id:'0001_context_key_hardening',checksum_sha256:'2447395628fa0f1230abd95eb522e5b45d1baea1208c9c21b20346a10718fbab',source_sha:'b80c98c51746e1d49039015eb649b9bdd735ef7f',execution_role:'iam_migrator_login',applied_at:'2026-11-05T04:16:49.492Z'};
const ledger=(branch_id,rows)=>({format:'iam-ledger-provenance/v1',branch_id,rows});

test('observed origin 1 migration vs NEW empty ledger must block',()=>{
 const result=compareLedgers(ledger('br-little-fire-b6adup9f',[row]),ledger('br-ancient-term-b6mmx5ol',[]));
 assert.equal(result.verdict,'BLOCKED');
 assert.deepEqual(result.differences,[{migration_id:row.migration_id,reason:'missing_target_row'}]);
});
test('matching immutable fields are metadata parity ONLY, never authorization',()=>{
 const b={...row,applied_at:'2026-11-12T04:00:00Z'};
 assert.equal(compareLedgers(ledger('br-a',[row]),ledger('br-b',[b])).verdict,'METADATA_MATCH_ONLY');
});
test('checksum and source SHA mismatch fail',()=>{
 const bad={...row,checksum_sha256:'a'.repeat(64)};
 assert.equal(compareLedgers(ledger('br-a',[row]),ledger('br-b',[bad])).differences[0].reason,'checksum_mismatch');
 const other={...row,source_sha:'f'.repeat(40)};
 assert.equal(compareLedgers(ledger('br-a',[row]),ledger('br-b',[other])).differences[0].reason,'source_commit_mismatch');
});
test('untracked target rows and role mismatch fail',()=>{
 const x=ledger('br-b',[{...row,execution_role:'iam_owner'}]);
 assert.equal(compareLedgers(ledger('br-a',[row]),x).differences[0].reason,'execution_role_mismatch');
 assert.equal(compareLedgers(ledger('br-a',[]),ledger('br-b',[row])).differences[0].reason,'unexpected_target_row');
});
test('reject malformed, forged, duplicate and same-branch ledgers',()=>{
 const a=ledger('br-a',[row]),b=ledger('br-b',[row]);
 assert.throws(()=>compareLedgers(a,a),/distinct/);
 assert.throws(()=>compareLedgers(ledger('br-a',[row,row]),b),/duplicate/);
 assert.throws(()=>compareLedgers(ledger('br-a',[{...row,checksum_sha256:'forged'}]),b),/invalid/);
 assert.throws(()=>compareLedgers(ledger('br-a',[{...row,source_sha:'not-a-hash'}]),b),/invalid/);
 assert.throws(()=>compareLedgers(ledger('br-a',[{...row,applied_at:'not-a-date'}]),b),/invalid/);
});
test('output excludes checksum, author and connection values',()=>{
 const r=compareLedgers(ledger('br-a',[row]),ledger('br-b',[]));
 assert.doesNotMatch(printResult(r),new RegExp(row.checksum_sha256));
 assert.doesNotMatch(printResult(r),new RegExp(row.source_sha));
 assert.match(printResult(r),/missing_target_row/);
});
