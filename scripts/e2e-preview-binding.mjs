import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Derive callback from the Preview hostname already verified against the PR HEAD SHA.
 * No mutable repo-wide callback branch/host variables are trusted or overwritten.
 * The Auth0 allowlist and APP_BASE_URL must still be validated by the E2E preflight.
 */
export function derivePreviewBinding(env) {
  const repo = env.GITHUB_REPOSITORY?.trim();
  const headRepo = env.PR_HEAD_REPOSITORY?.trim();
  const branch = env.PR_HEAD_BRANCH?.trim();
  const host = env.E2E_DEPLOYMENT_HOST?.trim()?.toLowerCase();
  if (!repo || !headRepo || repo !== headRepo) throw new Error("Fork or unknown PR repository is not authorized");
  if (!branch || branch.length > 250 || /[\r\n]/.test(branch) || branch.startsWith("-")) {
    throw new Error("Invalid PR branch");
  }
  if (!host || !/^iam-control-center-new-[a-z0-9-]+\.vercel\.app$/.test(host)) {
    throw new Error("Missing or invalid verified IAM Preview hostname");
  }
  if (Object.values({ repo, headRepo, branch, host }).some(v => /[\r\n]/.test(v))) {
    throw new Error("Multiline environment values are forbidden");
  }
  const baseUrl = `https://${host}`;
  return {
    E2E_CALLBACK_BRANCH: branch,
    E2E_CALLBACK_HOST: host,
    E2E_DEPLOYMENT_URL: baseUrl,
    E2E_BASE_URL: baseUrl,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const binding = derivePreviewBinding(process.env);
  if (!process.env.GITHUB_ENV || !process.env.GITHUB_OUTPUT) {
    throw new Error("GITHUB_ENV and GITHUB_OUTPUT are required");
  }
  const content = Object.entries(binding).map(([key, value]) => `${key}=${value}\n`).join("");
  appendFileSync(process.env.GITHUB_ENV, content);
  appendFileSync(process.env.GITHUB_OUTPUT, content);
  console.log(`Bound Auth0 E2E callback to verified Preview ${binding.E2E_CALLBACK_HOST} for PR branch ${binding.E2E_CALLBACK_BRANCH}.`);
}
