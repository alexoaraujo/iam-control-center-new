#!/usr/bin/env bash
set -euo pipefail
# Read-only control. This script is checked out exclusively from refs/heads/main.
REPO="alexoaraujo/iam-control-center-new"
BASE_PR_HEAD="1f6073c990cca160e0c37604bd55181bc808806a"
BASE_MAIN_MERGE="2270fac70bb588cea2ebc2e12cad5b7da96e2a38"
PREVIEW_URL="https://iam-control-center-new-pr128-ci.vercel.app"

[[ "$GITHUB_REPOSITORY" == "$REPO" && "$GITHUB_REF" == "refs/heads/main" &&
   "$GITHUB_EVENT_NAME" == "issue_comment" ]] || {
  echo "::error::The postmerge G3 executor must come from a trusted main issue_comment."
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" ]] || {
  echo "::error::The checkout is not the trusted event main SHA."
  exit 1
}
[[ "$(jq -r '.issue.number' "$GITHUB_EVENT_PATH")" == "128" &&
   "$(jq -r '.issue.pull_request != null' "$GITHUB_EVENT_PATH")" == "true" &&
   "$(jq -r '.comment.user.login' "$GITHUB_EVENT_PATH")" == "alexoaraujo" ]] || {
  echo "::error::Only the authorized owner comment on merged PR128 can trigger G3."
  exit 1
}
body="$(jq -r '.comment.body' "$GITHUB_EVENT_PATH")"
if [[ "$body" =~ ^/peos-main-postmerge-g3\ ([0-9a-f]{40})$ ]]; then
  command_sha="$(echo "$body" | cut -d' ' -f2)"
else
  echo "::error::The postmerge G3 command must have the exact current 40-digit main SHA."
  exit 1
fi
main_sha="$(gh api "repos/$REPO/branches/main" --jq '.commit.sha')"
[[ "$command_sha" == "$GITHUB_SHA" && "$main_sha" == "$GITHUB_SHA" ]] || {
  echo "::error::Main SHA changed or the issue comment references the wrong commit."
  exit 1
}
[[ -z "$G3_EXPECTED_MAIN_SHA" || "$G3_EXPECTED_MAIN_SHA" == "$main_sha" ]] || {
  echo "::error::Main changed after the first no-secret preflight."
  exit 1
}
[[ -z "$G3_APPROVED_SHA" || "$G3_APPROVED_SHA" == "$BASE_PR_HEAD" ]] || {
  echo "::error::The protected G3 approval must remain bound to the reviewed PR128 SHA."
  exit 1
}
pr="$(gh api "repos/$REPO/pulls/128")"
jq -e --arg repo "$REPO" --arg head "$BASE_PR_HEAD" --arg merged "$BASE_MAIN_MERGE" '
  .number == 128 and .state == "closed" and .merged == true and
  .head.repo.full_name == $repo and .base.ref == "main" and
  .head.sha == $head and .merge_commit_sha == $merged
' <<< "$pr" >/dev/null || {
  echo "::error::Merged PR128 identity, SHA or merge ancestry differs from approved baseline."
  exit 1
}
# Pin the ENTIRE post-merge source tree to the exact contents reviewed in PR147.
# This rejects later modifications to even the two allowlisted CI callback scripts:
# a path-only allowlist alone would not be sufficient before privileged execution.
control_pr="$(gh api "repos/$REPO/pulls/147")"
jq -e --arg repo "$REPO" '
  .number == 147 and .state == "closed" and .merged == true and
  .head.repo.full_name == $repo and .base.ref == "main" and
  (.head.sha | test("^[a-f0-9]{40}$")) and
  (.merge_commit_sha | test("^[a-f0-9]{40}$"))
' <<< "$control_pr" >/dev/null || {
  echo "::error::The post-merge G3 control PR147 must be merged and identified before use."
  exit 1
}
control_sha="$(jq -r '.head.sha' <<< "$control_pr")"
control_merge="$(jq -r '.merge_commit_sha' <<< "$control_pr")"
[[ "$control_merge" == "$main_sha" ]] || {
  echo "::error::Main advanced beyond the reviewed PR147 workflow merge commit."
  exit 1
}
main_tree="$(gh api "repos/$REPO/git/commits/$main_sha" --jq '.tree.sha')"
control_tree="$(gh api "repos/$REPO/git/commits/$control_sha" --jq '.tree.sha')"
[[ "$main_tree" == "$control_tree" ]] || {
  echo "::error::The main Git tree differs from reviewed PR147 source."
  exit 1
}

# No app/DB/runtime files may differ. Postmerge G3 adds exactly four control files
# and two CI callback-lease-only edits needed for the PR that installed this workflow.
scope="$(gh api "repos/$REPO/compare/$BASE_MAIN_MERGE...$main_sha")"
jq -e '
  .status == "ahead" and (.files | length) == 6 and
  ([.files[] | select(
    (.status == "added" and
      (.filename == ".github/workflows/iam-main-postmerge-auth0-rbac.yml" or
       .filename == ".github/trusted/iam-main-postmerge-preflight.sh" or
       .filename == "scripts/iam-main-postmerge-g3-contract.test.mjs" or
       .filename == "docs/operations/iam-main-postmerge-g3-runbook.md")) or
    (.status == "modified" and
      (.filename == "scripts/bind-e2e-preview.mjs" or
       .filename == "scripts/bind-e2e-preview.test.mjs"))
  )] | length) == 6
' <<< "$scope" >/dev/null || {
  echo "::error::Main drifted from PR128 application/Neon baseline or allowed control-file scope."
  exit 1
}
pr_checks="$(gh api "repos/$REPO/commits/$BASE_PR_HEAD/check-runs?per_page=100")"
for check in quality security-gate auth0-e2e "Execute trusted G3 Auth0/RBAC proof"; do
  jq -e --arg name "$check" '
    [.check_runs[] | select(.name == $name and .status == "completed" and .conclusion == "success")]
    | length == 1
  ' <<< "$pr_checks" >/dev/null || {
    echo "::error::Approved exact-PR128 check is not successful: $check"
    exit 1
  }
done
main_checks="$(gh api "repos/$REPO/commits/$main_sha/check-runs?per_page=100")"
for check in quality pg18-security-contracts deployment-config; do
  jq -e --arg name "$check" '
    [.check_runs[] | select(.name == $name and .status == "completed" and .conclusion == "success")]
    | length == 1
  ' <<< "$main_checks" >/dev/null || {
    echo "::error::The exact main SHA did not pass required postmerge check: $check"
    exit 1
  }
done
main_runs="$(gh api "repos/$REPO/actions/runs?head_sha=$main_sha&per_page=100")"
jq -e --arg sha "$main_sha" '
  [.workflow_runs[] | select(.name == "CI" and .event == "push" and .head_sha == $sha)]
  | sort_by(.created_at) | last
  | .status == "completed" and .conclusion == "success"
' <<< "$main_runs" >/dev/null || {
  echo "::error::No SUCCESS main-push CI for the exact current SHA."
  exit 1
}
echo "PASS_POSTMERGE_MAIN_SHA_PR128_APP_PARITY_AND_CHECKS $main_sha"
printf 'eligible=true\nhead_sha=%s\nmain_sha=%s\npreview_url=%s\n' \
 "$BASE_PR_HEAD" "$main_sha" "$PREVIEW_URL" >> "$GITHUB_OUTPUT"
