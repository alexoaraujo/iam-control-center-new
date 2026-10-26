#!/usr/bin/env node
import { setTimeout as sleep } from "node:timers/promises";

const API_BASE = "https://console.neon.tech/api/v2";
const MAX_ATTEMPTS = 3;
const MAX_PAGES = 100;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function previewBranchName(prNumber) {
  const value = String(prNumber ?? "");
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new Error("A valid positive pull request number is required.");
  }
  return `preview/pr-${value}`;
}

async function fetchPage({
  projectId, apiKey, cursor, fetchImpl, timeoutMs, maxAttempts, sleepImpl,
}) {
  const params = new URLSearchParams({ limit: "100" });
  if (cursor) params.set("cursor", cursor);
  const url = `${API_BASE}/projects/${encodeURIComponent(projectId)}/branches?${params}`;
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
      if (!RETRYABLE_STATUS.has(response.status) || attempt === maxAttempts) throw error;
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
    if (payload.pagination != null && typeof payload.pagination !== "object") {
      throw new Error("Neon API returned invalid pagination metadata.");
    }
    return payload;
  }
  throw new Error(`Neon API request failed after bounded retries: ${lastError?.name ?? "unknown error"}.`);
}

export async function listBranches({
  projectId,
  apiKey,
  fetchImpl = fetch,
  timeoutMs = 5000,
  maxAttempts = MAX_ATTEMPTS,
  maxPages = MAX_PAGES,
  sleepImpl = sleep,
}) {
  if (!projectId?.trim() || !apiKey?.trim()) {
    throw new Error("Neon project configuration is missing.");
  }
  const branches = [];
  const seenCursors = new Set();
  let cursor;

  for (let page = 0; page < maxPages; page += 1) {
    const payload = await fetchPage({
      projectId, apiKey, cursor, fetchImpl, timeoutMs, maxAttempts, sleepImpl,
    });
    branches.push(...payload.branches);
    const next = payload.pagination?.next;
    if (next == null || next === "") return branches;
    if (typeof next !== "string" || seenCursors.has(next)) {
      throw new Error("Neon API returned an invalid or repeated pagination cursor.");
    }
    seenCursors.add(next);
    cursor = next;
  }
  throw new Error("Neon branch listing exceeded the pagination safety limit.");
}

export function planCreate(branches, targetName, maxTotalBranches = 10) {
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
  if (branches.length >= maxTotalBranches) {
    throw new Error("Configured total-branch safety limit reached; refusing to create another preview.");
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
