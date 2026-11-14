import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const repo = "alexoaraujo/iam-control-center-new";
const project = "prj_OnuwD1iarOsXh6FFGkSpK4A5mj80";
const team = "aoa4";
const callback = "iam-control-center-new-ci-preview.vercel.app";
const auth0Domain = "iam-control-center.us.auth0.com";
const shaPattern = /^[a-f0-9]{40}$/;
const branchPattern = /^[A-Za-z0-9][A-Za-z0-9/._-]*$/;
const hostPattern = /^[A-Za-z0-9-]+\.vercel\.app$/;

export function isAuth0CriticalFile(file) {
  return /^(apps\/web\/|packages\/|\.github\/e2e\/|database\/migrations\/|database\/tests\/api-authorization)/.test(file) ||
    /^scripts\/(bind-e2e-preview|verify-preview-alias|neon-rbac-fixture-binding|auth0-preview-contract)/.test(file);
}
export function decideScope(env, domain, paths) {
  if (env.PR_HEAD_REPOSITORY !== repo ||
      !shaPattern.test(env.PR_HEAD_SHA ?? "") ||
      !branchPattern.test(env.PR_HEAD_BRANCH ?? "")) throw Error("Untrusted repository, branch or exact SHA");
  if (env.VERCEL_PROJECT_ID !== project || env.VERCEL_TEAM_SLUG !== team ||
      env.E2E_CALLBACK_HOST !== callback ||
      !hostPattern.test(env.E2E_DEPLOYMENT_HOST ?? "")) throw Error("Unexpected project or callback host");
  if (domain?.name !== callback || domain.projectId !== project ||
      domain.verified !== true || !branchPattern.test(domain.gitBranch ?? "")) {
    throw Error("Unverified or mismatched Vercel callback domain");
  }
  if (!Array.isArray(paths) || paths.some(x => typeof x !== "string")) throw Error("Unknown PR change scope");
  if (domain.gitBranch !== env.PR_HEAD_BRANCH) {
    if (paths.some(isAuth0CriticalFile)) {
      throw Error("Auth0-sensitive changes require a separately authorized callback branch; refusing to skip E2E");
    }
    return { ready: false, reason: "BRANCH_NOT_BOUND_TO_CALLBACK" };
  }
  return { ready: true, callbackHost: callback, callbackBranch: env.PR_HEAD_BRANCH };
}

export function checkAppVariables(envs, branch) {
  if (!Array.isArray(envs)) throw Error("Vercel environment inventory unavailable");
  const effective = name => {
    const a = envs.filter(e => e.key === name && e.target?.includes("preview"));
    const branchItems = a.filter(e => e.gitBranch === branch);
    const defaultItems = a.filter(e => !e.gitBranch);
    if (branchItems.length > 1 || defaultItems.length > 1) throw Error("Ambiguous Preview setting: " + name);
    return branchItems[0] ?? defaultItems[0];
  };
  for (const [key,value] of [
    ["AUTH0_DOMAIN",auth0Domain],["APP_BASE_URL","https://" + callback],
    ["E2E_CALLBACK_HOST",callback],["E2E_CALLBACK_BRANCH",branch]
  ]) {
    const v = effective(key);
    if (!v || v.type !== "plain" || v.value !== value) throw Error("Preview variable mismatch: " + key);
  }
  for (const k of ["AUTH0_CLIENT_ID","AUTH0_CLIENT_SECRET","AUTH0_SECRET"]) {
    if (!effective(k)) throw Error("Missing required Auth0 Preview setting: " + k);
  }
  return { appBaseUrl: "https://" + callback, auth0Domain };
}

export function verifyDeployment(env, alias, deployment, previewAlias) {
  if (alias?.alias !== callback || alias.projectId !== project ||
      !alias.deploymentId || alias.deploymentId !== deployment?.id) {
    throw Error("Callback alias does not resolve to expected deployment");
  }
  const m = deployment.meta ?? {};
  if (deployment.readyState !== "READY" || deployment.project?.id !== project ||
      m.githubCommitSha !== env.PR_HEAD_SHA || m.githubCommitRef !== env.PR_HEAD_BRANCH ||
      m.githubOrg !== "alexoaraujo" || m.githubRepo !== "iam-control-center-new") {
    throw Error("Callback deployment does not match exact PR SHA and repository");
  }
  const preview = env.E2E_DEPLOYMENT_HOST;
  if (deployment.url !== preview &&
      (previewAlias?.alias !== preview || previewAlias.projectId !== project ||
       previewAlias.deploymentId !== deployment.id)) {
    throw Error("Live verified Preview host is not the callback deployment");
  }
}

export function prFiles(base, head) {
  if (!shaPattern.test(base ?? "") || !shaPattern.test(head ?? "")) throw Error("Cannot identify PR change scope");
  const out = execFileSync("git",["diff","--name-only",base+"..."+head],{
    encoding:"utf8",stdio:["ignore","pipe","pipe"]
  });
  return out.split("\n").map(x => x.trim()).filter(Boolean);
}

export async function syncPreview(env, fetcher = fetch, changedFiles = prFiles) {
  if (!env.VERCEL_API_TOKEN || !env.GITHUB_OUTPUT) throw Error("Protected Vercel token and GitHub output required");
  const get = async path => {
    const url = "https://api.vercel.com" + path + (path.includes("?") ? "&" : "?") + "slug=" + team;
    const res = await fetcher(url,{
      headers:{Authorization:"Bearer " + env.VERCEL_API_TOKEN,Accept:"application/json"},
      cache:"no-store"
    });
    if (!res.ok) throw Error("Vercel configuration lookup failed with HTTP " + res.status);
    return res.json();
  };
  const paths = changedFiles(env.PR_BASE_SHA,env.PR_HEAD_SHA);
  const domain = await get("/v9/projects/" + project + "/domains/" + callback);
  const decision = decideScope(env,domain,paths);
  if (!decision.ready) {
    appendFileSync(env.GITHUB_OUTPUT,"auth0_ready=false\nscope=not-authorized\n");
    console.log("::notice::Auth0 E2E NOT RUN: fixed callback is assigned to another PR branch. No credentials or alias modified.");
    return decision;
  }
  const {envs} = await get("/v10/projects/" + project + "/env?decrypt=false");
  const app = checkAppVariables(envs,env.PR_HEAD_BRANCH);
  const alias = await get("/v4/aliases/" + callback);
  if (!alias?.deploymentId) throw Error("Auth0 callback alias has no deployment");
  const deployment = await get("/v13/deployments/" + encodeURIComponent(alias.deploymentId));
  const previewAlias = deployment.url === env.E2E_DEPLOYMENT_HOST ? null :
    await get("/v4/aliases/" + encodeURIComponent(env.E2E_DEPLOYMENT_HOST));
  verifyDeployment(env,alias,deployment,previewAlias);
  appendFileSync(env.GITHUB_OUTPUT,[
    "auth0_ready=true","scope=authorized",
    "callback_host=" + decision.callbackHost,
    "callback_branch=" + decision.callbackBranch,
    "app_base_url=" + app.appBaseUrl,
    "auth0_domain=" + app.auth0Domain
  ].join("\n") + "\n");
  console.log("PASS: Vercel domain, GitHub PR SHA/branch, Auth0 non-secret settings and callback deployment aligned.");
  return decision;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncPreview(process.env).catch(e => {console.error("::error::" + e.message);process.exitCode=1;});
}
