import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function validateE2EConfig(env) {
  const required = ["GITHUB_REPOSITORY", "PR_HEAD_REPOSITORY", "PR_HEAD_BRANCH", "E2E_CALLBACK_BRANCH", "E2E_CALLBACK_HOST", "E2E_DEPLOYMENT_HOST", "E2E_AUTH0_DOMAIN", "E2E_OIDC_AUDIENCE", "E2E_OIDC_SUBJECT"];
  for (const key of required) {
    if (!env[key]?.trim() || /[\r\n]/.test(env[key])) throw new Error(`Missing or invalid ${key}`);
  }
  if (env.PR_HEAD_REPOSITORY !== env.GITHUB_REPOSITORY) throw new Error("Fork E2E is not authorized");
  if (env.PR_HEAD_BRANCH !== env.E2E_CALLBACK_BRANCH) throw new Error("Callback alias is not bound to this branch");
  const preview = /^[a-zA-Z0-9-]+\.vercel\.app$/;
  if (!preview.test(env.E2E_CALLBACK_HOST) || !preview.test(env.E2E_DEPLOYMENT_HOST)) throw new Error("Invalid Preview host");
  // Same origin proves the URL exercised by the browser is the URL validated for this SHA.
  if (env.E2E_CALLBACK_HOST !== env.E2E_DEPLOYMENT_HOST) throw new Error("Callback must match the verified exact-SHA Preview host");
  if (!/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(env.E2E_AUTH0_DOMAIN)) throw new Error("Invalid Auth0 domain");
  const audience = new URL(env.E2E_OIDC_AUDIENCE);
  if (audience.protocol !== "https:" || audience.username || audience.password) throw new Error("Invalid OIDC audience");
  if (!env.E2E_OIDC_SUBJECT.endsWith(":environment:Preview")) throw new Error("OIDC subject must identify Preview");
  return `https://${env.E2E_CALLBACK_HOST}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = validateE2EConfig(process.env);
  if (!process.env.GITHUB_ENV) throw new Error("GITHUB_ENV is required");
  appendFileSync(process.env.GITHUB_ENV, `E2E_DEPLOYMENT_URL=${url}\nE2E_BASE_URL=${url}\n`);
}
