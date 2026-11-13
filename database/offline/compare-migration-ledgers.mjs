#!/usr/bin/env node
// Ledger provenance comparison only. NEVER writes database rows or infers an application order.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const sha256=/^[a-f0-9]{64}$/i;
const sha=/^[a-f0-9]{40}$/i;
function parseLedger(input,side) {
  if(!input||Array.isArray(input)||input.format!=='iam-ledger-provenance/v1' ||
      typeof input.branch_id!=='string'||!/^br-[a-z0-9-]+$/.test(input.branch_id) ||
      !Array.isArray(input.rows)) throw Error(side+': invalid ledger export');
  const map=new Map();
  for(const row of input.rows) {
    if(!row||typeof row!=='object'||Array.isArray(row) ||
        typeof row.migration_id!=='string'||!/^\d{4}_[a-z0-9_]+$/.test(row.migration_id) ||
        typeof row.checksum_sha256!=='string'||!sha256.test(row.checksum_sha256) ||
        typeof row.source_sha!=='string'||!sha.test(row.source_sha) ||
        typeof row.execution_role!=='string'||!/^iam_[a-z0-9_]+$/.test(row.execution_role) ||
        typeof row.applied_at!=='string'||!Number.isFinite(Date.parse(row.applied_at)) ||
        map.has(row.migration_id)) throw Error(side+': invalid/duplicate migration row');
    map.set(row.migration_id,{...row,checksum_sha256:row.checksum_sha256.toLowerCase(),source_sha:row.source_sha.toLowerCase()});
  }
  return map;
}
export function compareLedgers(source,target) {
  const a=parseLedger(source,'source'),b=parseLedger(target,'target');
  if(source.branch_id===target.branch_id) throw Error('source and target must be distinct Neon branches');
  const differences=[];
  for(const id of [...new Set([...a.keys(),...b.keys()])].sort()) {
    const from=a.get(id),to=b.get(id);
    if(!from) differences.push({migration_id:id,reason:'unexpected_target_row'});
    else if(!to) differences.push({migration_id:id,reason:'missing_target_row'});
    else if(from.checksum_sha256!==to.checksum_sha256) differences.push({migration_id:id,reason:'checksum_mismatch'});
    else if(from.source_sha!==to.source_sha) differences.push({migration_id:id,reason:'source_commit_mismatch'});
    else if(from.execution_role!==to.execution_role) differences.push({migration_id:id,reason:'execution_role_mismatch'});
    // applied_at differs legitimately across separately replayed environments.
  }
  return {verdict:differences.length?'BLOCKED':'METADATA_MATCH_ONLY',differences,source_count:a.size,target_count:b.size};
}
export function printResult(result) {
  return 'Ledger: '+result.verdict+' source='+result.source_count+' target='+result.target_count+'\n'+
    result.differences.map(x=>x.migration_id+': '+x.reason).join('\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  if(process.argv.length!==4) {console.error('Usage: node database/offline/compare-migration-ledgers.mjs SOURCE.json TARGET.json');process.exitCode=2;}
  else try {
    const [a,b]=process.argv.slice(2).map(p=>JSON.parse(readFileSync(p,'utf8')));
    const r=compareLedgers(a,b);console.log(printResult(r));if(r.verdict==='BLOCKED')process.exitCode=1;
  }catch(e){console.error('Ledger inspection refused: '+e.message);process.exitCode=2;}
}
