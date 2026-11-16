# IAM-G1 — Backblaze B2 environment reconciliation

**Scope:** `alexoaraujo/iam-control-center-new` · `IAM-G1-Backup-Custody` · issue #97.
No Neon operations. Never put Backblaze credentials in pull requests, source code, issues, CI logs, or this document.

## Why the probe failed

GitHub Actions run [43798649391](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/43798649391) stopped before network access with `BLOCKED_MISSING_B2_SECRETS`. At least one of the two expected secrets was unavailable to the job. Workflow `iam-g1-b2-probe.yml` resolves **environment secrets** under the exact name `IAM-G1-Backup-Custody`.

## Secure administrative repair

Use a **trusted, interactive terminal** with `gh`, `jq`, and a GitHub account authorized to administer this repository. Authenticate with `gh auth login` if needed. Do not use an arbitrary CI runner to enter secrets.

1. Run `bash scripts/iam-g1-b2-environment.sh bootstrap`. If the environment does not exist, this only creates an environment with a custom deployment branch policy restricted to `main`. It **does not add secrets or reviewers**. Existing environment settings are preserved.
2. Open [GitHub Environments](https://github.com/alexoaraujo/iam-control-center-new/settings/environments) → **IAM-G1-Backup-Custody**. Require a genuinely independent reviewer and enable **Prevent self-review**, where supported. Keep the deployment branch restriction to **only `main`**. Do not assume the author of a previous PR is an independent backup custodian.
3. Run `bash scripts/iam-g1-b2-environment.sh apply`. It **refuses** to write secrets unless the main-only and reviewer protections pass. It upserts these Environment variables:
   - `IAM_G1_B2_BUCKET=iam-control-center-g1-backups`
   - `IAM_G1_B2_ENDPOINT=https://s3.us-east-005.backblazeb2.com`
   - `IAM_G1_B2_REGION=us-east-005`
4. The script prompts privately for the *existing* Backblaze **keyID** and **applicationKey**, setting **Environment secrets** `IAM_G1_B2_ACCESS_KEY_ID` and `IAM_G1_B2_SECRET_ACCESS_KEY`. Secret values are sent to `gh secret set` through stdin; nothing is committed or logged. If the applicationKey is lost, create a replacement in Backblaze and revoke the obsolete key.
5. Run `bash scripts/iam-g1-b2-environment.sh audit`. It verifies restrictions, secret **names** (not values), and variable values. An audit cannot prove that Backblaze credentials are valid.
6. Run `bash scripts/iam-g1-b2-environment.sh run-probe` to dispatch the synthetic encrypted upload workflow from `main`. Independently approve the protected job and inspect the resulting GitHub Actions run. Success requires `PASS_B2_ENCRYPTED_SYNTHETIC_UPLOAD`; invalid credentials or bucket grants may produce an S3 error even when secrets are present.

## Guardrails and evidence

- Do not copy a repository secret into an environment by assuming its hidden value can be retrieved: GitHub secret values are write-only.
- The existing environment must not be relaxed for the sake of passing a probe.
- A successful upload does not prove readback, object integrity after retrieval, private key custody, retention policy, isolated restore, or rollback.
- Backup, restore, Neon branch mutations, and `G1_FULL_BACKUP_OWNER_APPROVED` remain **BLOCKED** until their independent gates pass.
- Record only the run URL, SHA, status, ciphertext checksum, and reviewer approval in issue #97; **never** record credentials.
