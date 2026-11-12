"use strict";
const { test, expect } = require("@playwright/test");
const { createHash } = require("node:crypto");
const { neon } = require("@neondatabase/serverless");

const ID = {
  project: "tiny-rice-70320263", branch: "br-shy-scene-b67zm2v7",
  parent: "br-muddy-bar-b63ksdy7", name: "validation/iam-recovery-clone-20261110",
  host: "ep-bitter-mode-b6egeydz.c-2.sa-east-1.aws.neon.tech",
  tenant: "f65d8f1e-bcd4-4d68-927b-a8b64cda0c41",
  identity: "c7d196ad-4e1a-498c-b4ae-3e4d0ef2a041",
  membership: "c7d196ad-4e1a-498c-b4ae-3e4d0ef2a042",
  role: "c7d196ad-4e1a-498c-b4ae-3e4d0ef2a043",
  issuer: "https://iam-control-center.us.auth0.com/",
  hash: "e8cd8b1bf515f595a4531fb01ed6ae3d42c8929d28a50416759789376423a9f0",
};
const check = (condition, message) => { if (!condition) throw new Error(message); };
const countsQuery = "SELECT (SELECT count(*)::int FROM iam.tenants WHERE id=$1::uuid) tenants, "
  + "(SELECT count(*)::int FROM iam.identities WHERE id=$2::uuid) identities, "
  + "(SELECT count(*)::int FROM iam.memberships WHERE id=$3::uuid) memberships, "
  + "(SELECT count(*)::int FROM iam.roles WHERE id=$4::uuid) roles, "
  + "(SELECT count(*)::int FROM iam.membership_roles WHERE tenant_id=$1::uuid AND membership_id=$3::uuid) membership_roles, "
  + "(SELECT count(*)::int FROM iam.role_permissions WHERE tenant_id=$1::uuid AND role_id=$4::uuid) role_permissions, "
  + "(SELECT count(*)::int FROM app_private.context_keys WHERE active) active_keys, "
  + "(SELECT count(*)::int FROM iam.schema_migrations) ledger_rows";
const countKeys = ["tenants", "identities", "memberships", "roles", "membership_roles", "role_permissions"];
const counts = async (sql) => (await sql.query(countsQuery, [ID.tenant, ID.identity, ID.membership, ID.role]))[0];
const zero = (result) => countKeys.every((key) => result[key] === 0);
async function api(path) {
  const response = await fetch("https://console.neon.tech/api/v2" + path, {
    headers: { Authorization: "Bearer " + process.env.NEON_API_KEY, Accept: "application/json" },
    redirect: "error", signal: AbortSignal.timeout(12000),
  });
  check(response.ok, "Neon protected API lookup failed: HTTP " + response.status);
  return response.json();
}
async function connect() {
  check(process.env.GITHUB_REPOSITORY === "alexoaraujo/iam-control-center-new" &&
    process.env.GITHUB_EVENT_NAME === "pull_request" &&
    process.env.GITHUB_HEAD_REF === "feat/iam-api-rbac-lineage-20261110" &&
    process.env.E2E_RBAC_HTTP_ENABLED === "true" &&
    process.env.E2E_RBAC_PROJECT_ID === ID.project &&
    process.env.E2E_RBAC_BRANCH_ID === ID.branch, "RBAC HTTP gate limited to PR #41");
  check(process.env.E2E_CALLBACK_HOST === "iam-control-center-new-ci-preview.vercel.app" &&
    new URL(process.env.E2E_BASE_URL || "https://invalid.example").hostname === process.env.E2E_CALLBACK_HOST,
    "Callback/Preview origin does not match reviewed PR #41 alias");
  check(process.env.AUTH0_E2E_USERNAME && process.env.AUTH0_E2E_PASSWORD &&
    process.env.VERCEL_TRUSTED_OIDC_TOKEN, "Auth0 or Vercel protected E2E secrets missing");
  check(process.env.NEON_API_KEY,
    "RBAC HTTP BLOCKED: NEON_API_KEY must be configured as protected Preview environment secret");
  const response = await api("/projects/" + ID.project + "/branches/" + ID.branch);
  const branch = response.branch;
  check(branch?.id === ID.branch && branch.project_id === ID.project &&
    branch.name === ID.name && branch.parent_id === ID.parent &&
    !branch.default && !branch.primary && !branch.protected &&
    branch.current_state === "ready" && branch.expires_at &&
    new Date(branch.expires_at).getTime() > Date.now(), "Neon branch identity/TTL rejected");
  const params = new URLSearchParams({
    branch_id: ID.branch, database_name: "iam_database", role_name: "neondb_owner", pooled: "false",
  });
  const conn = await api("/projects/" + ID.project + "/connection_uri?" + params);
  check(typeof conn.uri === "string", "Neon branch-scoped connection URI unavailable");
  const uri = new URL(conn.uri);
  check(uri.protocol === "postgresql:" && uri.hostname === ID.host &&
    uri.pathname === "/iam_database" && decodeURIComponent(uri.username) === "neondb_owner" &&
    uri.password && uri.searchParams.get("sslmode") === "require", "Connection URI allowlist rejected");
  const sql = neon(conn.uri);
  const rows = await sql.query("SELECT current_database() db, current_setting('neon.branch_id',true) branch, current_user principal");
  check(rows.length === 1 && rows[0].db === "iam_database" &&
    rows[0].branch === ID.branch && rows[0].principal === "neondb_owner",
    "SQL session is not the approved Neon branch");
  const base = await counts(sql);
  check(zero(base) && base.active_keys === 1 && base.ledger_rows === 0,
    "Fixture IDs not clean or protected key/ledger baseline mismatch");
  const perm = await sql.query("SELECT count(*)::int n FROM iam.permissions WHERE permission_key='iam.tenant.read'");
  check(perm[0]?.n === 1, "Canonical permission not available (will not mutate global catalog)");
  return sql;
}
function q(sql, statement, args = []) { return sql.query(statement, args); }
async function owner(sql, queries) { return sql.transaction([q(sql,"SET LOCAL ROLE iam_owner"),...queries]); }
async function create(sql, subject) {
  await owner(sql, [
    q(sql,"INSERT INTO iam.tenants(id,slug,display_name) VALUES($1::uuid,'peos-auth0-http-41','PEOS disposable RBAC HTTP gate')",[ID.tenant]),
    q(sql,"INSERT INTO iam.identities(id,issuer,subject,status) VALUES($1::uuid,$2,$3,'active')",[ID.identity,ID.issuer,subject]),
    q(sql,"INSERT INTO iam.memberships(id,tenant_id,identity_id,status,joined_at) VALUES($1::uuid,$2::uuid,$3::uuid,'active',clock_timestamp())",[ID.membership,ID.tenant,ID.identity]),
    q(sql,"INSERT INTO iam.roles(id,tenant_id,role_key,display_name) VALUES($1::uuid,$2::uuid,'peos_auth0_41','PEOS temporary RBAC reader')",[ID.role,ID.tenant]),
    q(sql,"INSERT INTO iam.role_permissions(tenant_id,role_id,permission_key) VALUES($1::uuid,$2::uuid,'iam.tenant.read')",[ID.tenant,ID.role]),
    q(sql,"INSERT INTO iam.membership_roles(tenant_id,membership_id,role_id) VALUES($1::uuid,$2::uuid,$3::uuid)",[ID.tenant,ID.membership,ID.role]),
  ]);
  const created=await counts(sql);
  check(countKeys.every((key)=>created[key]===1), "Fixture insert integrity failure");
}
async function revoke(sql) {
  await owner(sql,[q(sql,"DELETE FROM iam.membership_roles WHERE tenant_id=$1::uuid AND membership_id=$2::uuid AND role_id=$3::uuid",[ID.tenant,ID.membership,ID.role])]);
  const result=await counts(sql);
  check(result.membership_roles === 0 && result.role_permissions === 1,"Revoke integrity failure");
}
async function cleanup(sql) {
  await owner(sql,[
    q(sql,"DELETE FROM iam.membership_roles WHERE tenant_id=$1::uuid AND membership_id=$2::uuid AND role_id=$3::uuid",[ID.tenant,ID.membership,ID.role]),
    q(sql,"DELETE FROM iam.role_permissions WHERE tenant_id=$1::uuid AND role_id=$2::uuid AND permission_key='iam.tenant.read'",[ID.tenant,ID.role]),
    q(sql,"DELETE FROM iam.roles WHERE id=$1::uuid AND tenant_id=$2::uuid",[ID.role,ID.tenant]),
    q(sql,"DELETE FROM iam.memberships WHERE id=$1::uuid AND tenant_id=$2::uuid AND identity_id=$3::uuid",[ID.membership,ID.tenant,ID.identity]),
    q(sql,"DELETE FROM iam.identities WHERE id=$1::uuid AND issuer=$2",[ID.identity,ID.issuer]),
    q(sql,"DELETE FROM iam.tenants WHERE id=$1::uuid",[ID.tenant]),
  ]);
  const result=await counts(sql);
  check(zero(result) && result.active_keys===1 && result.ledger_rows===0,
    "FAIL cleanup: fixture residue or protected key/ledger baseline changed");
  console.log("PASS cleanup: tenants=0, identities=0, memberships=0, roles=0, grants=0, role_permissions=0; key=1; ledger=0");
}
async function checkHttp(page) {
  return page.evaluate(async ({ tenantId,identityId })=>{
    const response=await fetch("/api/authorization/check",{
      method:"POST",headers:{"Content-Type":"application/json"},
      credentials:"same-origin",cache:"no-store",
      body:JSON.stringify({tenantId,identityId,permission:"iam.tenant.read"}),
    });
    return {status:response.status,body:await response.json(),cache:response.headers.get("cache-control")};
  },{tenantId:ID.tenant,identityId:ID.identity});
}

test("RBAC HTTP 200 grant -> 403 revoke, real Auth0, disposable Neon, zero residue",async({page})=>{
  const sql=await connect(); // preflight before the 45-second application session begins
  const host=process.env.E2E_CALLBACK_HOST;
  const token=process.env.VERCEL_TRUSTED_OIDC_TOKEN;
  const cdp=await page.context().newCDPSession(page);
  let callback=false, fixtureStarted=false, failure, cleanFailure;
  await cdp.send("Fetch.enable",{patterns:[{urlPattern:"*",requestStage:"Request"}]});
  cdp.on("Fetch.requestPaused",async({requestId,request})=>{
    try {
      const url=new URL(request.url);
      const headers=Object.entries(request.headers)
        .filter(([name])=>name.toLowerCase()!=="x-vercel-trusted-oidc-idp-token")
        .map(([name,value])=>({name,value:String(value)}));
      if(url.hostname===host){
        headers.push({name:"x-vercel-trusted-oidc-idp-token",value:token});
        if(url.pathname==="/auth/callback") callback=true;
      }
      await cdp.send("Fetch.continueRequest",{requestId,headers});
    } catch {
      await cdp.send("Fetch.failRequest",{requestId,errorReason:"Aborted"}).catch(()=>{});
    }
  });
  try{
    await page.goto("/protected");
    await expect(page).toHaveURL(/iam-control-center\.us\.auth0\.com/);
    const login=page.locator('input[name="username"],input[name="email"]').first();
    await expect(login).toBeVisible();
    await login.fill(process.env.AUTH0_E2E_USERNAME);
    const pass=page.locator('input[name="password"]');
    if(!(await pass.isVisible().catch(()=>false)))
      await page.getByRole("button",{name:/continue/i}).first().click();
    await expect(pass).toBeVisible();
    await pass.fill(process.env.AUTH0_E2E_PASSWORD);
    await page.getByRole("button",{name:/continue|log in|sign in/i}).last().click();
    await expect(page).toHaveURL((url)=>url.pathname==="/protected",{timeout:60000});
    await expect(page.getByRole("status")).toHaveText("Acesso autenticado confirmado.");
    expect(callback).toBe(true);
    const profile=await page.evaluate(async()=>{
      const response=await fetch("/auth/profile",{credentials:"same-origin",cache:"no-store"});
      return {status:response.status,data:response.ok?await response.json():null};
    });
    expect(profile.status).toBe(200);
    const subject=profile.data?.sub;
    check(typeof subject==="string" &&
      createHash("sha256").update(subject,"utf8").digest("hex")===ID.hash,
      "OIDC subject is not the approved test identity");
    fixtureStarted=true; // cleanup even if the transaction errors partway
    await create(sql,subject);
    const yes=await checkHttp(page);
    expect(yes).toEqual({status:200,body:{allowed:true},cache:"no-store"});
    console.log("PASS: POST /api/authorization/check HTTP 200 with real Auth0 grant");
    await revoke(sql);
    const no=await checkHttp(page);
    expect(no).toEqual({status:403,body:{allowed:false},cache:"no-store"});
    console.log("PASS: POST /api/authorization/check HTTP 403 after revoke in SAME session");
  }catch(e){failure=e;}
  finally{
    if(fixtureStarted){
      try{await cleanup(sql);}catch(e){cleanFailure=e;}
    }
    await cdp.send("Fetch.disable").catch(()=>{});
    await cdp.detach().catch(()=>{});
  }
  if(cleanFailure)throw new Error("RBAC HTTP gate FAILED: zero-residue cleanup not proven",{cause:cleanFailure});
  if(failure)throw failure;
  console.log("PEOS RBAC HTTP GATE PASS: same Auth0 session; grant 200; revoke 403; cleanup 0; Neon "+ID.branch);
});
