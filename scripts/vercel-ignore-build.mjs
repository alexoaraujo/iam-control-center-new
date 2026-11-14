import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

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

export function shouldBuild({ environment, previousSha, currentSha, changedFiles, mergeParentChangedFiles = [] }) {
  // Production and non-Preview deployments must never be skipped.
  if (environment !== "preview") return true;

  // Fail closed: missing commit metadata means build rather than skip.
  if (!previousSha || !currentSha) return true;

  return hasBuildRelevantChanges(changedFiles) || hasBuildRelevantChanges(mergeParentChangedFiles);
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

/**
 * A Vercel update can be a merge of main into a long-lived PR. Comparing only
 * VERCEL_GIT_PREVIOUS_SHA -> HEAD then sees main's database/docs changes,
 * even while HEAD still contains unbuilt Auth0/web changes relative to main.
 * Compare HEAD's TREE to each additional parent, too; missing parent objects
 * fail closed in main() and cause a normal build rather than a skipped build.
 */
function diffFilesAgainstAdditionalMergeParents(head) {
  const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const commitHeader = execFileSync("git", ["-C", gitRoot, "cat-file", "-p", head], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).split("\n\n", 1)[0];
  const parents = commitHeader.split("\n")
    .filter((line) => /^parent [a-f0-9]{40}$/.test(line))
    .map((line) => line.slice(7));
  if (parents.length < 2) return [];
  return parents.slice(1).flatMap((parent) => {
    const output = execFileSync("git", ["-C", gitRoot, "diff", "--name-only", parent, head], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    return output.split("\n").map((file) => file.trim()).filter(Boolean);
  });
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
    if (process.env.VERCEL_ENV === "preview" && previousSha && currentSha) {
      build = shouldBuild({
        environment: process.env.VERCEL_ENV,
        previousSha,
        currentSha,
        changedFiles: diffFiles(previousSha, currentSha),
        mergeParentChangedFiles: diffFilesAgainstAdditionalMergeParents(currentSha),
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
