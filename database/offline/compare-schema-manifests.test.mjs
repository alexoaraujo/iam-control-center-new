import test from 'node:test';
import assert from 'node:assert/strict';
import {compareManifests,report} from './compare-schema-manifests.mjs';
const sections=['schemas','relations','sequences','routines','aggregates','types','triggers','policies','extensions','expanded_object_acls','default_acls','database_acl','roles','role_memberships'];
const base=()=>({format:'iam-postgresql-schema-manifest/v1',database:'iam_database',server_version:'18.6',server_version_num:180006,...Object.fromEntries(sections.map(s=>[s,[]]))});

test('equal PostgreSQL manifests pass',()=>{const a=base();assert.equal(compareManifests(a,structuredClone(a)).equal,true);});
test('policy drift fails closed without leaking policy expressions',()=>{
 const a=base(),b=base();a.policies=[{schema:'iam',table:'tenants',name:'read',using:'sensitive predicate'}];b.policies=[{...a.policies[0],using:'true'}];
 assert.equal(compareManifests(a,b).equal,false);
 assert.match(report(a,b),/policies.iam.tenants.read/);
 assert.doesNotMatch(report(a,b),/sensitive predicate|using.*true/);
});
test('ACL mismatch reports only relation name',()=>{
 const a=base(),b=base();a.relations=[{schema:'app_private',name:'context_keys',owner:'iam_owner',acl:'secret source'}];b.relations=[{...a.relations[0],acl:'secret target'}];
 assert.deepEqual(compareManifests(a,b).differences,['relations.app_private.context_keys [changed]']);
 assert.doesNotMatch(report(a,b),/secret source|secret target/);
});
test('SECURITY DEFINER configuration mismatch is visible',()=>{
 const a=base(),b=base();a.routines=[{schema:'iam',name:'set_tenant_context',identity_arguments:'uuid',kind:'f',definition_sha256:'a'.repeat(64),configuration:['pg_catalog,iam,public']}];b.routines=[{...a.routines[0],configuration:['pg_catalog,iam']}];
 assert.equal(compareManifests(a,b).count,1);
});
test('function body drift fails even when name, owner and search_path match',()=>{
 const a=base(),b=base();
 a.routines=[{schema:'iam',name:'set_tenant_context',identity_arguments:'uuid',kind:'f',definition_sha256:'a'.repeat(64),security_definer:true}];
 b.routines=[{...a.routines[0],definition_sha256:'b'.repeat(64)}];
 assert.equal(compareManifests(a,b).count,1);
 assert.match(report(a,b),/routines.iam.set_tenant_context/);
 assert.doesNotMatch(report(a,b),/[a-f0-9]{64}/i);
});
test('rejects unverified function bodies from incomplete or tampered manifests',()=>{
 const a=base(),b=base();
 a.routines=[{schema:'iam',name:'safe',identity_arguments:'',kind:'f',definition_sha256:'a'.repeat(64)}];
 b.routines=[{...a.routines[0]}];
 delete b.routines[0].definition_sha256;
 assert.throws(()=>compareManifests(a,b),/routine definition SHA-256/);
 b.routines[0].definition_sha256='forged';
 assert.throws(()=>compareManifests(a,b),/routine definition SHA-256/);
});
test('missing sections, duplicate object keys, unknown fields and metadata mismatch fail',()=>{
 const a=base();delete a.policies;assert.throws(()=>compareManifests(a,base()),/section policies/);
 const b=base();b.roles=[{name:'runtime'},{name:'runtime'}];assert.throws(()=>compareManifests(base(),b),/duplicate/);
 const c=base();c.database='wrong';c.unapproved_section=['secret value'];
 assert.equal(compareManifests(base(),c).count,2);assert.doesNotMatch(report(base(),c),/secret value/);
});
test('collection and property ordering do not induce false drift',()=>{
 const a=base(),b=base();a.schemas=[{name:'iam',owner:'iam_owner'},{name:'audit',owner:'iam_owner'}];
 b.schemas=[{owner:'iam_owner',name:'audit'},{owner:'iam_owner',name:'iam'}];
 assert.equal(compareManifests(a,b).equal,true);
});
