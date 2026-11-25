# PEOS G1 — Historical child rotation proposal (PR #87)

Reconciled 2026-11-25 against main 19c265139404939814ffc59efb9c3f28016eab88. Status: HISTORICAL / NO EXECUTION AUTHORITY.

The original proposal targeted project tiny-rice-70320263, disposable br-spring-grass-b6gap6kp, with recorded expiry 2026-11-16T12:00:00Z. It proposed rotating only the child owner and synchronizing IAM_G1_DISPOSABLE_REVOKER_URL, with a separate sync-only recovery mode. That lease window has passed; current branch existence and credentials are not attested here. No rotation is required or authorized by this reconciliation.

The original script, synthetic tests and workflow remain in immutable PR history at [6fbaa9c9](https://github.com/alexoaraujo/iam-control-center-new/tree/6fbaa9c9b16c297fb5dcef5ec287884892595161). They are deliberately not introduced into the current executable tree. This avoids resurrecting an expired fixed-target administrative command and stale reviewer policy. Historical test results do not transfer to a new lease.

Current revocation contract: [disposable revoker runbook](iam-g1-disposable-branch-independent-revoker-20261115.md), .github/scripts/iam-g1-disposable-emergency-revoke.py, .github/workflows/iam-g1-disposable-emergency-revoke.yml and the corresponding synthetic contracts. Read-only Environment attestation is separate from privileged access. For a future rotation require fresh exact branch/parent/endpoint identity, TTL, SHA, segregated custody, authorization and compensating recovery; verify secret metadata without overwriting any existing value. Do not reuse Development or Production credentials. Never execute the historical command merely to recover a green check.

No Neon API reset, GitHub secret write, workflow dispatch or SQL was performed by this documentation reconciliation. Issue #32 remains subject to its own verified closure criteria.
