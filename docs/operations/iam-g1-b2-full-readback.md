# IAM G1 — B2 full-backup ciphertext independent readback (not a restore)

**Status (2026-11-19 UTC):** implemented as a manual, fail-closed read-only workflow; **NO real backup exists in verified evidence, no real full-backup readback has run**, and no decryption or isolated restore is attested. This must never be called a completed G1 recovery.

## Why this exists

The existing [synthetic B2 readback](iam-g1-b2-readback.md) validates only the fixed object at `iam-g1/probes/20261117T002204Z-43987013885.aesgcm` (126 ciphertext bytes, verified GitHub run #44504075979 attempt 2). The planned full backups live at **`iam-g1/full-backups/`** and must have a **different application key restricted to that prefix**. The synthetic reader and its ciphertext cannot prove a full database restore.

## Pre-deployment custody setup (human-only, secrets never in a chat)

1. Create **`IAM-G1-B2-Full-Readback-Custody`** GitHub Actions Environment manually before triggering this workflow. Branch policy: **exactly `main`**, without wildcard. Admin bypass disabled. Reviewer policy may be solo where the Free plan and project allow it; the workflow then prints `NOT_ATTESTED_G1_INDEPENDENT_HUMAN_REVIEW` and does not claim human independence.
2. Create a **new**, bucket-limited, **read-only** B2 standard application key whose `namePrefix` is exactly **`iam-g1/full-backups/`** (capability `readFiles`; allow only the minimum extra capability documented as needed by the specific SDK). This key MUST NOT be the writer key or the existing synthetic probe reader, and MUST NOT include `writeFiles`, `deleteFiles`, or B2 bucket administration privileges. Revoke/rotate any key whose secret value was exposed in a conversation or other public record before relying on it operationally.
3. Store key material only as GitHub **Environment secrets**: `IAM_G1_B2_FULL_READ_ACCESS_KEY_ID` and `IAM_G1_B2_FULL_READ_SECRET_ACCESS_KEY`. Neither script nor PR reads the values. The code uses them only in the protected manual job.
4. After an **authorized** full `pg_dump -Fc` has been encrypted with a separately escrowed AES-GCM key **before upload** and placed in B2, independently validate the writer's protected manifest. Format and required S3 metadata:
   - Key: `iam-g1/full-backups/<40-hex-approved-main-sha>/<YYYYMMDDThhmmssZ>-<run-id>.pgdump.aesgcm`.
   - Object MIME `application/octet-stream`; metadata: `sha256=<SHA256-of-ciphertext>`, `classification=iam-g1-full-backup-encrypted`, `pg-version=18`, `archive-format=pg-dump-custom`, `cipher=aes256gcm`.
   - Exact ciphertext byte count and expected digest must come from the separately reviewed **writer manifest**, not untrusted object metadata alone.
5. Configure these **Environment variables** from that reviewed manifest: `IAM_G1_B2_FULL_READBACK_APPROVED_GIT_SHA` (must match current `main`), `IAM_G1_B2_FULL_READBACK_APPROVED_OBJECT_KEY`, `IAM_G1_B2_FULL_READBACK_APPROVED_SHA256`, `IAM_G1_B2_FULL_READBACK_APPROVED_SIZE_BYTES`. Do not place AES decryption or PostgreSQL connection credentials in this Environment.
6. Dispatch [IAM G1 B2 full ciphertext readback](https://github.com/alexoaraujo/iam-control-center-new/actions/workflows/iam-g1-b2-full-readback.yml) **manually on `main`**. The first job verifies real GitHub Environment metadata without B2 secrets. If the Environment does not exist or is not restricted to `main`, it fails before any protected job. The protected job repeats the metadata check before B2 access.
7. The B2 reader must receive an `AccessDenied` or equivalent **403** to a metadata-only `HEAD` of the known synthetic probe. A successful probe HEAD proves the key is over-broad and fails the gate. `404`/not found is **not** accepted as scope proof.
8. The reader only fetches the **one** approved ciphertext object. It checks SHA-256, exact length (bounded to 2 GiB), classification, archive/encryption metadata, and streams data without writing it, logging bytes or decrypting it. If all checks pass, it emits `PASS_G1_B2_FULL_CIPHERTEXT_INDEPENDENT_READBACK_SHA256` and **still prints** `G1_DECRYPTION=NOT_TESTED`, `G1_RESTORE=NOT_TESTED`, `G1_FULL_BACKUP_RESTORE=NOT_ATTESTED`.

## PR #138 — Preview identity sequencing, 2026-11-19 UTC

The initial commit `991b6c1f788f6cd9491881e62e08fe885cd97c30` was deployed before PR #138 existed. In [CI #44539884464](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44539884464), the Vercel alias, callback branch and OIDC steps succeeded but the `verify-preview-alias.mjs` check **failed closed** because the deployment-origin identity did not attest the expected PR number. The real Auth0 E2E therefore did **not** run, and `security-gate` cannot report success. No identity check will be bypassed.

This documentation update is intentionally committed after PR #138 creation to trigger a **new, exact-SHA Vercel Preview deployment** carrying GitHub PR metadata. Require a new `quality`, `auth0-e2e` and `security-gate` PASS on the new HEAD before a merge.

## Non-negotiable boundaries

- This workflow performs **no** Neon SQL, PostgreSQL connection, dump, DDL, upload, backup creation, AES decryption, rollback, Production promotion or cutover.
- The key and digest variables alone are **not proof of an independent writer manifest or immutable object retention**. Ensure custody, write-only key rotation, retention/immutability, external escrow and authentic manifest provenance under separate operational approvals.
- A future *different* process must verify `pg_restore --list`, decrypt using escrowed keys in a private runner, restore exclusively into `iam_canonical_validation` on `br-sweet-union-b6j80a7j` before its TTL and validate PostgreSQL 18, policies, owners, data and rollback. Never touch the clone's inherited `iam_database` or Neon Production.
- Until real evidence is available, status is `B2_FULL_BACKUP_READBACK=NOT_EXECUTED`, `G1_FULL_BACKUP_RESTORE=NOT_ATTESTED`.

Related: [G1 recovery preflight](iam-g1-full-recovery-staging-20261118.md), [Issue #15](https://github.com/alexoaraujo/iam-control-center-new/issues/15).
