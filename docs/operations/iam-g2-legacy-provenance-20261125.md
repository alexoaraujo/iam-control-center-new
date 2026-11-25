# G2 — historical migration file proof
Read-only connector checks on 2026-11-25 UTC matched one legacy ledger row,
zero rows in NEW Development. The original 4,679 bytes retrieved from GitHub
at b80c98c51746e1d49039015eb649b9bdd735ef7f matched the recorded SHA-256
2447395628fa0f1230abd95eb522e5b45d1baea1208c9c21b20346a10718fbab.
Git blob a471428ef2f8ec068fbc9b7f7590df3caed997ad. The historical commit and
current main diverge; the file is not in the current executable migration tree.
The CI fetches only the pinned historical commit as data from the public
repository, verifies commit/blob/file bytes and checks both blocked policy
manifests. No historical code is executed. No database connections or secrets.
A successful check proves file consistency, not authenticity of a live ledger,
migration execution, independent signature or adoption of a canonical baseline.
No backfill, no migration, no G3 or Production authorization.
