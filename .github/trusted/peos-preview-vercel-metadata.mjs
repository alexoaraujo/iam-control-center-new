import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { approvedCallback, verifyPreviewBinding } from "../../scripts/bind-e2e-preview.mjs";
import { checkAppVariables } from "../../scripts/sync-auth0-e2e-preview.mjs";

export const REPO = "alexoaraujo/iam-control-center-new";
export const ENV = "Preview-Vercel-Metadata";
const PROJECT = "prj_OnuwD1iarOsXh6FFGkSpK4A5mj80";
const TEAM = "team_oZwyOnhX8Gfx4JNflFubUelo";
const WORKFLOW = REPO + "/.github/workflows/peos-preview-vercel-metadata.yml@refs/heads/main";
const SHA = /^[a-f0-9]{40}$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9/._-]{0,249}$/;
const HOST = /^iam-control-center-new-[a-z0-9-]+\.vercel\.app$/;
const reject = (condition, code) => { if (!condition) throw Error(code); };

export function validateContext(e) {
  reject(e.GITHUB_REPOSITORY === REPO && e.GITHUB_REPOSITORY_ID === "1451861889" &&
    e.GITHUB_REPOSITORY_OWNER_ID === "325264809" && e.GITHUB_EVENT_NAME === "workflow_dispatch" &&
    e.GITHUB_REF === "refs/heads/main" && e.GITHUB_WORKFLOW_REF === WORKFLOW &&
    e.GITHUB_ACTOR === "alexoaraujo" && e.GITHUB_ACTOR_ID === "325264809" &&
    e.GITHUB_TRIGGERING_ACTOR === "alexoaraujo", "UNTRUSTED_EXECUTION_CONTEXT");
  reject(SHA.test(e.EXPECTED_MAIN_SHA ?? "") && e.GITHUB_SHA === e.EXPECTED_MAIN_SHA &&
    e.GITHUB_WORKFLOW_SHA === e.GITHUB_SHA && e.CHECKOUT_SHA === e.GITHUB_SHA,
    "EXECUTOR_SHA_MISMATCH");
  reject(SHA.test(e.EXPECTED_PR_SHA ?? "") && /^[1-9][0-9]{0,8}$/.test(e.PR_NUMBER ?? ""),
    "PR_INPUT_INVALID");
  reject(/^[1-9][0-9]{0,19}$/.test(e.GITHUB_RUN_ID ?? "") && e.GITHUB_RUN_ATTEMPT === "1",
    "FRESH_DISPATCH_REQUIRED");
}

export function validatePR(e, main, pr) {
  reject(main?.commit?.sha === e.EXPECTED_MAIN_SHA, "MAIN_MOVED");
  reject(pr?.number === Number(e.PR_NUMBER) && pr.state === "open" &&
    pr.head?.repo?.id === 1451861889 && pr.head.repo.full_name === REPO &&
    pr.base?.repo?.id === 1451861889 && pr.base.repo.full_name === REPO &&
    pr.base.ref === "main" && pr.base.sha === e.EXPECTED_MAIN_SHA &&
    pr.head.sha === e.EXPECTED_PR_SHA && BRANCH.test(pr.head.ref ?? ""),
    "PR_IDENTITY_OR_BASELINE_MISMATCH");
  const host = approvedCallback(pr.head.ref);
  reject(HOST.test(host) && host !== "iam-control-center-new-ci-preview.vercel.app",
    "DEDICATED_CALLBACK_NOT_APPROVED_IN_MAIN");
  return {branch: pr.head.ref, host, sha: pr.head.sha};
}

export function validateProtection(meta, policies, custom) {
  reject(meta?.name === ENV && Number.isSafeInteger(meta.id) && meta.id > 0 &&
    meta.can_admins_bypass === false && meta.deployment_branch_policy?.protected_branches === false &&
    meta.deployment_branch_policy?.custom_branch_policies === true, "ENVIRONMENT_PROTECTION_UNATTESTED");
  const rules = meta.protection_rules;
  reject(Array.isArray(rules) && rules.every(r => r && ["branch_policy","required_reviewers","wait_timer"].includes(r.type)) &&
    new Set(rules.map(r=>r.type)).size === rules.length && rules.some(r=>r.type==="branch_policy"),
    "ENVIRONMENT_RULES_UNATTESTED");
  const reviewers = rules.find(r=>r.type==="required_reviewers");
  reject(reviewers?.prevent_self_review === true && Array.isArray(reviewers.reviewers) &&
    reviewers.reviewers.length > 0 && reviewers.reviewers.every(r =>
      ["User","Team"].includes(r.type) && Number.isSafeInteger(r.reviewer?.id) && r.reviewer.id > 0),
    "INDEPENDENT_REVIEW_REQUIRED");
  // Personal repository: accept explicit eligible users, not unverified team membership.
  const ids = reviewers.reviewers.map(r=>r.reviewer.id);
  reject(reviewers.reviewers.every(r=>r.type==="User") && new Set(ids).size===ids.length &&
    ids.some(id=>id!==325264809), "NO_DISTINCT_ELIGIBLE_REVIEWER");
  reject(rules.filter(r=>r.type==="wait_timer").every(r=>r.wait_timer===0), "WAIT_TIMER_REVIEW_REQUIRED");
  reject(policies?.total_count===1 && policies.branch_policies?.length===1 &&
    policies.branch_policies[0]?.type==="branch" && policies.branch_policies[0]?.name==="main",
    "ENVIRONMENT_MAIN_ONLY_NOT_ATTESTED");
  reject(custom?.total_count===0 && Array.isArray(custom.custom_deployment_protection_rules) &&
    custom.custom_deployment_protection_rules.length===0, "CUSTOM_RULES_UNREVIEWED");
  return {id:meta.id, reviewerIds:ids.filter(id=>id!==325264809).sort((a,b)=>a-b)};
}

export function validateReviewHistory(e, protection, history) {
  reject(Array.isArray(history) && history.length > 0 && history.length <= 100 &&
    history.every(r=>r && Array.isArray(r.environments) && r.environments.every(x=>x &&
      Number.isSafeInteger(x.id) && typeof x.name==="string")), "APPROVAL_HISTORY_UNATTESTED");
  const relevant=history.filter(r=>r.environments.some(x=>x.id===protection.id && x.name===ENV));
  // Fail closed on ambiguous/rejected history. No reuse of old attempts.
  reject(relevant.length===1 && relevant[0].state==="approved" &&
    protection.reviewerIds.includes(relevant[0].user?.id) &&
    String(relevant[0].user.id)!==e.GITHUB_ACTOR_ID, "DISTINCT_APPROVAL_NOT_ATTESTED");
}


export function validateApproval(e, identity) {
  reject(e.APPROVED_PR_SHA === identity.sha && e.APPROVED_MAIN_SHA === e.GITHUB_SHA &&
    e.APPROVED_PR_NUMBER === e.PR_NUMBER && e.APPROVED_CALLBACK_HOST === identity.host &&
    e.OPERATOR_APPROVAL === "APPROVED_PREVIEW_METADATA_ONLY" &&
    e.TOKEN_SCOPE_ATTESTATION === "READ_ONLY_PREVIEW_TOKEN_SCOPE_VERIFIED",
    "EXACT_APPROVAL_OR_TOKEN_SCOPE_ATTESTATION_MISSING");
}

function getter(origin, token, fetcher) {
  reject(typeof token === "string" && token.length > 0, "READ_TOKEN_MISSING");
  return async path => {
    reject(path.startsWith("/") && !path.startsWith("//"), "INVALID_API_PATH");
    const url = new URL(path, origin);
    reject(url.origin === origin, "API_ORIGIN_MISMATCH");
    const headers = {Authorization:"Bearer "+token, Accept:"application/json"};
    if (origin === "https://api.github.com") headers["X-GitHub-Api-Version"]="2022-11-28";
    const res = await fetcher(url, {method:"GET", headers, redirect:"error", cache:"no-store", signal:AbortSignal.timeout(15000)});
    reject(res.ok, "PROVIDER_READ_FAILED");
    return res.json();
  };
}

export async function inspectGitHub(e, fetcher=fetch, requireReview=false) {
  validateContext(e);
  const get = getter("https://api.github.com", e.GH_TOKEN, fetcher);
  const root = "/repos/"+REPO;
  const identity = validatePR(e, await get(root+"/branches/main"), await get(root+"/pulls/"+e.PR_NUMBER));
  const path = root+"/environments/"+ENV;
  const protection = validateProtection(await get(path), await get(path+"/deployment-branch-policies?per_page=100"),
    await get(path+"/deployment_protection_rules?per_page=100"));
  if (requireReview) {
    reject(String(protection.id) === e.PREFLIGHT_ENVIRONMENT_ID, "ENVIRONMENT_ID_CHANGED");
    validateReviewHistory(e, protection, await get(root+"/actions/runs/"+e.GITHUB_RUN_ID+"/approvals"));
  }
  return {...identity, environmentId:protection.id};
}

export async function inspectVercel(e, identity, fetcher=fetch) {
  validateApproval(e, identity);
  const read = getter("https://api.vercel.com", e.PREVIEW_VERCEL_READ_TOKEN, fetcher);
  const get = path => read(path+(path.includes("?")?"&":"?")+"teamId="+TEAM);
  const host = identity.host;
  const domain = await get("/v9/projects/"+PROJECT+"/domains/"+host);
  const alias = await get("/v4/aliases/"+host);
  reject(/^dpl_[A-Za-z0-9]+$/.test(alias?.deploymentId ?? ""), "DEPLOYMENT_ID_INVALID");
  const deployment = await get("/v13/deployments/"+alias.deploymentId);
  reject(deployment.target == null || deployment.target === "preview", "NON_PREVIEW_DEPLOYMENT");
  verifyPreviewBinding({PR_HEAD_REPOSITORY:REPO, PR_HEAD_BRANCH:identity.branch,
    PR_HEAD_SHA:identity.sha, E2E_CALLBACK_HOST:host, E2E_DEPLOYMENT_HOST:deployment.url},
    domain, alias, deployment);
  // Match the legacy preflight's configuration checks, without decrypting or
  // serializing any environment secret. Only the effective Preview is evaluated.
  const inventory = await get("/v10/projects/"+PROJECT+"/env?decrypt=false");
  reject(Array.isArray(inventory?.envs), "PREVIEW_ENV_METADATA_UNAVAILABLE");
  checkAppVariables(inventory.envs, identity.branch);
  // Ensure credential-bearing follow-up work cannot use a stale callback binding.
  const latestDomain = await get("/v9/projects/"+PROJECT+"/domains/"+host);
  const latestAlias = await get("/v4/aliases/"+host);
  verifyPreviewBinding({PR_HEAD_REPOSITORY:REPO, PR_HEAD_BRANCH:identity.branch,
    PR_HEAD_SHA:identity.sha, E2E_CALLBACK_HOST:host, E2E_DEPLOYMENT_HOST:deployment.url},
    latestDomain, latestAlias, deployment);
  return {sha:identity.sha, host, deployment_id:deployment.id};
}

async function main(e) {
  reject(["preflight","approval","metadata"].includes(process.argv[2]), "MODE_INVALID");
  const identity = await inspectGitHub(e, fetch, process.argv[2]!=="preflight");
  if (process.argv[2] === "preflight") {
    appendFileSync(e.GITHUB_OUTPUT, "eligible=true\nenvironment_id="+identity.environmentId+"\n");
    console.log("PASS_PREVIEW_METADATA_PREFLIGHT_ONLY");
    return;
  }
  if (process.argv[2] === "approval") {
    console.log("PASS_DISTINCT_ENVIRONMENT_APPROVAL_HISTORY");
    return;
  }
  const result = await inspectVercel(e, identity);
  const again = await inspectGitHub(e, fetch, true);
  reject(JSON.stringify(again)===JSON.stringify(identity), "PR_IDENTITY_CHANGED");
  console.log("PASS_PREVIEW_PROVIDER_METADATA_ONLY", JSON.stringify(result));
  console.log("E2E_AND_WILDCARD_AUTHORIZATION=HOLD");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.env).catch(() => { console.error("BLOCKED_PREVIEW_METADATA_EXECUTOR"); process.exitCode=2; });
}
