# IAM context security test matrix — prototype status

Scope: disposable PostgreSQL 18 harness under \`database/prototypes/iam-context/\`.
No row in this matrix is evidence from Neon, Auth0, Vercel, or Production.

| ID | Scenario | Prototype coverage | Status | Limitation / next evidence |
|---|---|---|---|---|
| SEC-01 | Context absent | \`tests/runtime-contract.sql\` expects SQLSTATE 28000 | IMPLEMENTED — test adapter | Repeat against selected production verifier |
| SEC-02 | Runtime changes context/GUC to tenant B | Deliberately not asserted as secure | BLOCKED | Deterministic registry token is replaceable; requires cryptographic binding or approved broker |
| SEC-03 | Invalid signature | No signature algorithm/verifier exists | BLOCKED | Select and implement reviewed crypto/broker contract |
| SEC-04 | Expired context | Expired fixture expects SQLSTATE 28000 | IMPLEMENTED — test adapter | Add signed expiry claim and key/version validation |
| SEC-05 | Malformed context | Not implemented | PENDING | Parser/canonicalization contract and negative vectors |
| SEC-06 | Unknown OIDC identity | Not implemented | PENDING | Auth0 issuer/subject resolution and controlled bootstrap tests |
| SEC-07 | Tenant A cannot read tenant B | Valid A fixture sees only A row | IMPLEMENTED — test adapter | Repeat with cryptographically bound context and actual runtime service |
| SEC-08 | Membership revoked | Not implemented | PENDING | Define revocation consistency and transaction semantics |
| SEC-09 | Tenant suspended | Not implemented | PENDING | Define tenant-state lookup and denial semantics |
| SEC-10 | Runtime reads verifier secret/registry | Direct registry SELECT is denied | IMPLEMENTED — test registry only | Prove production key material inaccessible to runtime and DB roles |
| SEC-11 | Runtime alters issuer/subject | Not implemented | PENDING | Signed immutable claims plus current-state authorization checks |
| SEC-12 | Runtime executes privileged function | Not implemented | PENDING | Inventory function ownership, SECURITY DEFINER search_path and EXECUTE grants |
| SEC-13 | Revocation races with concurrent write | Not implemented | PENDING | Two-session test after consistency semantics are approved |
| SEC-14 | Context survives transaction boundary | Transaction-local GUC must disappear after COMMIT | IMPLEMENTED — test adapter | Repeat with connection reuse/pooling and actual verifier |
| SEC-15 | Identity without membership enumerates tenants | Not implemented | PENDING | Query-level enumeration tests with no active membership |
| SEC-16 | Runtime role has SUPERUSER/BYPASSRLS or inherited privilege | Partial role-attribute assertion only | PARTIAL | Add recursive membership closure and effective privilege assertions |

## Interpretation

- \`IMPLEMENTED — test adapter\` means the SQL harness exercises the stated database behavior using deterministic fixture tokens. It is not a cryptographic PASS.
- \`PARTIAL\` means only the named subset is asserted; the scenario is not complete.
- \`BLOCKED\` means the current design cannot safely claim the property.
- \`PENDING\` means no executable test exists yet.

The harness runner's overall PASS, if obtained, means only that its disposable PostgreSQL 18 contract tests completed. It must not be used as approval to run \`database/migrations/0001_initial_iam_schema.sql\`, install extensions, provision Neon roles, create production policies, or grant production privileges.
