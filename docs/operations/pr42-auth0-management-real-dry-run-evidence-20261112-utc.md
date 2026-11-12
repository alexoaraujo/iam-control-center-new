# PR #42 — Auth0 Management API real dry-run: immutable evidence and import gate

**Audit timestamp:** 2026-11-12 UTC (2026-11-11 local Brazil). **Status:** SOURCE READ-ONLY **PASS**; BACKFILL **BLOCKED**, independent sign-off missing.

## Approved M2M verification (no user content)

- Tenant: `iam-control-center.us.auth0.com`.
- [Auth0 Management M2M OAuth2 run 43138251453](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/43138251453) — **SUCCESS**, `client_credentials`, Management API audience, Bearer token with **only** `read:users`. Token and client secret never printed.
- The protected GitHub environment `IAM-Audit-Development` supplied the credentials. **This does not establish a separate approval to import.**

## Real tenant population evidence (no SQL, no user profiles in logs)

- [Read-only real Auth0 dry-run 43142383532](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/43142383532), [job 130932182352](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/43142383532/job/130932182352).
- Exact auditable code SHA: `4d6e2a9e283ddc8d3325354ccf3cf5b3e06dd406`.
- Protected environment: `IAM-Audit-Development`. Node.js 24.
- 7/7 synthetic CLI contract tests **PASS** before Management API access.
- First read: `scanned=2`. Independent second full read: `scanned=2`, same normalized source fingerprint. Separate Management API total-count endpoint: `providerTotal=2`.
- `mode=dry-run`, `written=0`, `databaseWrites=0`, `stableAcrossTwoReads=true`.
- Canonical SHA-256: `0ac84ffa6a970aa59bf4b1764c59362ff115fe166e23275d283ece0d6aa8257a`.
- This digest is a **consistency marker, not a security credential or grant**; do not use it alone to authorize writes. Source records and API tokens remain undisclosed.

## Target Neon isolation — inspected read-only

- Project `tiny-rice-70320263`; DB `iam_database`; disposable branch `br-floral-lab-b63xaw3z` (`validation/pr-42-auth0-sync-e2e-20261111`).
- Parent `br-ancient-term-b6mmx5ol` (Development); `primary=false`, `protected=false`, branch ready; expiry `2026-11-13T00:00:00Z`.
- Direct SQL session with role `iam_app_runtime_login`: `BYPASSRLS=false`, `INSERT=false`, `UPDATE=false`, restricted `iam.sync_auth0_identity(...)` available.
- Count (aggregate only): `Neon Auth0 identity_count=1`, `authenticated_identity_count=1`, `memberships=0`, `synthetic fixture rows=0`.
- **Difference: 2 Auth0 source users vs 1 Neon identity.** This alone does not establish exact set difference or validate a candidate write. A reviewer must reconcile subject identifiers privately and approve the expected result.
- Vercel `AUTH0_NEON_SYNC_ENABLED=true` and sensitive `DATABASE_URL` are scoped to Preview PR #42 only; Development flag false; Production unchanged.
- Schema diff vs Development: PR42 branch contains the explicitly reviewed narrow sync function and its function privilege grant.

## Independent authorization — mandatory before any backfill

- [ ] Named reviewer **other than the PR author and execution actor**, with project authorization, has reviewed this exact SHA, source count/fingerprint, Auth0 M2M permissions, privacy controls, and expected subject-set difference.
- [ ] Reviewer separately checks the **actual target database connection/branch id** using a trusted connection, not two caller-supplied matching branch IDs.
- [ ] Reviewer confirms migration lineage, RLS/RBAC, least-privilege role and that import creates **no memberships, roles or tenant grants**.
- [ ] Reviewer confirms rollback/reconciliation approach, branch TTL, current source count/fingerprint and planned idempotent replay.
- [ ] Approval recorded as a GitHub PR review or signed release-gate comment, explicitly limited to a **new disposable Neon branch** and a fresh short-lived SHA. The repository's main ruleset requires at least one approval, but **PR merge approval alone does not authorize data import**.
- [ ] After the above, an authorized operator performs a fresh live dry-run and exact matching fingerprint, then separately authorizes apply on the verified disposable target. No Production writes.

**Independent reviewer:** PENDING (not designated or approved).

**Execution result:** real Management API read-only audit PASS; **no bulk users written**, no new membership grants, no changed Production resources.

## PEOS conclusion

**Executar → Verificar → Corrigir → Testar → Revisar → Validar → Avançar.**
Stop at the human-signoff gate. Do not treat a valid checksum as consent. Preserve PR #42 in Draft until the independent review and other release gates are completed.
