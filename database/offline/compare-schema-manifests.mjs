#!/usr/bin/env node
// Offline PostgreSQL schema-manifest/v1 comparator. Never queries a DB or prints DDL/ACL contents.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const collections = {
  schemas: x => x.name,
  relations: x => x.schema + '.' + x.name,
  sequences: x => x.schema + '.' + x.name,
  routines: x => x.schema + '.' + x.name + '(' + (x.identity_arguments ?? '') + ')',
  aggregates: x => x.schema + '.' + x.name + '(' + (x.identity_arguments ?? '') + ')',
  types: x => x.schema + '.' + x.name,
  triggers: x => x.schema + '.' + x.table + '.' + x.name,
  policies: x => x.schema + '.' + x.table + '.' + x.name,
  extensions: x => x.name,
  expanded_object_acls: x => [x.object_type,x.schema,x.object_name,x.grantee,x.privilege,x.grantor].join('|'),
  default_acls: x => [x.schema,x.owner,x.object_type,x.grantee,x.privilege,x.grantor].join('|'),
  database_acl: x => [x.database,x.owner,x.grantee,x.privilege,x.grantor].join('|'),
  roles: x => x.name,
  role_memberships: x => JSON.stringify(x),
};
const canonical = value => {
  if (Array.isArray(value)) return JSON.stringify(value.map(x => JSON.parse(canonical(x))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
  if (value !== null && typeof value === 'object') {
    return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])));
  }
  return JSON.stringify(value);
};
function validate(manifest, side) {
  if (!manifest || Array.isArray(manifest) || manifest.format !== 'iam-postgresql-schema-manifest/v1') {
    throw new Error(side + ': unexpected schema manifest version');
  }
  for (const [section, key] of Object.entries(collections)) {
    if (!Array.isArray(manifest[section])) throw new Error(side + ': missing/invalid section ' + section);
    const seen=new Set();
    for (const item of manifest[section]) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(side + ': malformed object in ' + section);
      const id=key(item);
      if (!id || id.includes('undefined') || seen.has(id)) throw new Error(side + ': missing/duplicate identity in ' + section);
      // A manifest without a routine body hash cannot prove canonical function parity.
      // Older/incomplete exports must be rejected rather than silently compared.
      if (section === 'routines' && item.kind !== 'a' &&
          (typeof item.definition_sha256 !== 'string' ||
           !/^[a-f0-9]{64}$/i.test(item.definition_sha256))) {
        throw new Error(side + ': missing/invalid routine definition SHA-256');
      }
      seen.add(id);
    }
  }
}
export function compareManifests(source,target) {
  validate(source,'source'); validate(target,'target');
  const differences=[];
  for (const key of ['database','server_version_num','server_version']) {
    if (canonical(source[key]) !== canonical(target[key])) differences.push('metadata.'+key);
  }
  const known=new Set(['format','database','server_version_num','server_version',...Object.keys(collections)]);
  for (const k of [...new Set([...Object.keys(source),...Object.keys(target)])].filter(x=>!known.has(x)).sort()) {
    if (canonical(source[k]) !== canonical(target[k])) differences.push('unrecognized.'+k);
  }
  for (const [section,key] of Object.entries(collections)) {
    const a=new Map(source[section].map(x=>[key(x),x]));
    const b=new Map(target[section].map(x=>[key(x),x]));
    for (const id of [...new Set([...a.keys(),...b.keys()])].sort()) {
      if (!a.has(id)) differences.push(section+'.'+id+' [added]');
      else if (!b.has(id)) differences.push(section+'.'+id+' [missing]');
      else if (canonical(a.get(id)) !== canonical(b.get(id))) differences.push(section+'.'+id+' [changed]');
    }
  }
  return {equal:differences.length===0,count:differences.length,differences};
}
export function report(source,target) {
  const result=compareManifests(source,target);
  return ['Manifest parity: '+(result.equal?'PASS':'DRIFT')+' ('+result.count+' differences)',
    ...result.differences.slice(0,50),
    ...(result.count>50?['... '+(result.count-50)+' further differences suppressed']:[])].join('\n');
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if (process.argv.length!==4) {console.error('Usage: node scripts/compare-schema-manifests.mjs SOURCE.json TARGET.json');process.exitCode=2;}
  else {
    try {
      const [a,b]=process.argv.slice(2).map(path=>JSON.parse(readFileSync(path,'utf8')));
      const result=compareManifests(a,b);
      console.log(report(a,b));
      if (!result.equal) process.exitCode=1;
    } catch(error) {console.error('Comparison refused: '+error.message);process.exitCode=2;}
  }
}
