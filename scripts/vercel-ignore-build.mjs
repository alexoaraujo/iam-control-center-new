import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { isApprovedProductionRelease } from "./production-deploy-approval.mjs";

const BUILD_RELEVANT = [
  /^\.github\/workflows\/quality\.yml$/,
  // E2E harness changes require a fresh exact-SHA Preview deployment.
  /^\.github\/e2e\//,
  /^scripts\//,
  /^apps\/web\//,
  /^packages\//,
  /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc|vercel\.json|turbo\.json|pnpmfile\.cjs)$/,
  /^(tsconfig[^/]*\.json|eslint\.config\.[^/]+|postcss\.config\.[^/]+|tailwind\.config\.[^/]+|next\.config\.[^/]+)$/,
];

export function hasBuildRelevantChanges(changedFiles) {
  return changedFiles.some((file) => BUILD_RELEVANT.some((pattern) => pattern.test(file)));
}

export function shouldBuild({
  environment, previousSha, currentSha, changedFiles, approvedProductionSha, gitRef,
}) {
  // A Git push to main must not implicitly authorize a Production build.
  // Exact-SHA release authorization is supplied separately in Vercel Production.
  if (environment === "production") {
    return isApprovedProductionRelease({
      commitSha: currentSha, approvedSha: approvedProductionSha, ref: gitRef,
    });
  }

  // Keep Preview scope checks and other environments unchanged.
  if (environment !== "preview") return true;

  // Fail open for Preview builds when Git metadata is missing.
  if (!previousSha || !currentSha) return true;

  return hasBuildRelevantChanges(changedFiles);
}

function diffFiles(base, head) {
  const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const output = execFileSync("git", ["-C", gitRoot, "diff", "--name-only", `${base}...${head}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return output.split("\n").map((file) => file.trim()).filter(Boolean);
}

function main() {
  if (process.argv.includes("--github-output")) {
    let previewRequired = true;
    try {
      const base = process.env.BASE_SHA;
      const head = process.env.HEAD_SHA;
      if (base && head) {
        previewRequired = shouldBuild({
          environment: "preview",
          previousSha: base,
          currentSha: head,
          changedFiles: diffFiles(base, head),
        });
      }
    } catch {
      // A diff failure must not suppress a required Preview deployment.
      previewRequired = true;
    }

    if (!process.env.GITHUB_OUTPUT) {
      throw new Error("GITHUB_OUTPUT is required for --github-output");
    }
    appendFileSync(process.env.GITHUB_OUTPUT, `preview_required=${previewRequired}\n`);
    return;
  }

  let build = true;
  try {
    const previousSha = process.env.VERCEL_GIT_PREVIOUS_SHA;
    const currentSha = process.env.VERCEL_GIT_COMMIT_SHA;
    if (process.env.VERCEL_ENV === "production") {
      build = shouldBuild({
        environment: "production",
        currentSha,
        approvedProductionSha: process.env.IAM_APPROVED_PRODUCTION_SHA,
        gitRef: process.env.VERCEL_GIT_COMMIT_REF,
      });
    } else if (process.env.VERCEL_ENV === "preview" && previousSha && currentSha) {
      build = shouldBuild({
        environment: process.env.VERCEL_ENV,
        previousSha,
        currentSha,
        changedFiles: diffFiles(previousSha, currentSha),
      });
    }
  } catch {
    // A git/diff failure must fall back to a normal build.
    build = true;
  }

  // Vercel's ignored-build command convention: 0 skips, non-zero builds.
  process.exit(build ? 1 : 0);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
