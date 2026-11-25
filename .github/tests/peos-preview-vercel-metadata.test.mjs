import { test } from "node:test";
import assert from "node:assert/strict";
import { REPO, ENV, validateContext, validatePR, validateProtection, validateApproval, inspectVercel } from "../trusted/peos-preview-vercel-metadata.mjs";
const a="a".repeat(40), b="b".repeat(40);
const host="iam-control-center-new-pr199-ci.vercel.app";
const branch="security/peos-environments-governance-20261125";
const context={GITHUB_REPOSITORY:REPO,GITHUB_REPOSITORY_ID:"1451861889",GITHUB_REPOSITORY_OWNER_ID:"325264809",
 GITHUB_EVENT_NAME:"workflow_dispatch",GITHUB_REF:"refs/heads/main",GITHUB_WORKFLOW_REF:REPO+"/.github/workflows/peos-preview-vercel-metadata.yml@refs/heads/main",
 GITHUB_ACTOR:"alexoaraujo",GITHUB_ACTOR_ID:"325264809",GITHUB_TRIGGERING_ACTOR:"alexoaraujo",GITHUB_SHA:a,GITHUB_WORKFLOW_SHA:a,CHECKOUT_SHA:a,
 EXPECTED_MAIN_SHA:a,EXPECTED_PR_SHA:b,PR_NUMBER:"199"};
const repo={id:1451861889,full_name:REPO};
const pr={number:199,state:"open",head:{repo,sha:b,ref:branch},base:{repo,sha:a,ref:"main"}};
const main={commit:{sha:a}};
const identity={branch,host,sha:b};
const meta={name:ENV,id:1,can_admins_bypass:false,deployment_branch_policy:{protected_branches:false,custom_branch_policies:true},
 protection_rules:[{type:"branch_policy"},{type:"required_reviewers",prevent_self_review:true,reviewers:[{type:"User",reviewer:{id:2}}]}]};
const policies={total_count:1,branch_policies:[{type:"branch",name:"main"}]};
const custom={total_count:0,custom_deployment_protection_rules:[]};
const approved={...context,APPROVED_PR_SHA:b,APPROVED_MAIN_SHA:a,APPROVED_PR_NUMBER:"199",APPROVED_CALLBACK_HOST:host,
 OPERATOR_APPROVAL:"APPROVED_PREVIEW_METADATA_ONLY",TOKEN_SCOPE_ATTESTATION:"READ_ONLY_PREVIEW_TOKEN_SCOPE_VERIFIED",PREVIEW_VERCEL_READ_TOKEN:"synthetic"};
test("trusted main dispatch accepted",()=>validateContext(context));
test("PR event and non-main reject",()=>{for(const e of [{GITHUB_EVENT_NAME:"pull_request"},{GITHUB_REF:"refs/heads/other"}])assert.throws(()=>validateContext({...context,...e}));});
test("checkout, actor and workflow SHA reject",()=>{for(const e of [{CHECKOUT_SHA:b},{GITHUB_TRIGGERING_ACTOR:"other"},{GITHUB_WORKFLOW_SHA:b}])assert.throws(()=>validateContext({...context,...e}));});
test("exact open PR identity accepted",()=>assert.deepEqual(validatePR(context,main,pr),identity));
test("fork, stale main, stale PR, unbound callback reject",()=>{
 assert.throws(()=>validatePR(context,{commit:{sha:b}},pr));
 for(const head of [{...pr.head,repo:{...repo,id:9}},{...pr.head,sha:a},{...pr.head,ref:"unknown"}])assert.throws(()=>validatePR(context,main,{...pr,head}));
});
test("main-only reviewer no-bypass contract",()=>validateProtection(meta,policies,custom));
test("no reviewer, self-review, bypass and wildcard reject",()=>{
 assert.throws(()=>validateProtection({...meta,can_admins_bypass:true},policies,custom));
 assert.throws(()=>validateProtection({...meta,protection_rules:[meta.protection_rules[0]]},policies,custom));
 assert.throws(()=>validateProtection({...meta,protection_rules:[meta.protection_rules[0],{...meta.protection_rules[1],prevent_self_review:false}]},policies,custom));
 assert.throws(()=>validateProtection(meta,{total_count:1,branch_policies:[{type:"branch",name:"*"}]},custom));
});
test("partial and custom policy reject",()=>{
 assert.throws(()=>validateProtection(meta,{...policies,total_count:2},custom));
 assert.throws(()=>validateProtection(meta,policies,{...custom,total_count:1}));
});
test("exact approval, no token access before approval",async()=>{
 validateApproval(approved,identity);
 let calls=0;
 await assert.rejects(()=>inspectVercel({...approved,APPROVED_PR_SHA:a},identity,async()=>{calls++;}));
 assert.equal(calls,0);
});
test("provider GET only, no redirects, metadata validated",async()=>{
 const project="prj_OnuwD1iarOsXh6FFGkSpK4A5mj80";
 const responses=[{name:host,projectId:project,verified:true,gitBranch:branch},
 {alias:host,projectId:project,deploymentId:"dpl_test"},
 {id:"dpl_test",target:null,readyState:"READY",project:{id:project},url:"test.vercel.app",meta:{githubCommitRef:branch,githubCommitSha:b,githubOrg:"alexoaraujo",githubRepo:"iam-control-center-new"}}];
 const read=async(url,opts)=>{assert.equal(url.origin,"https://api.vercel.com");assert.equal(opts.method,"GET");assert.equal(opts.redirect,"error");return {ok:true,json:async()=>responses.shift()};};
 assert.deepEqual(await inspectVercel(approved,identity,read),{sha:b,host,deployment_id:"dpl_test"});
 assert.equal(responses.length,0);
});
