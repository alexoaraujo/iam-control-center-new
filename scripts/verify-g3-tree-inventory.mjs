/**
 * PEOS G3: read-only, exact Git-object inventory verification.
 * This script is NOT a privileged executor and never yields G3 eligibility.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PINNED = Object.freeze({
  format: 'peos/g3-trusted-main-drift-observation/v1',
  repository: 'alexoaraujo/iam-control-center-new',
  baselineSha: '6af7e9e62cbc7f6febf92e630ecf209b00b99981',
  baselineTree: '5efd5e502d4d251f060545501c6aa94a1f154729',
  observedSha: 'aec29f9b9daaa979e02c25df2d027bd4d040aee7',
  observedTree: '987db2cfb0eb70e2038e9949be26138a640dd7fc',
  changeCount: 25,
  criticalCount: 7,
});
export const REVIEWED_CRITICAL_PATHS = Object.freeze([
  '.github/trusted/iam-main-postmerge-preflight.sh',
  '.github/trusted/g3-pr128.spec.cjs',
  '.github/trusted/g3-pr128.playwright.config.cjs',
  '.github/workflows/iam-main-postmerge-auth0-rbac.yml',
  'apps/web/src/lib/authorization.ts',
  'apps/web/src/lib/readiness.ts',
  'database/migrations/lineage-policy.json',
]);
export const REVIEWED_CHANGED_PATHS = Object.freeze([
  '.github/scripts/iam-g1-environment-readonly-attestation.py',
  '.github/scripts/iam-g1-verify-main-checks.py',
  '.github/tests/g1-pg18-private-toc.py',
  '.github/tests/test-iam-g1-archive-authentication.py',
  '.github/tests/test-iam-g1-b2-full-readback.py',
  '.github/tests/test-iam-g1-environment-readonly-attestation.py',
  '.github/tests/test-iam-g1-main-checks-pagination.py',
  '.github/tests/test-iam-g1-real-restore.py',
  '.github/workflows/iam-g1-b2-full-readback.yml',
  '.github/workflows/iam-g1-b2-isolated-full-restore.yml',
  '.github/workflows/iam-g1-environments-readonly-attestation.yml',
  '.github/workflows/iam-g1-full-recovery-contract.yml',
  '.github/workflows/iam-g1-real-restore-offline-contract.yml',
  'database/offline/compare-migration-ledgers.mjs',
  'database/offline/compare-migration-ledgers.test.mjs',
  'docs/operations/iam-g1-b2-authenticated-restore-design-20261121.md',
  'docs/operations/iam-g1-b2-real-restore-attestation-45060036018.md',
  'docs/operations/iam-g1-real-isolated-restore-20261122.md',
  'scripts/auth0-preview-contract.test.mjs',
  'scripts/bind-e2e-preview.mjs',
  'scripts/bind-e2e-preview.test.mjs',
  'scripts/iam-g1-archive-authentication.py',
  'scripts/iam-g1-b2-full-readback.py',
  'scripts/iam-g1-full-restore.py',
  'scripts/sync-auth0-e2e-preview.test.mjs',
]);
const SHA = /^[a-f0-9]{40}$/;
const MODES = new Set(['100644', '100755', '120000', '160000']);

function fail(reason) { throw new Error(`BLOCKED_G3_DRIFT_INVENTORY_${reason}`); }
function eq(actual, expected, reason) { if (actual !== expected) fail(reason); }
function assertObject(object, reason) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) fail(reason);
}
function assertEntry(entry, reason) {
  assertObject(entry, reason);
  if (!MODES.has(entry.mode) || !['blob', 'commit'].includes(entry.type) || !SHA.test(entry.sha)) fail(reason);
  // Git object semantics are an invariant: a submodule is a commit (160000), never a regular blob.
  if ((entry.mode === '160000') !== (entry.type === 'commit')) fail(reason);
}
function isSafePath(path) {
  return typeof path === 'string' && path.length > 0 && !/[\0\r\n]/.test(path) &&
    !path.startsWith('/') && !path.split('/').some(part => !part || part === '.' || part === '..');
}

/** Parse `git ls-tree -r -z <tree>` without executing anything in that tree. */
export function parseRawTree(raw) {
  if (typeof raw !== 'string' || !raw.endsWith('\0')) fail('TRUNCATED_TREE');
  const entries = new Map();
  for (const token of raw.split('\0').slice(0, -1)) {
    const m = token.match(/^(\d{6}) (blob|commit) ([0-9a-f]{40})\t(.+)$/s);
    if (!m || !isSafePath(m[4])) fail('TREE_FORMAT');
    if (entries.has(m[4])) fail('DUPLICATE_TREE_PATH');
    const o = { mode: m[1], type: m[2], sha: m[3] };
    assertEntry(o, 'TREE_OBJECT');
    entries.set(m[4], o);
  }
  return entries;
}

function validatePinnedManifest(m) {
  assertObject(m, 'MANIFEST_FORMAT');
  eq(m.format, PINNED.format, 'MANIFEST_FORMAT');
  eq(m.repository, PINNED.repository, 'REPOSITORY');
  assertObject(m.baseline, 'BASELINE');
  assertObject(m.observed_main, 'OBSERVED');
  eq(m.baseline.pr, 151, 'BASELINE_PR');
  eq(m.baseline.merge_sha, PINNED.baselineSha, 'BASELINE_SHA');
  eq(m.baseline.tree_sha, PINNED.baselineTree, 'BASELINE_TREE_SHA');
  eq(m.observed_main.sha, PINNED.observedSha, 'OBSERVED_SHA');
  eq(m.observed_main.tree_sha, PINNED.observedTree, 'OBSERVED_TREE_SHA');
  assertObject(m.compare, 'COMPARE');
  eq(m.compare.status, 'ahead', 'COMPARE_STATUS');
  eq(m.compare.ahead_by, 103, 'COMPARE_AHEAD');
  eq(m.compare.behind_by, 0, 'COMPARE_BEHIND');
  eq(m.compare.total_commits, 103, 'COMPARE_COMMITS');
  eq(m.compare.path_count, PINNED.changeCount, 'COMPARE_PATH_COUNT');
  if (!Array.isArray(m.changed_paths) || m.changed_paths.length !== PINNED.changeCount) fail('PATH_COUNT');
  if (!Array.isArray(m.critical_unchanged) || m.critical_unchanged.length !== PINNED.criticalCount) fail('CRITICAL_COUNT');
  if (m.critical_unchanged.some(x => !REVIEWED_CRITICAL_PATHS.includes(x?.path)) ||
      new Set(m.critical_unchanged.map(x => x.path)).size !== REVIEWED_CRITICAL_PATHS.length) fail('CRITICAL_PATH_ALLOWLIST');
  if (m.changed_paths.some(x => !REVIEWED_CHANGED_PATHS.includes(x?.path)) ||
      new Set(m.changed_paths.map(x => x.path)).size !== REVIEWED_CHANGED_PATHS.length) fail('CHANGE_PATH_ALLOWLIST');
  for (const key of ['read_only_observation']) eq(m[key], true, 'READ_ONLY_ONLY');
  for (const key of ['independently_reviewed', 'privileged_executor_authorized',
    'g3_live_grant_revoke_attested_on_current_main', 'new_g3_lease_approved',
    'production_cutover_authorized']) eq(m[key], false, 'APPROVAL_FLAG');
  assertObject(m.tree_object_attestation, 'ATTESTATION_MISSING');
  eq(m.tree_object_attestation.all_objects_enumerated, true, 'ATTESTATION_COMPLETE');
  eq(m.tree_object_attestation.baseline_tree_truncated, false, 'BASELINE_TRUNCATED');
  eq(m.tree_object_attestation.main_tree_truncated, false, 'OBSERVED_TRUNCATED');
  eq(m.tree_object_attestation.object_differences, PINNED.changeCount, 'ATTESTATION_COUNT');
  eq(m.tree_object_attestation.mode_only_differences, 0, 'MODE_ONLY_DIFFERENCE');
  eq(m.tree_object_attestation.critical_mode_and_type_unchanged, true, 'CRITICAL_MODE');
  eq(m.tree_object_attestation.contains_privilege_authorization, false, 'ATTESTATION_PRIVILEGE');
}

export function verifyObservedTreeInventory(m, oldObjects, newObjects) {
  validatePinnedManifest(m);
  if (!(oldObjects instanceof Map) || !(newObjects instanceof Map)) fail('TREE_MISSING');
  for (const map of [oldObjects, newObjects]) {
    if (!map.size) fail('TREE_EMPTY');
    for (const [path, entry] of map) {
      if (!isSafePath(path)) fail('UNSAFE_PATH');
      assertEntry(entry, 'INVALID_OBJECT');
    }
  }
  const delta = new Map();
  for (const path of new Set([...oldObjects.keys(), ...newObjects.keys()])) {
    const before = oldObjects.get(path), after = newObjects.get(path);
    if (!before || !after || before.sha !== after.sha || before.mode !== after.mode || before.type !== after.type) {
      delta.set(path, {before, after});
    }
  }
  eq(delta.size, PINNED.changeCount, 'UNDECLARED_TREE_DRIFT');
  const listed = new Set();
  for (const item of m.changed_paths) {
    assertObject(item, 'INVALID_CHANGE');
    if (!isSafePath(item.path) || listed.has(item.path)) fail('DUPLICATE_CHANGE');
    listed.add(item.path);
    const actual = delta.get(item.path);
    if (!actual) fail('UNLISTED_CHANGE');
    const { before, after } = actual;
    const status = before && after ? 'modified' : before ? 'removed' : 'added';
    eq(item.status, status, 'CHANGE_STATUS');
    for (const [actualValue, declaredValue, label] of [
      [before?.sha ?? null, item.base_blob, 'BASE_BLOB'],
      [after?.sha ?? null, item.main_blob, 'OBSERVED_BLOB'],
      [before?.mode ?? null, item.base_mode, 'BASE_MODE'],
      [after?.mode ?? null, item.main_mode, 'OBSERVED_MODE'],
      [before?.type ?? null, item.base_type, 'BASE_TYPE'],
      [after?.type ?? null, item.main_type, 'OBSERVED_TYPE'],
    ]) eq(declaredValue, actualValue, label);
    if ((before?.sha === after?.sha) && (!before || !after || before?.mode !== after?.mode || before?.type !== after?.type)) fail('MODE_ONLY_DRIFT');
  }
  if ([...delta.keys()].some(path => !listed.has(path))) fail('EXTRA_TREE_CHANGE');
  const critical = new Set();
  for (const item of m.critical_unchanged) {
    assertObject(item, 'INVALID_CRITICAL');
    if (!isSafePath(item.path) || critical.has(item.path) || listed.has(item.path)) fail('CRITICAL_OVERLAP');
    critical.add(item.path);
    const before = oldObjects.get(item.path), after = newObjects.get(item.path);
    if (!before || !after) fail('CRITICAL_MISSING');
    eq(item.unchanged, true, 'CRITICAL_DECLARED_CHANGE');
    eq(item.base_blob, before.sha, 'CRITICAL_BASE_BLOB');
    eq(item.main_blob, after.sha, 'CRITICAL_MAIN_BLOB');
    eq(item.base_mode, before.mode, 'CRITICAL_BASE_MODE');
    eq(item.main_mode, after.mode, 'CRITICAL_MAIN_MODE');
    eq(item.base_type, before.type, 'CRITICAL_BASE_TYPE');
    eq(item.main_type, after.type, 'CRITICAL_MAIN_TYPE');
    if (before.sha !== after.sha || before.mode !== after.mode || before.type !== after.type) fail('CRITICAL_DRIFT');
  }
  return Object.freeze({ verdict: 'PASS_READ_ONLY_INVENTORY', baseline: PINNED.baselineSha,
    observed_main: PINNED.observedSha, changed_paths: delta.size, critical_unchanged: critical.size,
    privileged_execution_allowed: false, g3_baseline_approved: false });
}

function git(...args) { return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd(); }
export function verifyFromLocalGit(manifestPath) {
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  validatePinnedManifest(m);
  for (const {commit, tree} of [
    { commit: PINNED.baselineSha, tree: PINNED.baselineTree },
    { commit: PINNED.observedSha, tree: PINNED.observedTree },
  ]) eq(git('rev-parse', `${commit}^{tree}`), tree, 'COMMIT_TREE_ID');
  const getTree = tree => parseRawTree(execFileSync('git', ['ls-tree', '-r', '-z', tree], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']
  }));
  return verifyObservedTreeInventory(m, getTree(PINNED.baselineTree), getTree(PINNED.observedTree));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const path = process.argv[2];
    if (!path || process.argv.length !== 3) fail('MANIFEST_PATH_REQUIRED');
    const result = verifyFromLocalGit(path);
    console.log(JSON.stringify(result));
    console.log('HOLD_G3_PRIVILEGED: review-only inventory cannot approve lease, code baseline or executor.');
  } catch (error) {
    console.error(error?.message?.startsWith('BLOCKED_G3_') ? error.message : 'BLOCKED_G3_DRIFT_INVENTORY_VERIFICATION_FAILED');
    process.exitCode = 1;
  }
}
