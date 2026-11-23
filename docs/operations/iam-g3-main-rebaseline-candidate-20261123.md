# G3 candidate baseline — no privilege, 23 Nov 2026

Historical PR151 merge: `6af7e9e62cbc7f6febf92e630ecf209b00b99981` (Git tree `5efd5e502d4d251f060545501c6aa94a1f154729`).
Current `main` after PR169: `fcc379f39dbe49dfb9de857e4be19f1c4da3ddbf` (Git tree `a628c48bcb212c4bedc5ac616a274f24a2e3c05f`).
GitHub compare: 111 commits ahead, 30 exact changed Git objects; 7/7 critical blobs unchanged.
Manifest fixes all SHA/mode/type/status entries, rejects extras, and denies any approval flag true.
Lease candidate Neon: `br-calm-forest-b6a1jpzs`, parent `br-muddy-bar-b63ksdy7`, expiry 2026-11-27T22:00:00Z; 0 computes last checked; not approved.
No secrets/owner URL/DB DDL/grant/revoke/Production allowed by this PR.
Trusted preflight now explicitly refuses eligibility on an unapproved candidate; after this PR merges, main SHA/tree will differ and must be reviewed anew.
Require review of full diff and exact integrated SHA, separate approved lease, OIDC protected Environment, Auth0 Preview, real RBAC A/B and rollback before any privileged G3.
Preview/security-gate and PG18 on the PR SHA are validation of this code, never grant→200/revoke→403 proof.
