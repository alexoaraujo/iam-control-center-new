/** Immutable read-only G3 main rebaseline candidate. NEVER grants privileged execution. */
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseRawTree} from './verify-g3-tree-inventory.mjs';
export const PINNED=Object.freeze({base:'6af7e9e62cbc7f6febf92e630ecf209b00b99981',
  baseTree:'5efd5e502d4d251f060545501c6aa94a1f154729',
  main:'fcc379f39dbe49dfb9de857e4be19f1c4da3ddbf',
  mainTree:'a628c48bcb212c4bedc5ac616a274f24a2e3c05f', ahead:111,paths:30,critical:7});
export const ALLOWED_PATHS=Object.freeze([".github/scripts/iam-g1-environment-readonly-attestation.py",".github/scripts/iam-g1-verify-main-checks.py",".github/tests/g1-pg18-private-toc.py",".github/tests/test-iam-g1-archive-authentication.py",".github/tests/test-iam-g1-b2-full-readback.py",".github/tests/test-iam-g1-environment-readonly-attestation.py",".github/tests/test-iam-g1-main-checks-pagination.py",".github/tests/test-iam-g1-real-restore.py",".github/workflows/iam-g1-b2-full-readback.yml",".github/workflows/iam-g1-b2-isolated-full-restore.yml",".github/workflows/iam-g1-environments-readonly-attestation.yml",".github/workflows/iam-g1-full-recovery-contract.yml",".github/workflows/iam-g1-real-restore-offline-contract.yml",".github/workflows/iam-g3-tree-inventory-offline.yml","database/offline/compare-migration-ledgers.mjs","database/offline/compare-migration-ledgers.test.mjs","docs/operations/iam-g1-b2-authenticated-restore-design-20261121.md","docs/operations/iam-g1-b2-real-restore-attestation-45060036018.md","docs/operations/iam-g1-real-isolated-restore-20261122.md","docs/operations/iam-g3-main-lineage-inventory-20261122.json","docs/operations/iam-g3-main-lineage-inventory-20261122.md","scripts/auth0-preview-contract.test.mjs","scripts/bind-e2e-preview.mjs","scripts/bind-e2e-preview.test.mjs","scripts/iam-g1-archive-authentication.py","scripts/iam-g1-b2-full-readback.py","scripts/iam-g1-full-restore.py","scripts/sync-auth0-e2e-preview.test.mjs","scripts/verify-g3-tree-inventory.mjs","scripts/verify-g3-tree-inventory.test.mjs"]);
export const CRITICAL_PATHS=Object.freeze([".github/trusted/iam-main-postmerge-preflight.sh",".github/trusted/g3-pr128.spec.cjs",".github/trusted/g3-pr128.playwright.config.cjs",".github/workflows/iam-main-postmerge-auth0-rbac.yml","apps/web/src/lib/authorization.ts","apps/web/src/lib/readiness.ts","database/migrations/lineage-policy.json"]);
const validSHA=/^[a-f0-9]{40}$/;
function stop(x){throw new Error('BLOCKED_G3_MAIN_REBASELINE_'+x)}
function eql(x,y,label){if(x!==y)stop(label)}
function validObject(x){
  return x&&typeof x==='object'&&!Array.isArray(x)&&validSHA.test(x.sha)&&
    ['100644','100755','120000','160000'].includes(x.mode)&&
    ['blob','commit'].includes(x.type)&&((x.mode==='160000')===(x.type==='commit'));
}
function checkObj(x,y,label){
  if(x===null){if(y!==undefined)stop(label);return}
  if(!validObject(x)||!y||x.sha!==y.sha||x.mode!==y.mode||x.type!==y.type)stop(label);
}
function exactPaths(list,expected,label){
  if(!Array.isArray(list)||list.length!==expected.length||
     new Set(list).size!==expected.length||list.some(v=>!expected.includes(v)))stop(label);
}
export function verifyCandidate(m,base,current){
  eql(m?.format,'peos/g3-main-rebaseline-candidate/v1','FORMAT');
  eql(m.repository,'alexoaraujo/iam-control-center-new','REPOSITORY');
  eql(m.read_only,true,'READ_ONLY');
  eql(m.baseline?.pr,151,'PR151');
  eql(m.baseline?.sha,PINNED.base,'BASE_SHA');
  eql(m.baseline?.tree,PINNED.baseTree,'BASE_TREE');
  eql(m.candidate_main?.sha,PINNED.main,'MAIN_SHA');
  eql(m.candidate_main?.tree,PINNED.mainTree,'MAIN_TREE');
  eql(m.compare?.ahead,PINNED.ahead,'AHEAD');
  eql(m.compare?.behind,0,'BEHIND');
  eql(m.compare?.path_count,PINNED.paths,'COUNT');
  if(!(base instanceof Map)||!(current instanceof Map))stop('MAP');
  const diff=[];
  for(const key of new Set([...base.keys(),...current.keys()])){
    const a=base.get(key),b=current.get(key);
    if(a&&!validObject(a)||b&&!validObject(b))stop('INVALID_GIT_OBJECT');
    if(!a||!b||a.sha!==b.sha||a.mode!==b.mode||a.type!==b.type)diff.push(key);
  }
  exactPaths(diff,ALLOWED_PATHS,'UNDECLARED_DRIFT');
  exactPaths(m.changed_paths?.map(x=>x?.path),ALLOWED_PATHS,'MANIFEST_PATHS');
  for(const entry of m.changed_paths){
    const a=base.get(entry.path),b=current.get(entry.path);
    const status=!a?'added':!b?'removed':'modified';
    eql(entry.status,status,'STATUS');
    if(a&&b&&(a.mode!==b.mode||a.type!==b.type))stop('MODE_OR_TYPE');
    checkObj(entry.baseline,a,'BASE_BLOB');
    checkObj(entry.current,b,'MAIN_BLOB');
  }
  exactPaths(m.critical_unchanged?.map(x=>x?.path),CRITICAL_PATHS,'CRITICAL_PATHS');
  for(const c of m.critical_unchanged){
    checkObj(c.object,base.get(c.path),'CRITICAL_BASE');
    checkObj(c.object,current.get(c.path),'CRITICAL_MAIN');
  }
  eql(m.lease_candidate?.project,'tiny-rice-70320263','LEASE_PROJECT');
  eql(m.lease_candidate?.branch,'br-calm-forest-b6a1jpzs','LEASE_BRANCH');
  eql(m.lease_candidate?.parent,'br-muddy-bar-b63ksdy7','LEASE_PARENT');
  eql(m.lease_candidate?.expires,'2026-11-27T22:00:00Z','LEASE_TTL');
  eql(m.lease_candidate?.approved,false,'LEASE_NOT_APPROVED');
  const flags=['independent_review','privileged_g3','real_grant_revoke','production_cutover'];
  exactPaths(Object.keys(m.approvals??{}),flags,'APPROVAL_KEYS');
  for(const flag of flags)eql(m.approvals[flag],false,'NO_APPROVAL_'+flag);
  return {verdict:'PASS_READ_ONLY_G3_MAIN_CANDIDATE',paths:PINNED.paths,critical:PINNED.critical,
    privileged_execution_allowed:false,lease_approved:false};
}
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:8*1024*1024});
export function verifyGitObjects(m){
  eql(git('rev-parse',PINNED.base+'^{tree}').trim(),PINNED.baseTree,'SOURCE_BASE_TREE');
  eql(git('rev-parse',PINNED.main+'^{tree}').trim(),PINNED.mainTree,'SOURCE_MAIN_TREE');
  const base=parseRawTree(git('ls-tree','-r','-z',PINNED.baseTree));
  const cur=parseRawTree(git('ls-tree','-r','-z',PINNED.mainTree));
  return verifyCandidate(m,base,cur);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  if(process.argv.length!==3)stop('CLI');
  const result=verifyGitObjects(JSON.parse(readFileSync(process.argv[2],'utf8')));
  console.log(JSON.stringify(result));
  console.log('HOLD_G3_PRIVILEGED: new SHA-bound approval and disposable lease custody missing');
}
