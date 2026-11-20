import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const sha = /^[a-f0-9]{40}$/;
const docOnly = (file) => /^(docs\/|README\.md$|SECURITY\.md$)/.test(file);

export function decideSecurityGate({
  quality, previewRequired, preview, syncAuth0, auth0E2E, auth0Enabled, docsPreview, changedFiles,
}) {
  if (quality !== "success") return { pass: false, reason: "QUALITY_NOT_SUCCESS" };
  if (!Array.isArray(changedFiles) || changedFiles.length === 0 ||
      changedFiles.some(f => typeof f !== "string" || !f.trim())) {
    return { pass: false, reason: "UNVERIFIED_CHANGE_SCOPE" };
  }
  // Documentation-only changes have no runtime surface and do not require
  // browser credentials. Do not trust preview_required alone; recheck Git diff.
  if (previewRequired === "false" && changedFiles.every(docOnly)) {
    // The separate docs workflow is not a required branch-protection check.
    // Require a trusted, exact-SHA, successful docs-preview-gate readback.
    if (docsPreview !== "success") {
      return { pass: false, reason: "DOCS_PREVIEW_NOT_SUCCESS" };
    }
    return { pass: true, reason: "DOCUMENTATION_ONLY_PREVIEW_VERIFIED" };
  }
  // A false Preview hint with code, workflow or SQL changes is not a bypass.
  if (previewRequired !== "true") {
    return { pass: false, reason: "PREVIEW_SCOPE_UNVERIFIED" };
  }
  if (preview !== "success") return { pass: false, reason: "PREVIEW_NOT_SUCCESS" };
  if (auth0Enabled !== "true") return { pass: false, reason: "AUTH0_E2E_NOT_ENABLED" };
  if (syncAuth0 !== "success") return { pass: false, reason: "AUTH0_PREFLIGHT_NOT_SUCCESS" };
  if (auth0E2E !== "success") return { pass: false, reason: "AUTH0_E2E_NOT_SUCCESS" };
  return { pass: true, reason: "E2E_VERIFIED" };
}

export function changedFiles(base, head) {
  if (!sha.test(base ?? "") || !sha.test(head ?? "")) {
    throw new Error("Exact base/head SHAs are required");
  }
  // --no-renames also exposes deleted source paths, so a code-to-doc rename
  // cannot be falsely classified as documentation-only.
  const out = execFileSync("git", ["diff", "--no-renames", "--name-only",
    `${base}...${head}`, "--"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  return out.split("\n").map(s => s.trim()).filter(Boolean);
}

function main() {
  const files = changedFiles(process.env.PR_BASE_SHA, process.env.PR_HEAD_SHA);
  const result = decideSecurityGate({
    quality: process.env.QUALITY_RESULT,
    previewRequired: process.env.PREVIEW_REQUIRED,
    preview: process.env.PREVIEW_RESULT,
    syncAuth0: process.env.SYNC_AUTH0_RESULT,
    auth0E2E: process.env.AUTH0_E2E_RESULT,
    auth0Enabled: process.env.AUTH0_E2E_ENABLED,
    docsPreview: process.env.DOCS_PREVIEW_RESULT,
    changedFiles: files,
  });
  if (!result.pass) {
    console.error("::error::security-gate BLOCKED: " + result.reason);
    process.exitCode = 1;
  } else {
    console.log("PASS: security-gate " + result.reason);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch {
    console.error("::error::security-gate BLOCKED: change scope not verifiable");
    process.exitCode = 1;
  }
}
