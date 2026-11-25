# CODEOWNERS and review routing — PEOS

Status: PROPOSED / routing only, not a change to rulesets or operational authorization.

Historical proposal: PR #46, HEAD 44b2b164a10b4f7c2061c6f07d065f06c4040c73. On 2026-11-25 the repository collaborator readback confirmed @alexoaraujo=admin and @alexoaraujo83=write. The proposed CODEOWNERS routes sensitive files to the latter account; it does not establish independent human identity or mandatory review.

## Current baseline

At main 19c265139404939814ffc59efb9c3f28016eab88, the active protect-main ruleset #27506312 requires PRs, resolved threads, strict quality and security-gate checks, stale-review dismissal and protection from deletion/non-fast-forward updates. It has zero required human approvals, require_code_owner_review=false, and no bypass actors. The disabled hardened ruleset #27234161 is not to be activated by this proposal. See [single-maintainer governance](peos-single-maintainer-governance.md).

CODEOWNERS is review routing, not an exception to mandatory CI. Changes to ownership files remain security-sensitive and require the current exact-SHA Preview/Auth0 and PG18 contracts when applicable. Do not reclassify them as documentation to obtain a pass. Preserve reviews and leases as historical evidence; new SHA requires new validation.

No change to rulesets, Environment protection, credentials, Neon, Auth0, Vercel or Production is authorized. Any separate decision to enforce mandatory CODEOWNER reviews must be reviewed against current governance and tested without a protection gap. Related: #11 and #34.
