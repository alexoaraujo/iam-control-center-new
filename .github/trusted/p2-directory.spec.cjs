"use strict";
const { test, expect }=require("@playwright/test");
const { createHash }=require("node:crypto");
const loaded=require("postgres");
const postgres=loaded.default??loaded;
const IDS={a:"19700000-0000-4000-8000-000000000001",b:"19700000-0000-4000-8000-000000000002",actor:"19700000-0000-4000-8000-000000000003",member:"19700000-0000-4000-8000-000000000004",other:"19700000-0000-4000-8000-000000000005",ma:"19700000-0000-4000-8000-000000000006",mm:"19700000-0000-4000-8000-000000000007",mb:"19700000-0000-4000-8000-000000000008",role:"19700000-0000-4000-8000-000000000009"};
const issuer="https://iam-control-center.us.auth0.com/";
const baselineKey="synthetic-release-validation",temporaryKey="peos-p2-pr197-temporary";
const subjectHash="e8cd8b1bf515f595a4531fb01ed6ae3d42c8929d28a50416759789376423a9f0";
const ids=Object.values(IDS);
function check(ok,code){if(!ok)throw Error("BLOCKED_P2_"+code);}
const first=async (sql,q,args=[]) => (await sql.unsafe(q,args))[0];
async function snapshot(sql){
  return first(sql,`SELECT
    (SELECT count(*)::int FROM iam.tenants) tenants,
    (SELECT count(*)::int FROM iam.identities) identities,
    (SELECT count(*)::int FROM iam.memberships) memberships,
    (SELECT count(*)::int FROM iam.roles) roles,
    (SELECT count(*)::int FROM iam.role_permissions) role_permissions,
    (SELECT count(*)::int FROM iam.membership_roles) membership_roles,
    (SELECT count(*)::int FROM iam.schema_migrations) ledger,
    (SELECT count(*)::int FROM app_private.context_keys) keys,
    (SELECT count(*)::int FROM audit.events) audit_events,
    (SELECT count(*)::int FROM audit.outbox) audit_outbox,
    (SELECT count(*)::int FROM iam.permissions) permissions,
    (SELECT count(*)::int FROM iam.tenants WHERE id=ANY($1::uuid[]))+(SELECT count(*)::int FROM iam.identities WHERE id=ANY($1::uuid[]))+
    (SELECT count(*)::int FROM iam.memberships WHERE id=ANY($1::uuid[]))+(SELECT count(*)::int FROM iam.roles WHERE id=ANY($1::uuid[]))+
    (SELECT count(*)::int FROM iam.membership_roles WHERE membership_id=ANY($1::uuid[]) OR role_id=ANY($1::uuid[]))+
    (SELECT count(*)::int FROM iam.role_permissions WHERE role_id=ANY($1::uuid[])) AS residue,
    (SELECT encode(public.digest(secret,'sha256'),'hex') FROM app_private.context_keys WHERE key_id=$2 AND active) baseline_key,
    (SELECT count(*)::int FROM app_private.context_keys WHERE key_id=$3) temporary_key`,[ids,baselineKey,temporaryKey]);
}
async function identity(sql,target){
  const x=await first(sql,"SELECT current_database() db,current_setting('neon.branch_id',true) branch,current_user principal,session_user login,current_setting('server_version_num')::int version,pg_has_role(current_user,'iam_owner','SET') may_set,(SELECT NOT rolsuper AND NOT rolbypassrls AND rolcanlogin FROM pg_roles WHERE rolname='iam_app_runtime_login') runtime_safe");
  check(x.db===target.database&&x.branch===target.branch&&x.principal==="neondb_owner"&&x.login===x.principal&&x.version>=180000&&x.version<190000&&x.may_set&&x.runtime_safe,"DIRECT_SQL_IDENTITY");
}
async function owner(sql,guard,fn,cleanup=false){
  guard.validateExecution(process.env,Date.now(),cleanup);
  return sql.begin(async tx=>{
    await identity(tx,guard.TARGET);
    await tx.unsafe("SET LOCAL ROLE iam_owner");
    check((await first(tx,"SELECT current_user AS role")).role==="iam_owner","OWNER_ROLE");
    return fn(tx);
  });
}
async function http(page,kind,tenantId=IDS.a,identityId=IDS.actor){
  return page.evaluate(async input=>{
    const response=await fetch("/api/directory/read",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",cache:"no-store",body:JSON.stringify(input),redirect:"error"});
    return {status:response.status,body:await response.json(),cache:response.headers.get("cache-control")};
  },{tenantId,identityId,kind,cursor:null});
}
function denied(x){check(x.status===403&&x.cache==="no-store"&&JSON.stringify(x.body)===JSON.stringify({error:"forbidden"}),"HTTP_DENY");}
function allowed(x,expected){
  check(x.status===200&&x.cache==="no-store"&&Array.isArray(x.body?.rows)&&x.body.nextCursor===null,"HTTP_ALLOW");
  check(x.body.rows.length===expected.length&&x.body.rows.every((row,i)=>row.id===expected[i]&&row.status==="active"&&Object.keys(row).sort().join(",")==="displayName,id,status"),"PROJECTION");
}
test("P2 real Auth0 same-session directory grant, cross-tenant deny, revoke and cleanup",async({page})=>{
  const guard=await import("../../scripts/p2-protected-preflight.mjs");
  guard.validateExecution(process.env);
  await guard.verifyGitHub(process.env);
  await guard.verifyProvider(process.env);
  const {verifyPreviewAliases}=await import("../../scripts/verify-preview-alias.mjs");
  const immutable=await verifyPreviewAliases(process.env);
  const token=process.env.VERCEL_TRUSTED_OIDC_TOKEN;
  check(token&&process.env.AUTH0_E2E_USERNAME&&process.env.AUTH0_E2E_PASSWORD,"BROWSER_CREDENTIALS");
  const sql=postgres(process.env.P2_OWNER_DATABASE_URL,{max:1,connect_timeout:10,idle_timeout:5,prepare:false});
  let baseline,started=false,cdp,callback=false,failed=false,cleanupFailed=false;
  try{
    await identity(sql,guard.TARGET);
    check((await first(sql,"SELECT pg_try_advisory_lock(197,20261125) locked")).locked,"EXCLUSIVE_LOCK");
    baseline=await owner(sql,guard,snapshot);
    check(baseline.tenants===2&&baseline.identities===2&&baseline.memberships===2&&baseline.roles===1&&baseline.role_permissions===1&&baseline.membership_roles===0&&baseline.keys===1&&baseline.ledger===0&&baseline.audit_events===0&&baseline.audit_outbox===0&&baseline.permissions===16&&baseline.residue===0&&baseline.temporary_key===0&&typeof baseline.baseline_key==="string","BASELINE");
    check((await first(sql,"SELECT count(*)::int n FROM iam.permissions WHERE permission_key IN ('iam.tenant.read','iam.identity.read')")).n===2,"PERMISSIONS");
    cdp=await page.context().newCDPSession(page);
    await cdp.send("Fetch.enable",{patterns:[{urlPattern:"*",requestStage:"Request"}]});
    cdp.on("Fetch.requestPaused",async({requestId,request})=>{
      try{const u=new URL(request.url);const headers=Object.entries(request.headers).filter(([name])=>name.toLowerCase()!=="x-vercel-trusted-oidc-idp-token").map(([name,value])=>({name,value:String(value)}));
        if(u.origin==="https://"+guard.TARGET.preview){headers.push({name:"x-vercel-trusted-oidc-idp-token",value:token});if(u.pathname==="/auth/callback")callback=true;}
        await cdp.send("Fetch.continueRequest",{requestId,headers});
      }catch{await cdp.send("Fetch.failRequest",{requestId,errorReason:"Aborted"}).catch(()=>{});}
    });
    await page.goto("/protected");
    await expect(page).toHaveURL(/iam-control-center\.us\.auth0\.com/);
    const login=page.locator('input[name="username"],input[name="email"]').first();
    await login.fill(process.env.AUTH0_E2E_USERNAME);
    const password=page.locator('input[name="password"]');
    if(!(await password.isVisible().catch(()=>false)))await page.getByRole("button",{name:/continue/i}).first().click();
    await password.fill(process.env.AUTH0_E2E_PASSWORD);
    await page.getByRole("button",{name:/continue|log in|sign in/i}).last().click();
    await expect(page).toHaveURL(u=>u.origin==="https://"+guard.TARGET.preview&&u.pathname==="/protected");
    check(callback,"AUTH0_CALLBACK");
    const subject=await page.evaluate(async()=>{const r=await fetch("/auth/profile",{cache:"no-store",redirect:"error"});return r.ok?(await r.json()).sub:null;});
    check(typeof subject==="string"&&createHash("sha256").update(subject).digest("hex")===subjectHash,"AUTH0_SUBJECT");
    check(await verifyPreviewAliases(process.env)===immutable,"DEPLOYMENT_DRIFT");
    started=true;
    await owner(sql,guard,async tx=>{
      await tx.unsafe("UPDATE app_private.context_keys SET active=false WHERE key_id=$1 AND active",[baselineKey]);
      await tx.unsafe("INSERT INTO app_private.context_keys(key_id,secret,active) VALUES($1,decode($2,'hex'),true)",[temporaryKey,process.env.P2_CONTEXT_KEY_HEX]);
      await tx.unsafe("INSERT INTO iam.tenants(id,display_name) VALUES($1,'P2 Synthetic A'),($2,'P2 Synthetic B')",[IDS.a,IDS.b]);
      await tx.unsafe("INSERT INTO iam.identities(id,issuer,subject,display_name) VALUES($1,$2,$3,'P2 Actor'),($4,'https://p2.invalid/','p2-member','P2 Member'),($5,'https://p2.invalid/','p2-other','P2 Other')",[IDS.actor,issuer,subject,IDS.member,IDS.other]);
      await tx.unsafe("INSERT INTO iam.memberships(id,tenant_id,identity_id,status) VALUES($1,$2,$3,'active'),($4,$2,$5,'active'),($6,$7,$8,'active')",[IDS.ma,IDS.a,IDS.actor,IDS.mm,IDS.member,IDS.mb,IDS.b,IDS.other]);
      await tx.unsafe("INSERT INTO iam.roles(id,tenant_id,role_key,display_name) VALUES($1,$2,'peos_p2_read','P2 Synthetic Reader')",[IDS.role,IDS.a]);
      await tx.unsafe("INSERT INTO iam.role_permissions(tenant_id,role_id,permission_key) VALUES($1,$2,'iam.tenant.read'),($1,$2,'iam.identity.read')",[IDS.a,IDS.role]);
    });
    denied(await http(page,"identities"));
    await owner(sql,guard,tx=>tx.unsafe("INSERT INTO iam.membership_roles(tenant_id,membership_id,role_id) VALUES($1,$2,$3)",[IDS.a,IDS.ma,IDS.role]));
    allowed(await http(page,"organizations"),[IDS.a]);
    allowed(await http(page,"identities"),[IDS.actor,IDS.member]);
    console.log("PASS_P2_GRANT_HTTP_200");
    denied(await http(page,"identities",IDS.b));
    denied(await http(page,"identities",IDS.a,IDS.member));
    console.log("PASS_P2_CROSS_TENANT_AND_IDENTITY_HTTP_403");
    await owner(sql,guard,tx=>tx.unsafe("DELETE FROM iam.membership_roles WHERE tenant_id=$1 AND membership_id=$2 AND role_id=$3",[IDS.a,IDS.ma,IDS.role]));
    denied(await http(page,"identities"));
    denied(await http(page,"organizations"));
    console.log("PASS_P2_REVOKE_HTTP_403_SAME_SESSION");
    let rolled=false;
    try{await owner(sql,guard,async tx=>{await tx.unsafe("UPDATE iam.tenants SET display_name='P2 must roll back' WHERE id=$1",[IDS.a]);await tx.unsafe("SELECT 1/0");});}catch(e){rolled=e.code==="22012";}
    check(rolled&&(await owner(sql,guard,tx=>first(tx,"SELECT display_name FROM iam.tenants WHERE id=$1",[IDS.a]))).display_name==="P2 Synthetic A","ROLLBACK");
    console.log("PASS_P2_TRANSACTION_ROLLBACK");
    check(await verifyPreviewAliases(process.env)===immutable,"DEPLOYMENT_DRIFT");
  }catch{failed=true;}finally{
    if(started){try{
      await owner(sql,guard,async tx=>{
        await tx.unsafe("DELETE FROM iam.membership_roles WHERE tenant_id=$1 AND membership_id=$2 AND role_id=$3",[IDS.a,IDS.ma,IDS.role]);
        await tx.unsafe("DELETE FROM iam.role_permissions WHERE tenant_id=$1 AND role_id=$2 AND permission_key IN ('iam.tenant.read','iam.identity.read')",[IDS.a,IDS.role]);
        await tx.unsafe("DELETE FROM iam.roles WHERE id=$1 AND tenant_id=$2",[IDS.role,IDS.a]);
        await tx.unsafe("DELETE FROM iam.memberships WHERE id=ANY($1::uuid[]) AND tenant_id=ANY($2::uuid[])",[[IDS.ma,IDS.mm,IDS.mb],[IDS.a,IDS.b]]);
        await tx.unsafe("DELETE FROM iam.identities WHERE id=ANY($1::uuid[]) AND issuer IN ($2,'https://p2.invalid/')",[[IDS.actor,IDS.member,IDS.other],issuer]);
        await tx.unsafe("DELETE FROM iam.tenants WHERE id=ANY($1::uuid[])",[[IDS.a,IDS.b]]);
        await tx.unsafe("DELETE FROM app_private.context_keys WHERE key_id=$1",[temporaryKey]);
        await tx.unsafe("UPDATE app_private.context_keys SET active=true WHERE key_id=$1",[baselineKey]);
      },true);
      const after=await owner(sql,guard,snapshot,true);
      check(JSON.stringify(after)===JSON.stringify(baseline),"RESIDUE");
      console.log("PASS_P2_ZERO_RESIDUE_AND_BASELINE_RESTORED");
    }catch{cleanupFailed=true;}}
    if(cdp){await cdp.send("Fetch.disable").catch(()=>{});await cdp.detach().catch(()=>{});}
    await sql.end({timeout:5}).catch(()=>{});
  }
  check(!cleanupFailed,"CLEANUP_REQUIRES_EMERGENCY_REVIEW");
  check(!failed&&started,"EXECUTION_FAILED");
});
