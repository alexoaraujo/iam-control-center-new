import { pathToFileURL } from "node:url";

export const TARGET = Object.freeze({
  repository: "alexoaraujo/iam-control-center-new",
  pr: 197,
  gitBranch: "feat/peos-p2-tenant-directory-20261125",
  preview: "iam-control-center-new-p2-directory-ci.vercel.app",
  project: "tiny-rice-70320263",
  parent: "br-muddy-bar-b63ksdy7",
  branch: "br-lively-rain-b6dc51f7",
  branchName: "validation/peos-p2-pr197-directory",
  endpoint: "ep-lively-scene-b6608p61",
  host: "ep-lively-scene-b6608p61.c-2.sa-east-1.aws.neon.tech",
  database: "iam_database",
  providerExpiry: "2026-11-26T14:30:00Z",
  environment: "IAM-P2-PR197-Disposable-Directory",
});
const exactSha = /^[a-f0-9]{40}$/;
export function requireP2(condition, code) {
  if (!condition) throw new Error("BLOCKED_P2_" + code);
}
export function validateExecution(env, now = Date.now(), cleanup = false) {
  requireP2(env.GITHUB_REPOSITORY === TARGET.repository && env.GITHUB_REF === "refs/heads/main" &&
    env.GITHUB_EVENT_NAME === "workflow_dispatch" && env.GITHUB_ACTOR === "alexoaraujo" &&
    exactSha.test(env.GITHUB_SHA || "") && env.P2_TRUSTED_MAIN_SHA === env.GITHUB_SHA &&
    exactSha.test(env.P2_HEAD_SHA || ""), "TRUSTED_MAIN");
  requireP2(env.P2_APPROVED_SHA === env.P2_HEAD_SHA && env.P2_APPROVED_MAIN_SHA === env.GITHUB_SHA &&
    env.P2_BRANCH_ID === TARGET.branch && env.P2_ENDPOINT_ID === TARGET.endpoint &&
    env.P2_OPERATOR_APPROVAL === "APPROVED_DISPOSABLE_P2_ONLY" &&
    env.P2_ENVIRONMENT_READBACK === "MAIN_ONLY_REVIEWER_NO_BYPASS_VERIFIED", "APPROVAL");
  const start = Date.parse(env.P2_LEASE_START_AT || ""), end = Date.parse(env.P2_LEASE_EXPIRES_AT || "");
  const providerEnd = Date.parse(TARGET.providerExpiry);
  requireP2([now,start,end,providerEnd].every(Number.isFinite) && start <= now &&
    end > start && end-start <= 7200000 && end <= providerEnd-900000 &&
    providerEnd-now > 60000 && (cleanup || end-now >= 120000), "LEASE");
  const uri = new URL(env.P2_OWNER_DATABASE_URL || "https://invalid.example");
  requireP2(uri.protocol === "postgresql:" && uri.hostname === TARGET.host && !uri.port &&
    uri.pathname === "/" + TARGET.database && decodeURIComponent(uri.username) === "neondb_owner" &&
    Boolean(uri.password) && uri.searchParams.get("sslmode") === "verify-full" &&
    uri.searchParams.get("sslrootcert") === "system" && [...uri.searchParams.keys()].every(k=>["sslmode","sslrootcert","channel_binding"].includes(k)), "OWNER_TLS");
  requireP2(/^[a-f0-9]{64}$/i.test(env.P2_CONTEXT_KEY_HEX || ""), "CONTEXT_KEY");
  return { start, end, providerEnd };
}
async function api(path, token, origin) {
  requireP2(Boolean(token), "READ_TOKEN");
  const response = await fetch(origin+path, {headers:{Authorization:"Bearer "+token,Accept:"application/json"},redirect:"error",signal:AbortSignal.timeout(15000)});
  requireP2(response.ok,"PROVIDER_HTTP_"+response.status);
  return response.json();
}
export async function verifyGitHub(env) {
  requireP2(env.GITHUB_REPOSITORY===TARGET.repository && env.GITHUB_REF==="refs/heads/main" &&
    env.GITHUB_EVENT_NAME==="workflow_dispatch" && env.GITHUB_ACTOR==="alexoaraujo" &&
    exactSha.test(env.P2_HEAD_SHA||"") && env.GITHUB_SHA===env.P2_TRUSTED_MAIN_SHA,"TRUSTED_MAIN");
  const root="/repos/"+TARGET.repository;
  const get=p=>api(root+p,env.GH_TOKEN,"https://api.github.com");
  const [main,pr,checks]=await Promise.all([get("/branches/main"),get("/pulls/197"),get("/commits/"+env.P2_HEAD_SHA+"/check-runs?per_page=100")]);
  requireP2(main.commit.sha===env.GITHUB_SHA && pr.state==="open" && pr.head.sha===env.P2_HEAD_SHA &&
    pr.head.ref===TARGET.gitBranch && pr.head.repo.full_name===TARGET.repository && pr.base.ref==="main" &&
    pr.base.sha===main.commit.sha && pr.mergeable===true,"PR_BASELINE");
  for (const name of ["quality","pg18-security-contracts","deployment-config","preview-deployment","sync-auth0-preview","auth0-e2e","security-gate"]) {
    const selected=checks.check_runs.filter(x=>x.name===name);
    requireP2(selected.length===1 && selected[0].head_sha===env.P2_HEAD_SHA && selected[0].app?.id===15368 &&
      selected[0].status==="completed" && selected[0].conclusion==="success","CHECK_"+name);
    const url=selected[0].details_url||selected[0].html_url||"";
    const match=url.match(/\/actions\/runs\/(\d+)\/job\/(\d+)/);
    requireP2(Boolean(match),"RUN_IDENTITY");
    const run=await get("/actions/runs/"+match[1]);
    const expected=name==="pg18-security-contracts"?"iam-required-security-gate.yml":name==="deployment-config"?"vercel-deployment-guard.yml":"quality.yml";
    requireP2(run.head_sha===env.P2_HEAD_SHA && run.event==="pull_request" && run.path?.split("@")[0]===".github/workflows/"+expected &&
      run.head_repository?.full_name===TARGET.repository && run.conclusion==="success","WORKFLOW_IDENTITY_"+name);
  }
  console.log("PASS_P2_TRUSTED_MAIN_EXACT_PR_AND_CHECKS");
}
export function validateEnvironmentPolicy(environment, policies) {
  requireP2(environment?.name===TARGET.environment && environment.can_admins_bypass===false &&
    environment.deployment_branch_policy?.custom_branch_policies===true &&
    environment.deployment_branch_policy?.protected_branches===false &&
    Array.isArray(environment.protection_rules) &&
    environment.protection_rules.some(x=>x.type==="required_reviewers" && Array.isArray(x.reviewers) && x.reviewers.length>0),
    "ENVIRONMENT_PROTECTION");
  requireP2(policies?.total_count===1 && policies.branch_policies?.length===1 &&
    policies.branch_policies[0].name==="main" && policies.branch_policies[0].type==="branch", "ENVIRONMENT_BRANCH_POLICY");
}
export async function verifyEnvironment(env) {
  const root="/repos/"+TARGET.repository+"/environments/"+TARGET.environment;
  const get=p=>api(root+p,env.P2_GITHUB_ENVIRONMENT_READ_TOKEN,"https://api.github.com");
  const [environment,policies]=await Promise.all([get(""),get("/deployment-branch-policies?per_page=100")]);
  validateEnvironmentPolicy(environment,policies);
  console.log("PASS_P2_AUTHENTICATED_ENVIRONMENT_MAIN_REVIEWER_NO_ADMIN_BYPASS");
}
export async function verifyProvider(env) {
  validateExecution(env);
  const root="/projects/"+TARGET.project;
  const get=p=>api(root+p,env.P2_NEON_READ_TOKEN,"https://console.neon.tech/api/v2");
  const [p,b,e]=await Promise.all([get(""),get("/branches/"+TARGET.branch),get("/endpoints/"+TARGET.endpoint)]);
  requireP2(p.project?.id===TARGET.project && p.project.pg_version===18,"PROJECT");
  const branch=b.branch, endpoint=e.endpoint;
  requireP2(branch?.id===TARGET.branch && branch.parent_id===TARGET.parent && branch.name===TARGET.branchName &&
    branch.default===false && branch.protected===false && branch.current_state==="ready" &&
    Date.parse(branch.expires_at)===Date.parse(TARGET.providerExpiry),"PROVIDER_BRANCH");
  requireP2(endpoint?.id===TARGET.endpoint && endpoint.branch_id===TARGET.branch && endpoint.host===TARGET.host &&
    endpoint.type==="read_write" && endpoint.disabled===false && endpoint.autoscaling_limit_max_cu===0.25,"PROVIDER_ENDPOINT");
  console.log("PASS_P2_AUTHENTICATED_PROVIDER_BRANCH_ENDPOINT_TTL");
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    await verifyGitHub(process.env);
    if(process.argv[2]==="protected") { await verifyEnvironment(process.env); await verifyProvider(process.env); }
  } catch(e) { console.error(/^BLOCKED_P2_[A-Za-z0-9_-]+$/.test(e.message)?e.message:"BLOCKED_P2_PREFLIGHT"); process.exitCode=1; }
}
