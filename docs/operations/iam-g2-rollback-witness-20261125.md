# G2 — independent retirement witness / rollback protection candidate

Status: REVIEW ONLY. Baseline PR191 merged at f61398c42697d4027facd4236eddf235d666e7de. This PR does not authorize acquisition, real storage, ACL or Production changes.

## Security decision

Primary challenge store alone cannot guarantee anti-replay after a privileged snapshot restore. Require an independently administered durable retirement witness outside the primary recovery domain. Store immutable repository/run ID (first attempt only), nonce, SHA, receipt and approval hashes, epoch and server timestamp. Authenticate the trusted consumer and verify signatures, live approvals, main SHA and endpoint before reserving. Reserve permanently and commit in witness BEFORE any primary consumption or side effect. If reservation is refused, unavailable or ambiguous, fail closed. A crash after witness commit burns the run; never retry or unburn. Any new attempt requires a fresh run with explicit approval. No runner may possess a direct primary consumer credential; only the reviewed service can enforce both stores. A compromised service or administrator remains outside this proof.

The fixture uses two separate logical databases in one disposable local PostgreSQL 18 CI cluster. It demonstrates eight concurrent contenders, one committed witness reservation, direct table write denial, epoch mismatch, replay after simulated primary owner rollback, and failure closed after a committed reservation without primary consumption. It does NOT establish independent failure domains, WORM retention, actual cross-provider availability, live GitHub approval, or actual restored snapshot integrity. The witness SQL is guarded to local fixture DB; do not run on Neon. Epoch value is synthetic. No live service or deployment workflow is included.

## Live prerequisites (separate reviewed authorization)

- Select a free-tier durable witness with atomic create-if-absent and permanent run retirement across epochs; prove independently recoverable failure domain from primary. No existing G1 custody credential reuse.
- Pin witness identity, epoch, public signer, SHA and repository; authenticate trusted service using scoped credentials/OIDC where available. Do not expose direct consume privilege to runners.
- Audit every retirement; preserve all retired run IDs across recovery. Never restore the witness to an earlier state or reset it. If witness loss or rollback cannot be ruled out, freeze all operations, retire all pre-recovery runs/challenges and require a new separately approved recovery epoch with independently verified monotonic anchor. Do not treat an epoch string alone as proof of monotonicity.
- Validate server clock, nonce, actual Environment approvals, receipt freshness, identity, TLS, encrypted output, and response ambiguity. Enforce operational approval separately.
- Verify actual Environments main-only, no admin bypass, explicit sole-maintainer review and segregated reader; no ADMIN token in CI. Keep activation_authorized=false until all gates complete.

No migration, ledger, live database, secret or Environment change. No secondary human account.
