import test from 'node:test';
import assert from 'node:assert/strict';
import { compareManifests, report } from './compare-schema-manifests.mjs';
import { compareLedgers } from './compare-migration-ledgers.mjs';

// All records are synthetic, catalog-only fixtures. No database credentials,
// application rows, tokens, or mutable SQL are used by these tests.
const sections = [
  'schemas', 'relations', 'sequences', 'routines', 'aggregates',
  'types', 'triggers', 'policies', 'extensions', 'expanded_object_acls',
  'default_acls', 'database_acl', 'roles', 'role_memberships',
];
const manifest = () => ({
  format: 'iam-postgresql-schema-manifest/v1',
  database: 'iam_database',
  server_version: '18.7 (a21afb5)',
  server_version_num: 180007,
  ...Object.fromEntries(sections.map(name => [name, []])),
});
const originBranch = 'br-little-fire-b6adup9f';
const devBranch = 'br-ancient-term-b6mmx5ol';
const ledger = (branch_id, rows) => ({format:'iam-ledger-provenance/v1',branch_id,rows});
const legacyRow = {
  migration_id: '0001_context_key_hardening',
  checksum_sha256: '2447395628fa0f1230abd95eb522e5b45d1baea1208c9c21b20346a10718fbab',
  source_sha: 'b80c98c51746e1d49039015eb649b9bdd735ef7f',
  applied_at: '2026-11-05T04:16:49.492Z',
  execution_role: 'iam_migrator_login',
};

test('G2: identical function bodies do not mask changed SECURITY DEFINER search_path', () => {
  const source=manifest(), target=manifest();
  const routine={
    schema:'iam',name:'set_tenant_context',
    identity_arguments:'p_tenant_id uuid, p_identity_id uuid, p_expires_at bigint, p_nonce text, p_signature text',
    kind:'f', owner:'iam_owner', security_definer:true,
    // Real catalog source/target hashes; only metadata, never function bodies.
    definition_sha256:'69b3095ee029d043130bdfa99f6f18d0407f95bbf1b9ffd18bd63602f2aa313b',
    configuration:['search_path=pg_catalog, app_private, iam, public'],
  };
  source.routines=[routine];
  target.routines=[{...routine,
    definition_sha256:'73b66c2c9085f628043bc8566ff35b38d16988b10e5fdb64d78bc74031bf9379',
    configuration:['search_path=pg_catalog, app_private, iam'],
  }];
  const out=compareManifests(source,target);
  assert.equal(out.equal,false);
  assert.deepEqual(out.differences,[
    'routines.iam.set_tenant_context('+routine.identity_arguments+') [changed]',
  ]);
  assert.doesNotMatch(report(source,target),/[a-f0-9]{64}/i);
});

test('G2: historical migration cannot be fabricated or treated as target parity', () => {
  const result=compareLedgers(ledger(originBranch,[legacyRow]),ledger(devBranch,[]));
  assert.equal(result.verdict,'BLOCKED');
  assert.equal(result.source_count,1);
  assert.equal(result.target_count,0);
  assert.deepEqual(result.differences,[
    {migration_id:'0001_context_key_hardening',reason:'missing_target_row'},
  ]);
});

test('G2: six new runtime default ACL privileges require explicit review', () => {
  const source=manifest(), target=manifest();
  const privileges=[['r','SELECT'],['r','INSERT'],['r','UPDATE'],['r','DELETE'],
    ['S','SELECT'],['S','USAGE']];
  target.default_acls=privileges.map(([object_type,privilege])=>({
    schema:null,owner:'neondb_owner',object_type,
    grantee:'iam_app_runtime_login',privilege,grantor:'neondb_owner',
    grantable:false,
  }));
  const result=compareManifests(source,target);
  assert.equal(result.equal,false);
  assert.equal(result.count,6);
  assert.ok(result.differences.every(d=>d.startsWith('default_acls.') && d.endsWith(' [added]')));
});

test('G2: changed inherited/SET role privileges remain material',()=>{
  const source=manifest(),target=manifest();
  const membership={
    role:'iam_app_runtime',member:'iam_app_runtime_login',grantor:'iam_owner',
    admin_option:false,inherit_option:true,set_option:true,
  };
  source.role_memberships=[membership];
  target.role_memberships=[{...membership,set_option:false}];
  assert.deepEqual(compareManifests(source,target).differences,[
    'role_memberships.["iam_app_runtime","iam_app_runtime_login","iam_owner"] [changed]',
  ]);
});

test('G2: changed grantor is not silently normalized as a provider alias',()=>{
  const source=manifest(),target=manifest();
  const grant={
    role:'iam_app_runtime',member:'iam_app_runtime_login',
    admin_option:false,inherit_option:true,set_option:true,
  };
  source.role_memberships=[{...grant,grantor:'iam_database_owner'}];
  target.role_memberships=[{...grant,grantor:'neondb_owner'}];
  const result=compareManifests(source,target);
  assert.equal(result.count,2);
  assert.equal(result.equal,false);
});

test('G2: same RLS policy count cannot hide a changed policy expression',()=>{
  const source=manifest(),target=manifest();
  const policy={
    schema:'iam',table:'tenants',name:'tenant_isolation',command:'ALL',
    permissive:'PERMISSIVE',using:'(source tenant predicate)',with_check:'(source tenant predicate)',
  };
  source.policies=[policy];
  target.policies=[{...policy,using:'(target tenant predicate)'}];
  const out=compareManifests(source,target);
  assert.deepEqual(out.differences,['policies.iam.tenants.tenant_isolation [changed]']);
  assert.doesNotMatch(report(source,target),/source tenant predicate|target tenant predicate/);
});
