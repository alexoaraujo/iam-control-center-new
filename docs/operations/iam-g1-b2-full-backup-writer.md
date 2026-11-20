# G1 — full PostgreSQL 18 encrypted backup writer

**Status:** writer implementation and offline tests in isolated PR only. **No full real encrypted backup, independent readback, restore or rollback from this backup has been executed.**

## Exact scope

- Repo: `alexoaraujo/iam-control-center-new`; GitHub Actions manual dispatch allowed **only from main** at the exact approved SHA.
- Source: Neon project `tiny-rice-70320263`, Development branch `br-ancient-term-b6mmx5ol`, direct host `ep-winter-leaf-b6cp8d2c.c-2.sa-east-1.aws.neon.tech`, database `iam_database`, PostgreSQL 18.
- Destination for future independent restoration: `br-sweet-union-b6j80a7j` database `iam_canonical_validation` only, originally expiring `2026-11-22T09:12:00Z`. The writer does not access or modify this destination. Its 24-hour recovery headroom is an enforced hard stop. Production is untouched.
- The writer uses PG18 custom `pg_dump -Fc` streamed into AES-256-GCM without saving a plaintext archive. A locally temporary encrypted file (permission 0600) is deleted on exit. No plaintext, secret key, database URL, row data, decrypted data, or backup file is uploaded as a CI artifact.
- Before any upload the code calls Backblaze Native v4 `b2_authorize_account` to verify one exact bucket `iam-control-center-g1-backups`, prefix `iam-g1/full-backups/`, and limited capabilities `writeFiles` with optional `listBuckets`; it rejects `readFiles`, `deleteFiles` and administrative capabilities.
- **Caution:** B2 `writeFiles` can also permit certain S3 delete-by-name operations. This is not proof of object immutability. Independently verify retention/versioning and segregated custody.

## GitHub custody configuration

Create the protected Environment [IAM-G1-Full-Backup-Custody](https://github.com/alexoaraujo/iam-control-center-new/settings/environments). It must have exactly one approved branch policy `main`, admin bypass off, and no unexpected protection rules. Solo-maintainer policy may omit a human reviewer; do not claim independent human approval if absent.

Environment **secrets** (never put their values in chats, issues or workflow inputs):

| Secret | Required meaning |
| --- | --- |
| `IAM_G1_FULL_BACKUP_SOURCE_URL` | Exclusive Development `neondb_owner` URL with exact pinned host, database `iam_database`, `sslmode=verify-full&sslrootcert=system`, direct/unpooled; not Production |
| `IAM_G1_AES256_GCM_KEY_B64` | Base64 of precisely 32 random bytes, **privately escrowed outside GitHub before running** |
| `IAM_G1_B2_FULL_WRITER_ACCESS_KEY_ID` | Fresh B2 Application Key ID restricted to the full-backup bucket/prefix |
| `IAM_G1_B2_FULL_WRITER_SECRET_ACCESS_KEY` | Matching fresh restricted B2 key secret |

Environment **variables**:

| Variable | Exact value |
| --- | --- |
| `IAM_G1_FULL_BACKUP_APPROVED_SHA` | Approved exact 40-hex `main` SHA at time of run |
| `IAM_G1_ENCRYPTION_KEY_ESCROW_ATTESTATION` | `PRIVATE_ESCROW_CONFIRMED`, only when private offline escrow really exists |

The workflow itself pins non-secret B2 endpoint `https://s3.us-east-005.backblazeb2.com`, region `us-east-005`, bucket and object prefix. Previously exposed B2 keys must not be reused; revoke and replace them in the protected Environment. Do not create a fresh encryption key on a temporary runner without secure independent escrow, or the ciphertext may become unrecoverable.

## B2 writer fail-fast remediation

The protected backup job now authenticates the Backblaze writer key via the Native v4 API **before building the PostgreSQL 18 container**. A failing key emits a fixed error and stops without accessing PostgreSQL or uploading any file. The complete protected export path rechecks the key as defense in depth. An offline preflight success is **not** a backup.

For `BLOCKED_G1_WRITER_NATIVE_OVERPRIVILEGED`, provision a **new** restricted application key, after resolving any Backblaze account suspension or billing restriction:

- Bucket: `iam-control-center-g1-backups` only.
- Exact name prefix: `iam-g1/full-backups/`.
- Capabilities: `writeFiles` and, only if required, `listBuckets`. Do **not** include `readFiles`, `deleteFiles`, `listAllBucketNames`, bucket administration, or file retention management.
- Store the paired values in `IAM_G1_B2_FULL_WRITER_ACCESS_KEY_ID` and `IAM_G1_B2_FULL_WRITER_SECRET_ACCESS_KEY` **only** under `IAM-G1-Full-Backup-Custody`. Revoke any previously exposed keys, and do not paste them into PRs or logs.

Backblaze documents that `writeFiles` can support some delete-by-name S3 operations; therefore this restricted writer is still not WORM and does not replace separate object-lock, versioning or independent readback controls. If the B2 account is suspended, rotating keys alone cannot restore service. Resolve the account restriction with the provider; keep this gate blocked until an authorized real readback proves the object.

## Safe workflow modes

[Manual workflow](https://github.com/alexoaraujo/iam-control-center-new/actions/workflows/iam-g1-b2-full-backup-writer.yml)

- `operation=preflight_only` and `confirmation=NO_BACKUP`: regression checks and read-only Environment metadata check. No database credentials, B2 or SQL operations.
- `operation=backup_full` and `confirmation=EXPORT_ENCRYPT_UPLOAD_G1_FULL_BACKUP`: full-data backup only if protected environment, matching main SHA, pinned source TLS, 24h isolated target TTL, confirmed external key escrow, new scoped B2 uploader key and 256-bit AES key pass. The protected job repeats all checks before PG18/B2.

A successful operation produces `pg_dump --format=custom --no-password --serializable-deferrable` with TABLE DATA, all source schemas, RLS policies and catalog definitions. It does not include PostgreSQL **global roles/passwords** (which need a separate reviewed, sanitized globals export).

Encrypted file format: 8-byte magic ASCII `IAMG1A1!`, 12-byte random GCM nonce, AES-256-GCM ciphertext, 16-byte GCM authentication tag. AEAD authenticated associated data is magic concatenated with the exact 40-hex producing Git SHA (ASCII). Authenticating the GCM tag **before any restore/DDL** is mandatory.

Object path: `iam-g1/full-backups/<approved-main-sha>/<YYYYMMDDThhmmssZ>-<run-id>.pgdump.aesgcm`. Object metadata: `sha256`, `classification=iam-g1-full-backup-encrypted`, `pg-version=18`, `archive-format=pg-dump-custom`, `cipher=aes256gcm`. Writer outputs only a non-secret manifest: SHA, GitHub run ID, object key, ciphertext SHA256 and bytes. Its provenance must be independently verified against the actual authenticated GitHub run; a writer's self-reported metadata alone does **not** establish independent custody.

## Recovery sequence still required

1. Use a **different B2 reader key** restricted to the same full-backup bucket/prefix in the [independent B2 readback workflow](https://github.com/alexoaraujo/iam-control-center-new/actions/workflows/iam-g1-b2-full-readback.yml). Transfer exact SHA, ciphertext digest, length, and key from the independently verified writer manifest into the readback Environment; verify S3 scope, hash and metadata. No decryption occurs here.
2. Build a **separate reviewed restore runner** for PostgreSQL 18 that verifies SHA256 and GCM authentication **before any DDL**. Restore exclusively to `iam_canonical_validation` in the disposable Neon branch with an exact database and TLS guard; never touch its inherited `iam_database`.
3. Compare 23 table counts, 41 policies, 20 FORCE RLS and roles/owners/ACLs, confirm pgcrypto, tenant RLS and deny-by-default, and run an actual full-restore rollback drill. The prior native Neon clone plus transaction savepoint does not prove restoration from a B2 archive.
4. Record real run IDs, timestamps, branch IDs, manifest, readback and restore evidence in [Issue #15](https://github.com/alexoaraujo/iam-control-center-new/issues/15).

**Boundaries:** `G1_FULL_BACKUP_RESTORE=NOT_ATTESTED` and `PRODUCTION_CUTOVER=BLOCKED` until all real gates pass. A green offline test or an uploaded ciphertext cannot be called a restored database.
