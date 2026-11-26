# IAM G1 — Backblaze B2 custody reconciliation (historical incident #97)

Reconciled 2026-11-25 against main 19c265139404939814ffc59efb9c3f28016eab88. Evidence only; no settings or secret changes.

Historical run [43798649391](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/43798649391) stopped with BLOCKED_MISSING_B2_SECRETS before network access. The original PR #98 proposed bootstrap/apply/audit/run-probe modes for IAM-G1-Backup-Custody; its administrative script, synthetic tests and workflow remain in [original HEAD 4d38c0b4](https://github.com/alexoaraujo/iam-control-center-new/tree/4d38c0b4f551e2a13b26c6c103fc614756c70c65). These executable additions are not integrated: they could overwrite custody secrets and dispatch an upload under a historical policy.

## Current custody boundaries

- Synthetic probe: IAM-G1-Backup-Custody, workflow iam-g1-b2-probe.yml; synthetic readback is separate. The synthetic probe is not a full backup or recovery.
- Full writer: IAM-G1-Full-Backup-Custody, [writer contract](iam-g1-b2-full-backup-writer.md).
- Full readback: IAM-G1-B2-Full-Readback-Custody, [reader contract](iam-g1-b2-full-readback.md).
- Full restore: IAM-G1-Full-Restore-Custody, [historical restore attestation](iam-g1-b2-real-restore-attestation-45060036018.md).
- Read-only metadata attestation: iam-g1-environments-readonly-attestation.yml covers five named G1 environments including the full custody chain, not the legacy synthetic writer. Do not assert it attests the latter.

Check effective policy and existing secret names independently; names cannot attest values. Do not overwrite existing keys or change reviewers/branch restrictions to obtain a green check. Keep writer/reader permissions distinct, exact prefix, private AES escrow and approved SHA. A future synthetic probe requires its own authorization; it creates an object and is not a read-only diagnostic.

The historical restore attestation documents a limited real restore at an earlier SHA; the current run #45558018753 is separate and its result must be read directly. No new backup, readback, restore, credentials, bucket operations or issue closure are authorized or attested by this document.
