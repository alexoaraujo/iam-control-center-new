import { test } from "node:test";
import assert from "node:assert/strict";
import { executeDryRun, getReadUsersToken, scanUsers, validateInput } from "./auth0-existing-users-dry-run.mjs";

const domain = "iam-control-center.us.auth0.com";
const env = {
  AUTH0_DOMAIN: domain,
  AUTH0_MGMT_CLIENT_ID: "synthetic-client",
  AUTH0_MGMT_CLIENT_SECRET: "synthetic-secret",
};
const config = validateInput(env);
const response = (body, status=200) => ({ok:status===200,status,json:async()=>body});
function mock(users) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({url,init});
    if (String(url).endsWith("/oauth/token")) {
      return response({access_token:"synthetic-access-token",token_type:"Bearer",scope:"read:users"});
    }
    return response(users);
  };
  return {fetcher,calls};
}

test("read-only scan fetches only approved fields and returns aggregate counts and digest", async()=>{
  const {fetcher,calls}=mock([
    {user_id:"auth0|synthetic-a",email:"a@example.test",email_verified:true,name:"A"},
    {user_id:"auth0|synthetic-b",email:"b@example.test",email_verified:false,name:"B"},
  ]);
  const summary=await executeDryRun(env,fetcher);
  assert.equal(summary.mode,"dry-run");
  assert.equal(summary.scanned,2);
  assert.equal(summary.written,0);
  assert.match(summary.sourceFingerprint,/^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(summary).includes("a@example.test"),false);
  assert.equal(JSON.stringify(summary).includes("auth0|synthetic-a"),false);
  assert.equal(calls.length,2);
  assert.equal(calls[0].init.method,"POST");
  assert.equal(JSON.parse(calls[0].init.body).scope,"read:users");
  assert.equal(calls[1].init.method,undefined);
  const u = new URL(calls[1].url);
  assert.equal(u.hostname,domain);
  assert.equal(u.searchParams.get("fields"),"user_id,email,email_verified,name");
  assert.equal(u.searchParams.get("per_page"),"100");
});

test("same population reorders deterministically and changed profiles change fingerprint", async()=>{
  const a={user_id:"auth0|a",email:"a@example.test",email_verified:true};
  const b={user_id:"auth0|b",email:"b@example.test",email_verified:false};
  const first=await executeDryRun(env,mock([a,b]).fetcher);
  const second=await executeDryRun(env,mock([b,a]).fetcher);
  const changed=await executeDryRun(env,mock([a,{...b,email:"changed@example.test"}]).fetcher);
  assert.equal(first.sourceFingerprint,second.sourceFingerprint);
  assert.notEqual(first.sourceFingerprint,changed.sourceFingerprint);
});

test("pagination repeats in pages of 100 and stops at last page",async()=>{
  const seen=[];
  const fetcher=async(url)=>{
    const u=new URL(url);
    const page=Number(u.searchParams.get("page"));
    seen.push(page);
    return response(page===0
      ? Array.from({length:100},(_,i)=>({user_id:"auth0|page0-"+i}))
      : [{user_id:"auth0|page1"}]);
  };
  const summary=await scanUsers(config,"synthetic-token",fetcher);
  assert.equal(summary.scanned,101);
  assert.deepEqual(seen,[0,1]);
});

test("fails on duplicate IDs, untrusted tenant and missing credentials",async()=>{
  assert.throws(()=>validateInput({...env,AUTH0_DOMAIN:"other.example"}),/Approved Auth0 domain/);
  assert.throws(()=>validateInput({...env,AUTH0_MGMT_CLIENT_SECRET:""}),/credentials missing/);
  await assert.rejects(scanUsers(config,"synthetic-token",async()=>response([{user_id:"auth0|x"},{user_id:"auth0|x"}])),/Duplicate/);
});

test("fails closed at 1,000-user API cap instead of silently truncating",async()=>{
  const fetcher=async(url)=>{
    const page=Number(new URL(url).searchParams.get("page"));
    return response(Array.from({length:100},(_,i)=>({user_id:"auth0|"+page+"-"+i})));
  };
  await assert.rejects(scanUsers(config,"synthetic-token",fetcher),/Pagination cap/);
});

test("fails on invalid token scope, wrong bearer type and API rejection without leaking tokens",async()=>{
  const bad=async()=>response({access_token:"sensitive-token",token_type:"Bearer",scope:"read:clients"});
  await assert.rejects(getReadUsersToken(config,bad),/insufficient read:users scope/);
  await assert.rejects(getReadUsersToken(config,async()=>response({access_token:"token",token_type:"MAC",scope:"read:users"})),/invalid type/);
  await assert.rejects(getReadUsersToken(config,async()=>response({secret:"private"},401)),/HTTP 401/);
  await assert.rejects(scanUsers(config,"synthetic-token",async()=>response({secret:"private"},429)),/HTTP 429/);
});
