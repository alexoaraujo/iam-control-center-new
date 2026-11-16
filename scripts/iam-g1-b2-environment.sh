#!/usr/bin/env bash
# IAM-G1: reconcile Backblaze B2 environment without exposing secret material.
# Run only from a trusted interactive terminal authenticated with GitHub CLI.
set -euo pipefail
umask 077

REPO="alexoaraujo/iam-control-center-new"
ENVIRONMENT="IAM-G1-Backup-Custody"
ENV_API="repos/${REPO}/environments/${ENVIRONMENT}"
MODE="${1:-audit}"
BUCKET="iam-control-center-g1-backups"
ENDPOINT="https://s3.us-east-005.backblazeb2.com"
REGION="us-east-005"

command -v gh >/dev/null || { echo "BLOCKED_GH_CLI_NOT_INSTALLED" >&2; exit 2; }
command -v jq >/dev/null || { echo "BLOCKED_JQ_NOT_INSTALLED" >&2; exit 2; }
gh auth status >/dev/null 2>&1 || { echo "BLOCKED_GITHUB_AUTH_REQUIRED" >&2; exit 2; }

env_file="$(mktemp)"
err_file="$(mktemp)"
trap 'rm -f "$env_file" "$err_file"' EXIT

fetch_environment() {
  gh api "$ENV_API" >"$env_file" 2>"$err_file"
}

bootstrap() {
  if fetch_environment; then
    echo "ENV_ALREADY_EXISTS: protections left unchanged"
    return
  fi
  if ! grep -q "HTTP 404" "$err_file"; then
    echo "BLOCKED_ENVIRONMENT_READ: verify admin access; no changes made" >&2
    exit 2
  fi

  # New environment: only main is allowed. No credentials are added until
  # a human configures independent required reviewers and prevent self-review.
  printf '%s' '{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}' |
    gh api --method PUT "$ENV_API" --input - >/dev/null
  gh api --method POST "$ENV_API/deployment-branch-policies" \
    -f name=main -f type=branch >/dev/null
  echo "ENV_CREATED_MAIN_ONLY: required reviewer must be configured in GitHub Settings"
}

verify_protections() {
  fetch_environment || {
    echo "BLOCKED_ENVIRONMENT_NOT_READABLE: $ENVIRONMENT" >&2
    exit 2
  }
  if ! jq -e '.deployment_branch_policy.custom_branch_policies == true' "$env_file" >/dev/null; then
    echo "BLOCKED_ENVIRONMENT_BRANCH_POLICY: configure custom branch policy main" >&2
    exit 3
  fi
  if ! gh api "$ENV_API/deployment-branch-policies?per_page=100" |
    jq -e '.total_count == 1 and .branch_policies[0].name == "main"' >/dev/null; then
    echo "BLOCKED_ENVIRONMENT_BRANCH_POLICY: only main must be permitted" >&2
    exit 3
  fi
  if ! jq -e 'any(.protection_rules[]?; .type == "required_reviewers" and .prevent_self_review == true and ([.reviewers[]?] | length > 0))' "$env_file" >/dev/null; then
    echo "BLOCKED_INDEPENDENT_REVIEW: require reviewers and prevent self-review" >&2
    exit 3
  fi
  echo "PASS_ENVIRONMENT_PROTECTIONS: main-only policy and independent review required"
}

audit_names() {
  local secret_names variable_json fail=0 name found
  secret_names="$(gh secret list --repo "$REPO" --env "$ENVIRONMENT" --json name --jq '.[].name')"
  variable_json="$(gh variable list --repo "$REPO" --env "$ENVIRONMENT" --json name,value)"
  for name in IAM_G1_B2_ACCESS_KEY_ID IAM_G1_B2_SECRET_ACCESS_KEY; do
    if grep -Fxq "$name" <<<"$secret_names"; then
      echo "PRESENT_ENV_SECRET_NAME: $name (value never readable)"
    else
      echo "MISSING_ENV_SECRET: $name"
      fail=1
    fi
  done

  for name in IAM_G1_B2_BUCKET IAM_G1_B2_ENDPOINT IAM_G1_B2_REGION; do
    case "$name" in
      IAM_G1_B2_BUCKET) found="$BUCKET" ;;
      IAM_G1_B2_ENDPOINT) found="$ENDPOINT" ;;
      IAM_G1_B2_REGION) found="$REGION" ;;
    esac
    if jq -e --arg n "$name" --arg v "$found" 'any(.[]; .name==$n and .value==$v)' <<<"$variable_json" >/dev/null; then
      echo "PASS_ENV_VARIABLE: $name"
    else
      echo "MISSING_OR_MISMATCHED_ENV_VARIABLE: $name"
      fail=1
    fi
  done
  return "$fail"
}

apply_configuration() {
  verify_protections
  echo "Applying only non-sensitive B2 variables to the protected environment"
  gh variable set IAM_G1_B2_BUCKET --repo "$REPO" --env "$ENVIRONMENT" --body "$BUCKET"
  gh variable set IAM_G1_B2_ENDPOINT --repo "$REPO" --env "$ENVIRONMENT" --body "$ENDPOINT"
  gh variable set IAM_G1_B2_REGION --repo "$REPO" --env "$ENVIRONMENT" --body "$REGION"

  [[ -t 0 ]] || { echo "BLOCKED_INTERACTIVE_TERMINAL_REQUIRED_FOR_SECRETS" >&2; exit 3; }
  local name value
  for name in IAM_G1_B2_ACCESS_KEY_ID IAM_G1_B2_SECRET_ACCESS_KEY; do
    printf 'Enter Backblaze value for %s (hidden): ' "$name" >&2
    IFS= read -r -s value
    printf '\n' >&2
    if [[ -z "$value" ]]; then
      echo "BLOCKED_EMPTY_SECRET: $name" >&2
      unset value
      exit 3
    fi
    # stdin avoids secret material in process arguments, files, Git history and logs.
    if ! printf '%s' "$value" | gh secret set "$name" --repo "$REPO" --env "$ENVIRONMENT"; then
      unset value
      echo "BLOCKED_SECRET_UPDATE: $name" >&2
      exit 3
    fi
    unset value
    echo "UPDATED_ENV_SECRET: $name (value not displayed)"
  done
  audit_names
}

case "$MODE" in
  bootstrap)
    bootstrap
    ;;
  audit)
    verify_protections
    audit_names
    ;;
  apply)
    apply_configuration
    ;;
  run-probe)
    verify_protections
    audit_names
    gh workflow run iam-g1-b2-probe.yml --repo "$REPO" --ref main
    echo "PROBE_DISPATCHED: verify run logs before declaring PASS"
    ;;
  *)
    echo "Usage: bash scripts/iam-g1-b2-environment.sh {bootstrap|audit|apply|run-probe}" >&2
    exit 2
    ;;
esac
