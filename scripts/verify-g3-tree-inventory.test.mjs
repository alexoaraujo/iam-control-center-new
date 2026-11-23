import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRawTree, PINNED, REVIEWED_CRITICAL_PATHS, REVIEWED_CHANGED_PATHS, verifyObservedTreeInventory } from './verify-g3-tree-inventory.mjs';
const hex = i => i.toString(16).padStart(40, '0');
const clone = v => structuredClone(v);
const crit = REVIEWED_CRITICAL_PATHS;function fixture() {
  const a = new Map(), b = new Map();
  const critical_unchanged = crit.map((path, i) => {
    const item = { sha: hex(i + 1), mode: '100644', type: 'blob' };
    a.set(path, item); b.set(path, clone(item));
    return { path, base_blob: item.sha, main_blob: item.sha, unchanged: true, base_mode: item.mode, main_mode: item.mode, base_type: item.type, main_type: item.type };
  });
  const changed_paths = Array.from({length: 25}, (_, i) => {
    const path = REVIEWED_CHANGED_PATHS[i];
    const original = i === 0 ? undefined : {sha: hex(i + 100), mode: '100644', type: 'blob'};
    const current = {sha: hex(i + 200), mode: '100644', type: 'blob'};
    if (original) a.set(path, original);
    b.set(path, current);
    return {path, status: original ? 'modified' : 'added', base_blob: original?.sha ?? null,
      main_blob: current.sha, base_mode: original?.mode ?? null, main_mode: current.mode,
      base_type: original?.type ?? null, main_type: current.type};
  });
  const manifest = {format: PINNED.format, repository: PINNED.repository,
    baseline: {pr: 151, merge_sha: PINNED.baselineSha, tree_sha: PINNED.baselineTree},
    observed_main: {sha: PINNED.observedSha, tree_sha: PINNED.observedTree},
    compare: {status:'ahead', ahead_by:103, behind_by:0, total_commits:103, path_count:25},
    critical_unchanged, changed_paths,
    read_only_observation: true, independently_reviewed:false,
    privileged_executor_authorized:false, g3_live_grant_revoke_attested_on_current_main:false,
    new_g3_lease_approved:false, production_cutover_authorized:false,
    tree_object_attestation:{all_objects_enumerated:true, baseline_tree_truncated:false,main_tree_truncated:false,
      object_differences:25,mode_only_differences:0,critical_mode_and_type_unchanged:true,contains_privilege_authorization:false}
  };
  return {manifest,a,b};
}
test('read-only PASS never implies approval to execute', () => {
  const {manifest,a,b}=fixture();
  assert.deepEqual(verifyObservedTreeInventory(manifest,a,b), {
    verdict:'PASS_READ_ONLY_INVENTORY',baseline:PINNED.baselineSha,observed_main:PINNED.observedSha,
    changed_paths:25,critical_unchanged:7,privileged_execution_allowed:false,g3_baseline_approved:false
  });
});
test('reject unreviewed path injected into Git tree',()=>{
  const {manifest,a,b}=fixture();
  b.set('secret/workflow.yml',{sha:hex(950),mode:'100644',type:'blob'});
  assert.throws(()=>verifyObservedTreeInventory(manifest,a,b),/UNDECLARED_TREE_DRIFT/);
});
test('reject changed blob even on allowlisted path',()=>{
  const {manifest,a,b}=fixture();
  b.get(REVIEWED_CHANGED_PATHS[1]).sha=hex(701);
  assert.throws(()=>verifyObservedTreeInventory(manifest,a,b),/OBSERVED_BLOB/);
});
test('reject change in mode (chmod) or file type (symlink) on documented path',()=>{
  const {manifest,a,b}=fixture();
  b.get(REVIEWED_CHANGED_PATHS[2]).mode='100755';
  assert.throws(()=>verifyObservedTreeInventory(manifest,a,b),/OBSERVED_MODE/);
  const f=fixture();
  f.b.get(REVIEWED_CHANGED_PATHS[2]).mode='120000';
  assert.throws(()=>verifyObservedTreeInventory(f.manifest,f.a,f.b),/OBSERVED_MODE/);
});
test('reject altered critical authorization or workflow blob',()=>{
  const {manifest,a,b}=fixture();
  b.get('apps/web/src/lib/authorization.ts').sha=hex(777);
  assert.throws(()=>verifyObservedTreeInventory(manifest,a,b),/UNDECLARED_TREE_DRIFT/);
});
test('reject critical mode changes even without blob changes',()=>{
  const {manifest,a,b}=fixture();
  b.get(crit[0]).mode='100755';
  assert.throws(()=>verifyObservedTreeInventory(manifest,a,b),/UNDECLARED_TREE_DRIFT/);
});
test('reject unreviewed baseline, main SHA or tree substitution',()=>{
  for(const [key,obj] of [ ['baseline',{merge_sha:hex(22)}], ['observed_main',{sha:hex(23)}], ['observed_main',{tree_sha:hex(25)}] ]){
    const f=fixture();Object.assign(f.manifest[key],obj);
    assert.throws(()=>verifyObservedTreeInventory(f.manifest,f.a,f.b),/BLOCKED_G3_DRIFT_INVENTORY/);
  }
});
test('reject duplicate path, missing diff, invalid status and wrong commit count',()=>{
  for(const edit of [
    m=>m.changed_paths[1].path=m.changed_paths[0].path,
    m=>m.changed_paths[0].status='modified',
    m=>m.compare.ahead_by=102,
    m=>m.compare.path_count=24,
  ]){const {manifest,a,b}=fixture();edit(manifest);
    assert.throws(()=>verifyObservedTreeInventory(manifest,a,b),/BLOCKED_G3_DRIFT_INVENTORY/);
  }
});
test('reject substitutions even if another changed path and critical file are declared',()=>{
  const f=fixture();
  f.manifest.changed_paths[0].path='other/unapproved.mjs';
  f.b.set('other/unapproved.mjs',f.b.get(REVIEWED_CHANGED_PATHS[0]));
  f.b.delete(REVIEWED_CHANGED_PATHS[0]);
  assert.throws(()=>verifyObservedTreeInventory(f.manifest,f.a,f.b),/CHANGE_PATH_ALLOWLIST/);
  const g=fixture();
  g.manifest.critical_unchanged[0].path='other/unchanged.mjs';
  const item={sha:hex(555),mode:'100644',type:'blob'};
  g.a.set('other/unchanged.mjs',item);g.b.set('other/unchanged.mjs',item);
  assert.throws(()=>verifyObservedTreeInventory(g.manifest,g.a,g.b),/CRITICAL_PATH_ALLOWLIST/);
});
test('never allow a manifest authorization bit to become true',()=>{
  for(const flag of ['independently_reviewed','privileged_executor_authorized',
    'g3_live_grant_revoke_attested_on_current_main','new_g3_lease_approved','production_cutover_authorized']){
    const f=fixture();f.manifest[flag]=true;
    assert.throws(()=>verifyObservedTreeInventory(f.manifest,f.a,f.b),/APPROVAL_FLAG/);
  }
});
test('reject impossible Git object mode/type combinations',()=>{
  assert.throws(()=>parseRawTree('100644 commit '+hex(40)+'\\twrong.txt\\0'),/TREE_OBJECT/);
  assert.throws(()=>parseRawTree('160000 blob '+hex(41)+'\\tsubmodule\\0'),/TREE_OBJECT/);
  assert.deepEqual([...parseRawTree('160000 commit '+hex(42)+'\\tsubmodule\\0')],
    [['submodule',{mode:'160000',type:'commit',sha:hex(42)}]]);
});
test('reject partial/invalid Git output, duplicate paths and traversal',()=>{
  assert.throws(()=>parseRawTree('100644 blob '+hex(20)+'\tfile'),/TRUNCATED_TREE/);
  assert.throws(()=>parseRawTree('100644 blob '+hex(20)+'\t..\/file\0'),/TREE_FORMAT/);
  assert.throws(()=>parseRawTree('100644 blob '+hex(20)+'\tfile\0'+'100644 blob '+hex(21)+'\tfile\0'),/DUPLICATE_TREE_PATH/);
  assert.deepEqual([...parseRawTree('100644 blob '+hex(20)+'\ta.txt\0')], [['a.txt',{mode:'100644',type:'blob',sha:hex(20)}]]);
});
