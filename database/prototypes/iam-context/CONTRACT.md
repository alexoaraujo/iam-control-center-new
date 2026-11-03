# Executable tenant-context interface contract

## Interface

| Interface | Caller | Contract |
|---|---|---|
| \`ctx_lab.set_test_context(token)\` | Runtime LOGIN | Installs a transaction-local context and immediately validates it |
| \`ctx_lab.current_tenant_id()\` | RLS policy | Resolves the active tenant or raises SQLSTATE \`28000\` |
| \`ctx_lab.test_context_registry\` | Owner/test fixture only | Deterministic test adapter; never runtime-readable |

## Required semantics

1. Missing context denies access.
2. Unknown context denies access.
3. Expired or inactive context denies access.
4. RLS filters tenant-scoped rows using the validated context.
5. The context is installed with \`set_config(..., true)\`, so it is transaction-local.
6. Runtime cannot read or mutate the registry.
7. The verifier function uses a fixed search path and qualified objects.
8. Every test uses an authenticated runtime LOGIN; \`SET ROLE\` only activates its granted group role after authentication.

## Explicitly unimplemented production semantics

The prototype does not cryptographically bind issuer, subject, identity, membership, tenant, audience, issue time, expiry, token ID, or key ID. It does not validate Auth0 claims, key rotation, revocation state, replay, or concurrent membership changes. The opaque token is a fixture lookup key, not a signature.

## Security test classification

| Scenario | Prototype result | Security conclusion |
|---|---|---|
| SEC-01 absent context | Executable denial test | Harness behavior only |
| SEC-02 replace context with another tenant token | Not a security pass | BLOCKED pending cryptographic proof |
| SEC-03 invalid signature | No signature implementation | BLOCKED |
| SEC-04 expired context | Executable denial test | Test adapter only |
| SEC-07 tenant row isolation with tenant A context | Executable RLS test | Harness behavior only |
| SEC-10 runtime reads verifier registry | Executable permission-denial test | Test registry only |
| SEC-14 context after transaction | Executable cleanup test | Harness behavior only |
| SEC-05/06/08/09/11/12/13/15 | Not implemented in this prototype | PENDING |
| SEC-16 | Runtime role attributes, membership closure, and effective database/schema/table privileges | Executable assertion against disposable LOGIN/group-role fixtures | Harness behavior only |

No PASS in this document represents Neon, Auth0, Vercel, or production evidence.
