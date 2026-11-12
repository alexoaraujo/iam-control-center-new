import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const APPROVED_ALIAS = "iam-control-center-new-ci-preview.vercel.app";
const APPROVED_PROJECT = "prj_OnuwD1iarOsXh6FFGkSpK4A5mj80";
const APPROVED_REPO = "alexoaraujo/iam-control-center-new";
const hostname = /^[a-zA-Z0-9-]+\.vercel\.app$/;

export function verifyPreviewBinding(env, domain, alias, deployment) {
  const { PR_HEAD_BRANCH: branch, PR_HEAD_SHA: sha, PR_HEAD_REPOSITORY: repository,
    E2E_CALLBACK_HOST: callback, E2E_DEPLOYMENT_HOST: preview } = env;
  if (repository !== APPROVED_REPO) throw Error("Untrusted PR repository");
  if (!branch || !/^[a-zA-Z0-9][a-zA-Z0-9/._-]*$/.test(branch) || /[\r\n]/.test(branch)) {
    throw Error("Invalid PR branch");
  }
  if (!/^[a-f0-9]{40}$/.test(sha ?? "")) throw Error("Invalid PR SHA");
  if (callback !== APPROVED_ALIAS || !hostname.test(preview ?? "")) {
    throw Error("Callback or verified Preview hostname is invalid");
  }
  if (domain?.name !== callback || domain.projectId !== APPROVED_PROJECT ||
      domain.verified !== true || domain.gitBranch !== branch) {
    throw Error("Auth0 callback alias is not bound to this PR branch in Vercel");
  }
  if (alias?.alias !== callback || alias?.projectId !== APPROVED_PROJECT ||
      !alias.deploymentId || alias.deploymentId !== deployment?.id) {
    throw Error("Callback alias is not attached to a verified deployment");
  }
  const meta = deployment.meta ?? {};
  if (deployment.readyState !== "READY" || deployment.project?.id !== APPROVED_PROJECT ||
      meta.githubCommitRef !== branch || meta.githubCommitSha !== sha ||
      meta.githubOrg !== "alexoaraujo" || meta.githubRepo !== "iam-control-center-new") {
    throw Error("Callback alias deployment does not match the exact PR SHA");
  }
  if (deployment.url !== preview && !deployment.alias?.includes(preview)) {
    throw Error("Callback deployment is not the exact-SHA verified Preview");
  }
  return { callbackHost: callback, callbackBranch: branch, callbackUrl: `https://${callback}` };
}

export async function bindPreview(env, fetcher = fetch) {
  if (!env.VERCEL_API_TOKEN || !env.GITHUB_ENV) {
    throw Error("VERCEL_API_TOKEN (protected Preview secret) and GITHUB_ENV are required");
  }
  if (env.VERCEL_PROJECT_ID !== APPROVED_PROJECT || env.VERCEL_TEAM_SLUG !== "aoa4") {
    throw Error("Unexpected Vercel project or team");
  }
  const headers = { Authorization: `Bearer ${env.VERCEL_API_TOKEN}`, Accept: "application/json" };
  const query = "?slug=aoa4";
  const get = async (path) => {
    const response = await fetcher(`https://api.vercel.com${path}${query}`, { headers, cache: "no-store" });
    if (!response.ok) throw Error(`Vercel alias verification failed: HTTP ${response.status}`);
    return response.json();
  };
  const domain = await get(`/v9/projects/${APPROVED_PROJECT}/domains/${APPROVED_ALIAS}`);
  const alias = await get(`/v4/aliases/${APPROVED_ALIAS}`);
  if (!alias?.deploymentId) throw Error("Vercel callback alias has no deployment");
  const deployment = await get(`/v13/deployments/${encodeURIComponent(alias.deploymentId)}`);
  const result = verifyPreviewBinding(env, domain, alias, deployment);
  appendFileSync(env.GITHUB_ENV, [
    `E2E_CALLBACK_HOST=${result.callbackHost}`,
    `E2E_CALLBACK_BRANCH=${result.callbackBranch}`,
    `E2E_DEPLOYMENT_URL=${result.callbackUrl}`,
    `E2E_BASE_URL=${result.callbackUrl}`,
  ].join("\n") + "\n");
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  bindPreview(process.env).then(
    result => console.log(`Verified Auth0 callback ${result.callbackHost} for PR branch ${result.callbackBranch} and exact SHA`),
    error => { console.error(`::error::${error.message}`); process.exitCode = 1; },
  );
}
