import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {PINNED,ALLOWED_PATHS,CRITICAL_PATHS,verifyCandidate} from './verify-g3-main-rebaseline-candidate.mjs';
const hash=n=>n.toString(16).padStart(40,'0');
const obj=n=>({sha:hash(n),mode:'100644',type:'blob'});
function f(){
  const a=new Map(),b=new Map();
  const changed_paths=ALLOWED_PATHS.map((path,i)=>{
    const old=i===0?null:obj(100+i),now=i===1?null:obj(200+i);
    if(old)a.set(path,{...old});if(now)b.set(path,{...now});
    return {path,status:!old?'added':!now?'removed':'modified',baseline:old,current:now};
  });
  const critical_unchanged=CRITICAL_PATHS.map((path,i)=>{
    const item=obj(i+1);a.set(path,{...item});b.set(path,{...item});return {path,object:item};
  });
  const m={format:'peos/g3-main-rebaseline-candidate/v1',
    repository:'alexoaraujo/iam-control-center-new',read_only:true,
    baseline:{pr:151,sha:PINNED.base,tree:PINNED.baseTree},
    candidate_main:{sha:PINNED.main,tree:PINNED.mainTree},
    compare:{ahead:111,behind:0,path_count:30},changed_paths,critical_unchanged,
    lease_candidate:{project:'tiny-rice-70320263',branch:'br-calm-forest-b6a1jpzs',
      parent:'br-muddy-bar-b63ksdy7',expires:'2026-11-27T22:00:00Z',approved:false},
    approvals:{independent_review:false,privileged_g3:false,
      real_grant_revoke:false,production_cutover:false}};
  return {m,a,b};
}
const check=x=>verifyCandidate(x.m,x.a,x.b);
test('30 immutable changed Git objects and 7 critical blobs: read only PASS',()=>{
  assert.deepEqual(check(f()),{verdict:'PASS_READ_ONLY_G3_MAIN_CANDIDATE',
    paths:30,critical:7,privileged_execution_allowed:false,lease_approved:false});
});
test('fail when extra unapproved file exists',()=>{
  const x=f();x.b.set('security/extra.yml',obj(902));
  assert.throws(()=>check(x),/UNDECLARED_DRIFT/);
});
test('fail when listed blob differs',()=>{
  const x=f();x.b.get(ALLOWED_PATHS[2]).sha=hash(910);
  assert.throws(()=>check(x),/MAIN_BLOB/);
});
test('fail when chmod or symlink type changed',()=>{
  for(const [mode,type] of [['100755','blob'],['120000','blob']]){
    const x=f();Object.assign(x.b.get(ALLOWED_PATHS[2]),{mode,type});
    assert.throws(()=>check(x),/MODE_OR_TYPE/);
  }
});
test('fail when critical RBAC or trusted workflow blob changes',()=>{
  for(const p of ['apps/web/src/lib/authorization.ts','.github/workflows/iam-main-postmerge-auth0-rbac.yml']){
    const x=f();x.b.get(p).sha=hash(930);
    assert.throws(()=>check(x),/UNDECLARED_DRIFT/);
  }
});
test('fail on SHA or tree drift, even when paths look correct',()=>{
  for(const mutate of [
    x=>x.m.baseline.sha=hash(901),
    x=>x.m.candidate_main.sha=hash(902),
    x=>x.m.candidate_main.tree=hash(903),
    x=>x.m.compare.ahead=112]){
    const x=f();mutate(x);assert.throws(()=>check(x),/BLOCKED_G3_MAIN_REBASELINE/);
  }
});
test('fail when lease branch, parent or expiry changed',()=>{
  for(const [key,value] of [['branch','br-wrong'],['parent','br-wrong'],
    ['expires','2027-11-27T22:00:00Z'],['approved',true]]){
    const x=f();x.m.lease_candidate[key]=value;
    assert.throws(()=>check(x),/BLOCKED_G3_MAIN_REBASELINE/);
  }
});
test('fail when any approval flag becomes true or goes missing',()=>{
  for(const flag of Object.keys(f().m.approvals)){
    const x=f();x.m.approvals[flag]=true;assert.throws(()=>check(x),/NO_APPROVAL/);
    const y=f();delete y.m.approvals[flag];assert.throws(()=>check(y),/APPROVAL_KEYS/);
  }
});
test('fail on duplicate path, missing path or incorrect status',()=>{
  const x=f();x.m.changed_paths[0].path=x.m.changed_paths[1].path;
  assert.throws(()=>check(x),/MANIFEST_PATHS/);
  const y=f();y.m.changed_paths.pop();assert.throws(()=>check(y),/MANIFEST_PATHS/);
  const z=f();z.m.changed_paths[0].status='modified';
  assert.throws(()=>check(z),/STATUS/);
});
test('reviewed PR128/150/151 historical checks remain and new approval stop is prior to old control',()=>{
  const s=readFileSync('.github/trusted/iam-main-postmerge-preflight.sh','utf8');
  for(const t of ['BASE_PR_HEAD="1f6073c990cca160e0c37604bd55181bc808806a"',
    'REVIEWED_APP_MERGE="633ed462566c63cb0307b7266ec147a25e3f84ee"',
    'pulls/151','control_merge','control_tree',
    'G3_REBASELINE_CANDIDATE_SHA="fcc379f39dbe49dfb9de857e4be19f1c4da3ddbf"',
    'G3_REBASELINE_CANDIDATE_TREE="a628c48bcb212c4bedc5ac616a274f24a2e3c05f"',
    'BLOCKED_G3_NEW_MAIN_BASELINE_NOT_INDEPENDENTLY_APPROVED']){
    assert.ok(s.includes(t),t);
  }
  assert.ok(s.indexOf('BLOCKED_G3_NEW_MAIN_BASELINE_NOT_INDEPENDENTLY_APPROVED') <
    s.indexOf('control_pr="$(gh api "repos/$REPO/pulls/151")"'));
});
