import { pathToFileURL } from "node:url";

const hostname = /^[a-zA-Z0-9-]+\.vercel\.app$/;
const exactSha = /^[a-f0-9]{40}$/;

/**
 * Independent Vercel deployment identity evidence, served under OIDC on each
 * exact origin. The GitHub exact-SHA Vercel check must have passed already.
 * Matching branch, SHA and unique generated deployment hostname ties two
 * different aliases to the SAME immutable Vercel deployment.
 */
export function assertPreviewDeploymentPair(evidence, expected) {
  if (!Array.isArray(evidence) || evidence.length !== 2) {
    throw new Error("Exactly two Preview origin proofs are required");
  }
  if (!exactSha.test(expected.commitSha) || !/^[1-9][0-9]*$/.test(expected.pullRequestId) ||
      expected.repository !== "alexoaraujo/iam-control-center-new" ||
      expected.branch !== "feat/iam-api-rbac-lineage-20261110") {
    throw new Error("Expected PR identity or commit SHA is invalid");
  }

  for (const [index, item] of evidence.entries()) {
    if (item?.ok !== true || !hostname.test(item.deploymentHost || "")) {
      throw new Error(`Missing Vercel deployment identity on Preview origin ${index + 1}`);
    }
    if (item.commitSha !== expected.commitSha || item.branch !== expected.branch ||
        item.repository !== expected.repository || item.environment !== "preview") {
      throw new Error(`Wrong SHA, branch, repository or environment on Preview origin ${index + 1}`);
    }
    if (String(item.pullRequestId || "") !== expected.pullRequestId) {
      throw new Error(`Missing or wrong PR number on Preview origin ${index + 1}`);
    }
  }

  if (evidence[0].deploymentHost !== evidence[1].deploymentHost) {
    throw new Error("Callback alias and verified Preview resolve to different Vercel deployments");
  }
  return evidence[0].deploymentHost;
}

async function fetchOriginProof(host, token) {
  if (!hostname.test(host)) throw new Error("Unapproved Preview origin format");
  const url = `https://${host}/api/health/deployment`;
  // Never follow redirects or send short-lived GitHub OIDC to other origins.
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    cache: "no-store",
    headers: {
      "x-vercel-trusted-oidc-idp-token": token,
      "Accept": "application/json",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (response.status !== 200 || !(response.headers.get("content-type") || "").includes("application/json")) {
    throw new Error(`Origin ${host} did not return a verified deployment identity (HTTP ${response.status})`);
  }
  return response.json();
}

export async function verifyPreviewAliases(env) {
  const {
    E2E_DEPLOYMENT_HOST: previewHost,
    E2E_CALLBACK_HOST: callbackHost,
    VERCEL_TRUSTED_OIDC_TOKEN: token,
    PR_HEAD_BRANCH: branch,
    PR_HEAD_REPOSITORY: repository,
    PR_NUMBER: pullRequestId,
    PR_HEAD_SHA: commitSha,
  } = env;
  if (!token || !previewHost || !callbackHost) throw new Error("Missing trusted Preview binding inputs");
  if (!/^iam-control-center-new-[a-z0-9-]+\.vercel\.app$/.test(callbackHost)) {
    throw new Error("Callback is not a reviewed IAM Preview alias");
  }
  const expected = { branch, repository, pullRequestId, commitSha };
  // Validate the immutable PR identity BEFORE making any network request.
  assertPreviewDeploymentPair([
    { ok: true, deploymentHost: "identity-check.vercel.app", commitSha, branch, repository, environment: "preview", pullRequestId },
    { ok: true, deploymentHost: "identity-check.vercel.app", commitSha, branch, repository, environment: "preview", pullRequestId },
  ], expected);
  const evidence = await Promise.all([previewHost, callbackHost].map(host => fetchOriginProof(host, token)));
  const deploymentHost = assertPreviewDeploymentPair(evidence, expected);
  console.log(`PASS: GitHub SHA ${commitSha} / PR #${pullRequestId} Preview ${previewHost} and callback ${callbackHost} share Vercel deployment ${deploymentHost}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyPreviewAliases(process.env).catch(error => {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  });
}
