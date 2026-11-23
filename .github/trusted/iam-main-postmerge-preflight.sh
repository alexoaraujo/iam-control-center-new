#!/usr/bin/env bash
set -euo pipefail
# Read-only control. This script is checked out exclusively from refs/heads/main.
REPO="alexoaraujo/iam-control-center-new"
BASE_PR_HEAD="1f6073c990cca160e0c37604bd55181bc808806a"
BASE_MAIN_MERGE="2270fac70bb588cea2ebc2e12cad5b7da96e2a38"
REVIEWED_APP_HEAD="3e053b6c774ee77075dbd038b9a295cc07eefda4"
REVIEWED_APP_MERGE="633ed462566c63cb0307b7266ec147a25e3f84ee"
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
# G3 rebaseline candidate (read-only): this is NOT an approved main release.
# Preserve PR128/PR150/PR151 historical checks below. A separate SHA-specific
# operator approval and lease custodial review are mandatory before any secrets.
G3_REBASELINE_CANDIDATE_SHA="fcc379f39dbe49dfb9de857e4be19f1c4da3ddbf"
G3_REBASELINE_CANDIDATE_TREE="a628c48bcb212c4bedc5ac616a274f24a2e3c05f"
[[ "$GITHUB_SHA" == "$G3_REBASELINE_CANDIDATE_SHA" ]] || {
  echo "::error::BLOCKED_G3_CURRENT_MAIN_DIFFERS_FROM_REVIEW_CANDIDATE"
  exit 1
}
[[ "$(git rev-parse 'HEAD^{tree}')" == "$G3_REBASELINE_CANDIDATE_TREE" ]] || {
  echo "::error::BLOCKED_G3_CURRENT_MAIN_TREE_DIFFERS_FROM_REVIEW_CANDIDATE"
  exit 1
}
echo "::error::BLOCKED_G3_NEW_MAIN_BASELINE_NOT_INDEPENDENTLY_APPROVED"
exit 1

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
# Pin the reviewed PR150 application baseline, rather than silently accepting
# later application/RBAC/SQL changes. PR148 and PR150 were fully gated at their
# respective exact head SHAs. G3 itself remains on the original PR128 lease.
reviewed_app_pr="$(gh api "repos/$REPO/pulls/150")"
jq -e --arg repo "$REPO" --arg head "$REVIEWED_APP_HEAD" --arg merged "$REVIEWED_APP_MERGE" '
  .number == 150 and .state == "closed" and .merged == true and
  .head.repo.full_name == $repo and .base.ref == "main" and
  .head.sha == $head and .merge_commit_sha == $merged
' <<< "$reviewed_app_pr" >/dev/null || {
  echo "::error::Reviewed PR150 identity or exact merge baseline changed."
  exit 1
}
reviewed_main_tree="$(gh api "repos/$REPO/git/commits/$REVIEWED_APP_MERGE" --jq '.tree.sha')"
reviewed_head_tree="$(gh api "repos/$REPO/git/commits/$REVIEWED_APP_HEAD" --jq '.tree.sha')"
[[ "$reviewed_main_tree" == "$reviewed_head_tree" ]] || {
  echo "::error::PR150 merge tree differs from its gated exact PR-head tree."
  exit 1
}

# The whole post-merge tree must match exactly the reviewed head of this
# narrowly-scoped control PR. This rejects hidden changes even to allowlisted paths.
control_pr="$(gh api "repos/$REPO/pulls/151")"
jq -e --arg repo "$REPO" '
  .number == 151 and .state == "closed" and .merged == true and
  .head.repo.full_name == $repo and .base.ref == "main" and
  (.head.sha | test("^[a-f0-9]{40}$")) and
  (.merge_commit_sha | test("^[a-f0-9]{40}$"))
' <<< "$control_pr" >/dev/null || {
  echo "::error::The reviewed G3 control PR151 must be merged before execution."
  exit 1
}
control_sha="$(jq -r '.head.sha' <<< "$control_pr")"
control_merge="$(jq -r '.merge_commit_sha' <<< "$control_pr")"
[[ "$control_merge" == "$main_sha" ]] || {
  echo "::error::Main advanced beyond the reviewed PR151 merge commit."
  exit 1
}
main_tree="$(gh api "repos/$REPO/git/commits/$main_sha" --jq '.tree.sha')"
control_tree="$(gh api "repos/$REPO/git/commits/$control_sha" --jq '.tree.sha')"
[[ "$main_tree" == "$control_tree" ]] || {
  echo "::error::The main Git tree differs from reviewed PR151 head source."
  exit 1
}

# Compare original merged G3 application baseline against reviewed PR150.
# All 13 exact paths and their change types are pinned: the trusted G3 suite
# and disposable Neon branch have not been modified by the Production work.
reviewed_scope="$(gh api "repos/$REPO/compare/$BASE_MAIN_MERGE...$REVIEWED_APP_MERGE")"
jq -e '
  .status == "ahead" and (.files | length) == 13 and
  ([.files[] | select(
    (.status == "added" and
      (.filename == ".github/workflows/iam-main-postmerge-auth0-rbac.yml" or
       .filename == ".github/trusted/iam-main-postmerge-preflight.sh" or
       .filename == "scripts/iam-main-postmerge-g3-contract.test.mjs" or
       .filename == "docs/operations/iam-main-postmerge-g3-runbook.md" or
       .filename == "apps/web/src/lib/production-branch.test.ts" or
       .filename == "apps/web/src/lib/production-branch.ts" or
       .filename == "docs/operations/iam-production-branch-fingerprint-readback-20261121.md" or
       .filename == "docs/operations/iam-production-rbac-branch-attestation-20261121.md")) or
    (.status == "modified" and
      (.filename == "scripts/bind-e2e-preview.mjs" or
       .filename == "scripts/bind-e2e-preview.test.mjs" or
       .filename == "apps/web/src/lib/authorization.ts" or
       .filename == "apps/web/src/lib/readiness.test.ts" or
       .filename == "apps/web/src/lib/readiness.ts"))
  )] | length) == 13
' <<< "$reviewed_scope" >/dev/null || {
  echo "::error::Reviewed PR128-to-PR150 source/SQL/G3 scope differs from the exact allowlist."
  exit 1
}

# After PR150 only this reviewed G3 preflight, its contract tests, and
# PR151's exact branch-bound Auth0 callback map and its tests may change.
# No runtime authorization, database, workflows, or migrations are allowed.
scope="$(gh api "repos/$REPO/compare/$REVIEWED_APP_MERGE...$main_sha")"
jq -e '
  .status == "ahead" and (.files | length) == 4 and
  ([.files[] | select(
    .status == "modified" and
    (.filename == ".github/trusted/iam-main-postmerge-preflight.sh" or
     .filename == "scripts/iam-main-postmerge-g3-contract.test.mjs" or
     .filename == "scripts/bind-e2e-preview.mjs" or
     .filename == "scripts/bind-e2e-preview.test.mjs")
  )] | length) == 4
' <<< "$scope" >/dev/null || {
  echo "::error::Post-PR150 main changes exceed reviewed G3/PR151 callback-only scope."
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
# The Vercel deployment-config producer uses paths filters. The approved
# PR128 main merge exercised that check; this control-only PR147 merge does not
# modify app/manifest/guard source and will not schedule a new guard check.
# Require the original known-good deployment-config check on the exact app
# baseline, then require fresh main-SHA quality and PG18. Whole-tree equality
# with reviewed PR151 and the four-file allowlist prohibit runtime/config drift.
# PR150 is the last reviewed application code baseline on main. Its real
# Auth0 E2E, Preview, security gate and PG18 are independent of old G3 proof.
reviewed_checks="$(gh api "repos/$REPO/commits/$REVIEWED_APP_HEAD/check-runs?per_page=100")"
for check in quality security-gate auth0-e2e preview-deployment sync-auth0-preview pg18-security-contracts deployment-config "Vercel Preview Comments"; do
  jq -e --arg name "$check" '
    [.check_runs[] | select(.name == $name and .status == "completed" and .conclusion == "success")]
    | length == 1
  ' <<< "$reviewed_checks" >/dev/null || {
    echo "::error::Reviewed exact PR150 application check is not SUCCESS: $check"
    exit 1
  }
done

baseline_checks="$(gh api "repos/$REPO/commits/$BASE_MAIN_MERGE/check-runs?per_page=100")"
jq -e '
  [.check_runs[] | select(
    .name == "deployment-config" and
    .status == "completed" and .conclusion == "success"
  )] | length == 1
' <<< "$baseline_checks" >/dev/null || {
  echo "::error::Approved PR128 deployment-config baseline is not successful."
  exit 1
}
main_checks="$(gh api "repos/$REPO/commits/$main_sha/check-runs?per_page=100")"
for check in quality pg18-security-contracts; do
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
