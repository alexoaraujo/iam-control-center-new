#!/usr/bin/env node
import { setTimeout as sleep } from "node:timers/promises";

const API_BASE = "https://console.neon.tech/api/v2";
const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function previewBranchName(prNumber) {
  const value = String(prNumber ?? "");
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new Error("A valid positive pull request number is required.");
  }
  return `preview/pr-${value}`;
}

export async function listBranches({
  projectId,
  apiKey,
  fetchImpl = fetch,
  timeoutMs = 5000,
  maxAttempts = MAX_ATTEMPTS,
  sleepImpl = sleep,
}) {
  if (!projectId?.trim() || !apiKey?.trim()) {
    throw new Error("Neon project configuration is missing.");
  }
  const url = `${API_BASE}/projects/${encodeURIComponent(projectId)}/branches?limit=100`;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      await sleepImpl(100 * 2 ** (attempt - 1));
      continue;
    }

    if (!response.ok) {
      const error = new Error(`Neon API returned HTTP ${response.status}.`);
      if (!RETRYABLE_STATUS.has(response.status) || attempt === maxAttempts) {
        throw error;
      }
      lastError = error;
      await sleepImpl(100 * 2 ** (attempt - 1));
      continue;
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Neon API returned invalid JSON.");
    }
    if (!payload || !Array.isArray(payload.branches)) {
      throw new Error("Neon API response does not contain a branches array.");
    }
    return payload.branches;
  }
  throw new Error(`Neon API request failed after bounded retries: ${lastError?.name ?? "unknown error"}.`);
}

export function planCreate(branches, targetName, maxRootBranches = 3) {
  if (!/^preview\/pr-\d+$/.test(targetName)) {
    throw new Error("Refusing create preflight for a non-preview target.");
  }
  const matches = branches.filter((branch) => branch?.name === targetName);
  if (matches.length > 1) throw new Error("Duplicate preview branch names detected; refusing automatic action.");
  if (matches.length === 1) {
    if (matches[0].current_state !== "ready") {
      throw new Error("Existing preview branch is not ready; refusing automatic replacement.");
    }
    return { shouldCreate: false, reason: "already-ready" };
  }
  const roots = branches.filter((branch) => branch?.parent_id == null).length;
  if (roots >= maxRootBranches) {
    throw new Error("Neon root-branch allowance reached; refusing to create another preview.");
  }
  return { shouldCreate: true, reason: "missing" };
}

export function planDelete(branches, targetName) {
  if (!/^preview\/pr-\d+$/.test(targetName)) {
    throw new Error("Refusing cleanup for a non-preview target.");
  }
  const matches = branches.filter((branch) => branch?.name === targetName);
  if (matches.length > 1) throw new Error("Duplicate preview branch names detected; refusing automatic cleanup.");
  return { exists: matches.length === 1, reason: matches.length === 1 ? "present" : "already-absent" };
}

async function main() {
  const mode = process.argv[2];
  if (mode !== "create" && mode !== "delete") throw new Error("Usage: neon-branch-lifecycle.mjs <create|delete>");
  const target = previewBranchName(process.env.PR_NUMBER);
  const branches = await listBranches({
    projectId: process.env.NEON_PROJECT_ID,
    apiKey: process.env.NEON_API_KEY,
  });
  const plan = mode === "create" ? planCreate(branches, target) : planDelete(branches, target);
  const outputKey = mode === "create" ? "should_create" : "exists";
  const outputValue = mode === "create" ? plan.shouldCreate : plan.exists;
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error("GITHUB_OUTPUT is required in workflow mode.");
  const { appendFile } = await import("node:fs/promises");
  await appendFile(output, `${outputKey}=${outputValue}\n`, "utf8");
  console.log(`Neon preflight completed: ${plan.reason}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
