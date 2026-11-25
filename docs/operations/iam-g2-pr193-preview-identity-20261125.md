# PR #193 — exact-SHA Preview identity reconciliation

2026-11-25 UTC. Historical evidence, not operational approval.

- Original PR HEAD: `52675d659b93904a9c06de030831ab3d3802832e`.
- Preview deployment: `dpl_Hq5c7Bdvev2QxLxhw1J4DppcUwkn`, created `2026-11-25T10:39:37.295Z`.
- GitHub PR #193 created `2026-11-25T10:39:52Z`, after that deployment.
- CI run [45597145882](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/45597145882): auth0-e2e rejected `Missing or wrong PR number on Preview origin 1`; security-gate blocked `AUTH0_E2E_NOT_SUCCESS`.
- Vercel metadata matches original commit and branch but does not establish the expected PR identity. The creation order is consistent with the earlier documented PR150 incident; the actual runtime PR number was not disclosed by the failing verifier.

This documentation-only change requests a fresh native Git-linked Preview for the new PR HEAD after PR creation. Verify the new exact SHA, repository, branch, Preview environment, PR number 193, identical immutable deployment identity for both origins, real Auth0 E2E, and all required checks before any merge. Do not substitute or inject PR identity, weaken the verifier, reuse the prior SHA approval, or bypass protection.

G2 custody remains fixture-only. No live acquisition, B2 bucket or key creation, reservation tag creation, retention changes, Neon writes, Production promotion, or provider attestation is authorized by this note. GitHub + Backblaze B2 + Neon PG18 only; no secondary account, paid provisioning or R2. Required provider, policy, retention and approval verification remains outstanding.
