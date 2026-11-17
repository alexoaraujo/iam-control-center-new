# IAM PR #113 — Five operational controls: independent evidence reconciliation

**Prepared:** 2026-11-17 UTC  
**Purpose:** evidence-only authorization vehicle; **not** an operational approval and **not** an instruction to merge.  
**Target PR:** [#113](https://github.com/alexoaraujo/iam-control-center-new/pull/113)  
**Prior authorization vehicle:** [#114](https://github.com/alexoaraujo/iam-control-center-new/pull/114)  
**Exact target HEAD:** `51c857a1f130300cdb3f34686511200364558b87`  
**Approval PR #114 HEAD:** `2fd710a00301ce436582291ef2397900cc394ebe`  
**Preview deployment:** `dpl_3x7o3fkXAcPvbtkbTNPQ5eMTyHyv` (READY at last authenticated readback)  
**Callback baseline:** `iam-control-center-new-ci-preview.vercel.app` → `dpl_AHt58aoFXCAJXzkXngm2ZgrVS72w`, branch `feat/iam-api-rbac-lineage-20261110`  
**Production baseline:** `dpl_4sd7DPf8nnr5WuzieAkn2CZcbSq1`.

## 1. Reusable historical proof (not transferable authorization)

| Evidence | Reference | What it proves | What it does NOT prove |
|---|---|---|---|
| Independent approval of synthetic RBAC fixture | [PR #108](https://github.com/alexoaraujo/iam-control-center-new/pull/108) | Prior Phase B fixture grant/revoke authority scoped to PR #41; consumed | Authority for new PR #113 lease |
| Independent approval of exact-main-SHA replay | [PR #110](https://github.com/alexoaraujo/iam-control-center-new/pull/110) | Prior independent review, SHA-bound, consumed | Reusable open-ended callback authority |
| Successful Auth0/RBAC replay and cleanup | [PR #111 evidence](https://github.com/alexoaraujo/iam-control-center-new/pull/111#issuecomment-6938480228), [CI #44017821117](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44017821117) | Real Auth0 login, grant HTTP 200 / revoke HTTP 403 same session, Neon cleanup 0/6, rollback of Preview aliases | Current Auth0 allowlist or current lease exclusivity |
| Historical OIDC trusted-source test | [CI #44017821117 Auth0 job](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44017821117/job/133820246983) | Vercel Trusted Sources test passed for that prior E2E context | Effective GitHub OIDC provider-side trust policy now |
| Sequential callback lease policy | [PR #112 review](https://github.com/alexoaraujo/iam-control-center-new/pull/112) | Independent CONDITIONAL approval only for PRs #98/#101/#44 | Any execution on PR #113 |
| Phase A nonsecret Preview preparation | [PR #114 evidence](https://github.com/alexoaraujo/iam-control-center-new/pull/114#issuecomment-6943663320) | Three branch-specific nonsecret variables created and verified | Phase B operational authorization |
| Exact-SHA redeploy and unchanged callback | [PR #114 readback](https://github.com/alexoaraujo/iam-control-center-new/pull/114#issuecomment-6944118584) | Preview READY and callback baseline recorded | Auth0 callback allowlist |
| Security-readback / evidence gap | [PR #114 audit](https://github.com/alexoaraujo/iam-control-center-new/pull/114#issuecomment-6945047472) | Previous `APPROVED` review contains literal evidence/operator/window placeholders | Verified approval |
| GitHub / Neon independent inventory | [PR #114 audit](https://github.com/alexoaraujo/iam-control-center-new/pull/114#issuecomment-6945872146) | Protect-main active; Neon disposable branch PG18.7 / safe runtime NO BYPASSRLS; GitHub collaborator has `write` | Vercel/Auth0 operator authority |

**Important:** The latest PR #114 review (2026-11-17T10:26:52Z) marks all five `true` but **itself** states `operational_lease_gate=BLOCKED`, `auth0_e2e_execution=NOT_AUTHORIZED`, `decision=HOLD_PENDING_INDEPENDENT_EVIDENCE`. This document records that contradiction without silently overriding it.

## 2. Five evidence contracts: effective current state

**No inference from a historical PASS or from a reviewer name.** Each reviewer must attach an immutable evidence link/ID and timestamp, with redacted credentials, for the exact SHA and target environment.

| Control | Current review status | Evidence required for transition to PASS | Owner |
|---|---|---|---|
| `auth0_callback_allowlist_verified` | **UNVERIFIED** | Auth0 tenant, exact Regular Web App/client identity, *effective* Allowed Callback URLs including `https://iam-control-center-new-ci-preview.vercel.app/auth/callback`; sanitized authenticated readback, UTC time | Auth0 authorized operator + independent reviewer |
| `github_environment_custody_verified` | **UNVERIFIED** | Exact environment(s), relevant workflow `environment:` binding, reviewer/branch restrictions actually enforced in repo plan, secret-name presence (not value), approval/readback logs | GitHub environment custodian + reviewer |
| `oidc_trusted_source_verified` | **UNVERIFIED** | Identity provider actually used by operation; GitHub immutable `sub` and effective audience/issuer trust, sanitized cloud-side policy and positive/negative test. **Vercel Trusted Sources history is not equivalent**. If OIDC not used, separately authorize a contract change to `NOT_APPLICABLE`, never silently substitute `true` | Cloud/OIDC owner + reviewer |
| `no_concurrent_lease_jobs` | **PARTIAL_GITHUB_ONLY** | Just-in-time GitHub Actions in_progress/queued inspection **plus** external lease/alias lock inventory, atomically acquired exclusivity, and no conflicting lease; timestamp at operation start | Lease executor + independent reviewer |
| `rollback_operator_identified` | **UNVERIFIED** | Personally authored GitHub acceptance by named operator distinct from executor, verified Vercel restore privilege and current availability, explicit future UTC window, dry-run/readback of rollback path | Named rollback operator + reviewer |

**Known partial evidence:** `preview_branch_env_verified=true`, `protect_main_enabled=true`, callback domain `verified=true` with **original** branch unchanged, deployment `READY`. GitHub Actions previously showed `in_progress=0`, `queued=1` unrelated B2 probe [run #43856164098](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/43856164098); this is **not** evidence of no external lease. GitHub connected read API did not authorize reading private `/environments` or `/actions/oidc/customization/sub`. No Auth0 callback settings readback or independent rollback operator acceptance is yet attached to the review.

## 3. Independent operator acceptance (must be authored by operator, not executor)

**Candidate:** `@alexoaraujo83` (GitHub repository permission `write` confirmed; not sufficient for Vercel restoration or independence). A different operator may be designated. Never impersonate or pre-approve them.

Required separate PR review/comment, **posted by the operator's GitHub identity**:

```text
IAM_PR113_ROLLBACK_OPERATOR_ACCEPTED
operator_github=<actual_login>
executor_github=<different_login>
independence_verified=true
vercel_restore_access_evidence=<sanitized_audit_reference>
rollback_operator_acceptance=<this_comment_permalink>
lease_window_start_utc=<actual_future_UTC_timestamp>
lease_window_end_utc=<actual_future_UTC_timestamp>
baseline_callback_deployment=dpl_AHt58aoFXCAJXzkXngm2ZgrVS72w
rollback_on_success=true
rollback_on_failure=true
rollback_on_timeout=true
rollback_readback_required=true
```

The operator must state availability for the entire window, capability to restore the callback original branch and alias, and willingness to post an independent readback after success **or** failure. No fictional acceptance or stale, assumed window may be used.

## 4. Independent final reviewer decision (do not publish PASS until verified)

**Approval subject** is this evidence PR's exact HEAD *and* PR #113 SHA `51c857a1f130300cdb3f34686511200364558b87`, PR #114 SHA `2fd710a00301ce436582291ef2397900cc394ebe`, specific Vercel deployment and **actual future UTC window**. Material changes invalidate prior preflights.

Reviewer must include all of:
```text
IAM_PR113_FIVE_CONTROLS_INDEPENDENTLY_VERIFIED
approval_pr=<number_of_this_pr>
approval_head_sha=<full_sha_of_this_pr>
target_pr=113
target_head_sha=51c857a1f130300cdb3f34686511200364558b87
prior_approval_pr=114
prior_approval_head_sha=2fd710a00301ce436582291ef2397900cc394ebe
deployment_id=dpl_3x7o3fkXAcPvbtkbTNPQ5eMTyHyv

auth0_callback_allowlist_verified=<true_ONLY_with_evidence>
auth0_allowlist_evidence=<immutable_id_or_link>
github_environment_custody_verified=<true_ONLY_with_evidence>
github_environment_evidence=<immutable_id_or_link>
oidc_trusted_source_verified=<true_ONLY_with_evidence>
oidc_trust_evidence=<immutable_id_or_link>
no_concurrent_lease_jobs=<true_ONLY_with_evidence>
concurrency_evidence=<immutable_id_or_link>
rollback_operator_identified=<true_ONLY_with_evidence>
rollback_operator_github=<actual_login>
rollback_operator_acceptance=<actual_personal_comment_link>
rollback_operator_access_evidence=<immutable_id_or_link>
lease_window_start_utc=<future_UTC>
lease_window_end_utc=<future_UTC>

production_alias_unchanged=true
protect_main_enabled=true
rollback_mandatory=true
main_merge_authorized=false
production_promotion_authorized=false
neon_production_write_authorized=false
secrets_rotation_authorized=false
decision=<BLOCKED_PENDING_EVIDENCE_OR_APPROVED_OPERATIONAL_LEASE_EXECUTION_ON_EXACT_SHA>
```

**Gate semantics:** no marker, `APPROVED` UI review state, or literal `true` replaces evidence verification. A reviewer **must retain** `decision=BLOCKED_PENDING_EVIDENCE` and `operational_lease_gate=BLOCKED` while any item is unproven. Even following evidence PASS, execute the callback lease **sequentially** in the approved window and restore the original alias/branch, with independent readback and no Production/G1/main operations.

## 5. Checklist PEOS

- [x] **Executar:** create isolated documentation branch from main baseline; do not alter app, secret or production.
- [x] **Verificar:** reconcile earlier human reviews, CI and real E2E evidence; distinguish historical PASS from current authority.
- [x] **Corrigir:** record exact unresolved evidence gaps and prohibit placeholder-only approval.
- [ ] **Testar:** collect current effective Auth0/GitHub environment/provider OIDC/exclusive lease evidence; test rollback route safely.
- [ ] **Revisar:** independent named operator accepts responsibility; independent reviewer links concrete evidence.
- [ ] **Validar:** five controls PASS on exact SHA, fresh UTC window, explicit affirmative operational decision.
- [ ] **Avançar:** only then may a single-PR callback lease start; restore baseline, validate cleanup, preserve main/Production.

**Current verdict:** `technical_preview_gate=PASS`; `operational_lease_gate=BLOCKED_PENDING_EVIDENCE`; `auth0_callback_transfer=NOT_EXECUTED`; `auth0_e2e_execution=NOT_AUTHORIZED`; `merge=NOT_AUTHORIZED`. This PR is an **approval/evidence vehicle, not merge material**. Close without merging after completion to avoid a documentation-only main commit.
