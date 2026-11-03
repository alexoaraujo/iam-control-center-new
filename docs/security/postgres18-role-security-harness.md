# PostgreSQL 18 role-security harness

Status: experimental, review-only, disposable CI evidence.

## Purpose

This harness complements migration and bootstrap proposals by testing the complete five-role attribute matrix, exact membership options, effective privilege inheritance, migrator role assumption, prohibited transitive membership, ADMIN TRUE detection, and cycle-safe graph traversal.

## Role contract

| Role | LOGIN | INHERIT | SUPERUSER | CREATEDB | CREATEROLE | REPLICATION | BYPASSRLS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| iam_owner | false | false | false | false | false | false | false |
| iam_migrator | false | false | false | false | false | false | false |
| iam_migrator_login | true | false | false | false | false | false | false |
| iam_app_runtime | false | true | false | false | false | false | false |
| iam_app_runtime_login | true | true | false | false | false | false | false |

Membership contract:
- iam_migrator_login to iam_migrator: INHERIT false, SET true, ADMIN false.
- iam_migrator to iam_owner: INHERIT false, SET true, ADMIN false.
- iam_app_runtime_login to iam_app_runtime: INHERIT true, SET false, ADMIN false.

## Assertions

- ROLE-01: complete attributes for all five roles.
- ROLE-02: exact INHERIT/SET/ADMIN options.
- ROLE-03: owner database CREATE, migrator non-inheritance, runtime inheritance.
- ROLE-04: recursive traversal detects a synthetic cycle and terminates.
- ROLE-05: runtime has no direct owner/migrator membership.
- ROLE-06: unexpected ADMIN TRUE membership is detectable.
- ROLE-07: provider-managed privileged role neon_superuser is detected transitively.
- ROLE-08/09: unexpected runtime-to-owner and runtime-to-migrator paths are detected.
- ROLE-10: migrator chain preserves session_user while current_user changes.
- ROLE-11/12/13: runtime cannot SET ROLE to owner, migrator, or runtime group.

## Execution boundary

GitHub Actions provisions only a disposable postgres:18 service container. The workflow has no Neon credentials, Auth0 integration, Vercel secrets, or access to Production, Preview, Development, or shared databases. The fixture must never be pointed at DATABASE_URL or DATABASE_MIGRATION_URL.

## Evidence rules

A passing result is local harness evidence only. Record the exact commit SHA, workflow run ID, job result, and artifact. It does not prove roles exist in Neon, a Neon connection authenticates as the expected role, TLS/pooling works, or RLS isolates tenants in a deployed environment.

Keep the pull request Draft until independent review. Do not merge or execute SQL against Neon through this proposal.
