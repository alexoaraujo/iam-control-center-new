import test from "node:test";
import assert from "node:assert/strict";
import {decideScope,checkAppVariables,verifyDeployment,isAuth0CriticalFile,isAuth0GateFile} from "./sync-auth0-e2e-preview.mjs";
const sha="a".repeat(40),branch="feat/iam-api-rbac-lineage-20261110";
const host="iam-control-center-new-ci-preview.vercel.app",project="prj_OnuwD1iarOsXh6FFGkSpK4A5mj80";
const env={PR_HEAD_REPOSITORY:"alexoaraujo/iam-control-center-new",PR_HEAD_BRANCH:branch,PR_HEAD_SHA:sha,VERCEL_PROJECT_ID:project,VERCEL_TEAM_SLUG:"aoa4",E2E_CALLBACK_HOST:host,E2E_DEPLOYMENT_HOST:"iam-control-center-abc-aoa4.vercel.app"};
const domain={name:host,projectId:project,verified:true,gitBranch:branch};
const vars=[
{key:"AUTH0_DOMAIN",type:"plain",target:["preview","production"],value:"iam-control-center.us.auth0.com"},
{key:"APP_BASE_URL",type:"plain",target:["preview"],gitBranch:branch,value:"https://"+host},
{key:"E2E_CALLBACK_HOST",type:"plain",target:["preview"],gitBranch:branch,value:host},
{key:"E2E_CALLBACK_BRANCH",type:"plain",target:["preview"],gitBranch:branch,value:branch},
{key:"AUTH0_CLIENT_ID",type:"plain",target:["preview","production"],value:"public-client-id"},
{key:"AUTH0_CLIENT_SECRET",type:"sensitive",target:["preview"]},
{key:"AUTH0_SECRET",type:"sensitive",target:["preview"]}
];
test("authorized exact-branch scope proceeds without changing aliases",()=>{
 assert.deepEqual(decideScope(env,domain,["docs/README.md"]),{ready:true,callbackHost:host,callbackBranch:branch});
});
test("Auth0 gate changes without bound callback demand explicit security review, never ordinary skip",()=>{
 const e={...env,PR_HEAD_BRANCH:"fix/vercel-production-exact-sha-release-gate-20261114"};
 for(const file of [".github/workflows/quality.yml","scripts/sync-auth0-e2e-preview.mjs","scripts/sync-auth0-e2e-preview.test.mjs","scripts/auth0-preview-contract.test.mjs"]){
  assert.equal(isAuth0GateFile(file),true);
  assert.deepEqual(decideScope(e,domain,[file]),{ready:false,reason:"SECURITY_REVIEW_REQUIRED"});
 }
 assert.deepEqual(decideScope(e,domain,["scripts/vercel-ignore-build.mjs"]),{ready:false,reason:"BRANCH_NOT_BOUND_TO_CALLBACK"});
});
test("unbound Auth0, web, E2E or migrations changes cannot skip",()=>{
 const e={...env,PR_HEAD_BRANCH:"feature-other"};
 for(const file of ["apps/web/src/lib/auth0.ts",".github/e2e/auth0.spec.cjs","packages/shared/index.ts","database/migrations/0002.sql","scripts/bind-e2e-preview.mjs"]){
  assert.equal(isAuth0CriticalFile(file),true);
  assert.throws(()=>decideScope(e,domain,[file]),/require a separately authorized callback/);
 }
});
test("rejects untrusted repository, invalid SHA, changed callback, missing domain or unknown diff",()=>{
 assert.throws(()=>decideScope({...env,PR_HEAD_REPOSITORY:"fork/repo"},domain,[]),/Untrusted/);
 assert.throws(()=>decideScope({...env,PR_HEAD_SHA:"bad"},domain,[]),/Untrusted/);
 assert.throws(()=>decideScope({...env,E2E_CALLBACK_HOST:"evil.vercel.app"},domain,[]),/Unexpected/);
 assert.throws(()=>decideScope(env,{...domain,verified:false},[]),/Unverified/);
 assert.throws(()=>decideScope(env,domain,null),/Unknown PR change scope/);
});
test("Preview Auth0 metadata is validated without reading secret values",()=>{
 assert.deepEqual(checkAppVariables(vars,branch),{appBaseUrl:"https://"+host,auth0Domain:"iam-control-center.us.auth0.com"});
 for(const key of ["APP_BASE_URL","AUTH0_DOMAIN","E2E_CALLBACK_HOST","E2E_CALLBACK_BRANCH"]){
  assert.throws(()=>checkAppVariables(vars.filter(x=>x.key!==key),branch),/mismatch/);
 }
 assert.throws(()=>checkAppVariables(vars.filter(x=>x.key!=="AUTH0_SECRET"),branch),/Missing/);
 assert.throws(()=>checkAppVariables([...vars,vars[1]],branch),/Ambiguous/);
});
test("exact-SHA Vercel deployment and active second alias are mandatory",()=>{
 const a={alias:host,projectId:project,deploymentId:"dpl_test"},p={alias:env.E2E_DEPLOYMENT_HOST,projectId:project,deploymentId:"dpl_test"};
 const dep={id:"dpl_test",readyState:"READY",url:"immutable.vercel.app",project:{id:project},meta:{githubCommitSha:sha,githubCommitRef:branch,githubOrg:"alexoaraujo",githubRepo:"iam-control-center-new"}};
 assert.doesNotThrow(()=>verifyDeployment(env,a,dep,p));
 assert.throws(()=>verifyDeployment(env,a,dep,{...p,deploymentId:"other"}),/Live verified Preview/);
 assert.throws(()=>verifyDeployment(env,a,{...dep,meta:{...dep.meta,githubCommitSha:"b".repeat(40)}},p),/exact PR SHA/);
});
