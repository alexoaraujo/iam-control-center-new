# IAM identity and authorization context contract (review draft)

Status: **PROPOSAL — NOT APPROVED FOR PRODUCTION**  
Scope: design contract for the application-to-PostgreSQL tenant authorization context. This document does not select a cryptographic mechanism and does not authorize a Neon migration, role change, grant, secret change, or Production operation.

## 1. Purpose and trust boundaries

The application authenticates users through the configured Auth0 OIDC tenant. Auth0 is the identity provider (IdP); Neon Auth is not part of this design.

The application must convert a validated Auth0 identity and current IAM authorization state into a database-verifiable, tenant-scoped authorization context. PostgreSQL RLS is the final row-access enforcement boundary, not a substitute for validating the IdP token or checking current membership and permissions.

Trust boundaries:

1. Auth0 issues an OIDC identity token and, where applicable, an API access token.
2. The application backend validates the access token for the intended API and resolves the immutable identity key.
3. The IAM authorization service resolves the requested tenant, active membership, tenant state, roles, and effective permissions from authoritative IAM records.
4. A separately trusted context issuer/verifier boundary produces or validates the database context. Its cryptographic or broker implementation remains undecided.
5. PostgreSQL validates the context for the active transaction and enforces RLS using the verified tenant identifier.
6. The browser and end user are untrusted. They must not be able to choose or modify a tenant context, issuer, subject, membership, permission set, or database token.

No user-supplied header, query parameter, cookie field, ordinary GUC, or client-controlled claim may independently establish database authorization.

## 2. Canonical identity contract

| Field | Proposed contract | State |
|---|---|---|
| OIDC issuer (iss) | Exact configured Auth0 issuer URL; validate exact match, including scheme and trailing-slash semantics | Required; configuration value pending verification |
| OIDC subject (sub) | Treat as opaque, case-sensitive identifier; never parse provider-specific structure or use email as identity key | Required |
| Identity key | Internal immutable IAM identity ID mapped uniquely to (issuer, subject) | Required; schema mapping must be reviewed |
| Email / display name | Profile attributes only; never primary identity or authorization keys | Required constraint |
| Authentication time (auth_time) | Preserve only when needed by a policy; do not treat it as authorization freshness | Conditional |
| Token audience (aud) | Must include the exact IAM API audience configured in Auth0; reject tokens for another API | Required |
| Token algorithm | Explicit allowlist; reject none, algorithm confusion, and unexpected algorithms | Required; exact algorithm/configuration to verify |
| Token lifetime | Validate iat, nbf when present/required, and exp; enforce bounded clock tolerance | Required |

The backend must validate signature, issuer, audience, expiry, not-before, and allowed algorithm using Auth0's trusted signing metadata. The database context must not blindly copy claims from an unvalidated JWT.

## 3. Tenant and membership authorization

A tenant is an internal canonical IAM entity. A client-provided tenant slug or ID is only a request to select a tenant; it is not proof of access.

For every tenant-scoped request, authorization resolution must:

1. Resolve the authenticated (issuer, subject) to exactly one internal identity.
2. Resolve the requested tenant to one canonical internal tenant ID.
3. Find the identity's membership in that tenant.
4. Require membership status active at the authorization decision point.
5. Require tenant status active.
6. Resolve roles and effective permissions from authoritative IAM relations.
7. Deny if identity, tenant, membership, or authorization state is missing, ambiguous, disabled, suspended, expired, or inconsistent.
8. Avoid tenant enumeration: an identity without an active membership must not discover tenant records through list, search, error, or timing behavior.

The context must bind the internal identity ID, tenant ID, and membership ID together. A membership ID must not be accepted unless it belongs to that identity and tenant.

## 4. Effective permissions

- Permissions are canonical server-side identifiers, not free-form client strings.
- Effective permissions are derived from active membership assignments and the approved role-permission graph.
- The backend must not accept a permission list supplied by the browser as authoritative.
- The context should carry either a bounded permission snapshot or a reference/version that PostgreSQL can validate. The choice is pending.
- Sensitive operations must perform an authoritative permission check at the service boundary and, where applicable, a database-side check.
- RLS tenant isolation and application-level permission authorization are separate controls; tenant membership alone does not imply every permission.
- Permission changes and role changes must have defined freshness/revocation semantics before implementation.

## 5. Database context envelope — required bindings

The eventual trusted context must bind, at minimum:

| Claim / attribute | Required meaning |
|---|---|
| iss | Trusted context issuer, distinct from merely copying the Auth0 issuer |
| sub | Auth0 subject or immutable internal identity reference, with unambiguous mapping |
| identity_id | Canonical internal IAM identity |
| tenant_id | Canonical tenant authorized for this transaction |
| membership_id | Active membership linking identity and tenant |
| permissions or authorization version | Approved effective permission representation |
| aud | Exact database-context verifier audience / intended consumer |
| iat | Context issue time |
| nbf | Optional not-before time if the selected format supports it |
| exp | Short, bounded context expiry |
| jti | Unique context identifier if replay detection / revocation uses it |
| kid | Key identifier when a key-based format is selected |
| version | Context schema/version for controlled evolution |

The context issuer must be trusted independently of the application request payload. The verifier must reject malformed, ambiguous, expired, not-yet-valid, wrong-audience, unknown-version, and untrusted-issuer contexts.

The format, signing algorithm, key custody, signing service, and whether a broker is used are not decided.

## 6. Freshness, revocation, replay, and concurrency

Before implementation, the design review must choose and document:

- Maximum context lifetime and permitted clock skew.
- Whether revocation is immediate, bounded by context TTL, or enforced through an authorization-version/state lookup.
- How membership revocation, tenant suspension, identity disablement, and permission removal affect already-issued contexts.
- Whether jti values are stored, cached, or otherwise checked for replay/revocation; define retention and cleanup.
- Whether a transaction revalidates authorization state after a context has been installed.
- The serialization/locking or version-check strategy for a revocation racing with a protected write.
- Behavior when the authorization-state service or verifier is unavailable: fail closed.
- Key rotation, overlap, retirement, compromise response, and unknown kid behavior if a key-based design is selected.

A valid signature proves issuer integrity, not that a membership remains active. Current authorization state and token authenticity are separate checks.

## 7. PostgreSQL verifier and RLS interface

The production database interface must provide semantics equivalent to:

- A trusted verifier that accepts only the selected context representation.
- A transaction-local context installation operation.
- A tenant resolver that returns the verified canonical tenant ID or raises an authorization error.
- Optional identity, membership, and permission resolvers needed by database policies.
- RLS policies that fail closed when no verified context exists.
- No direct runtime read access to signing keys, private key material, context registries, or verifier internals.
- Fixed search_path, schema-qualified object references, minimal EXECUTE grants, and reviewed ownership for every SECURITY DEFINER function.
- No runtime ability to bypass RLS, assume owner/migrator roles, or change protected verifier state.

The current ctx_lab prototype is only a deterministic test adapter. Its replaceable token lookup must not be promoted or copied into production. The prototype does not implement any production verifier API.

### Transaction and connection-pool requirements

- Context must be bound to one database transaction, not a persistent pooled connection.
- Context must be cleared automatically at transaction end.
- Every request must begin with no inherited tenant context.
- A pooled connection reused by another request must not retain prior identity, tenant, membership, or permissions.
- Application code must not perform protected queries outside the transaction carrying the verified context.
- Tests must cover commit, rollback, exceptions, cancellation, and connection reuse.

## 8. Failure contract

The verifier and authorization path must fail closed for:

- Missing, malformed, ambiguous, expired, or not-yet-valid context.
- Invalid signature or untrusted issuer, where cryptographic verification is selected.
- Wrong audience, unknown context version, unknown or retired key identifier.
- Unknown identity, unknown tenant, absent or inactive membership.
- Suspended tenant, disabled identity, revoked membership.
- Missing required permission or stale authorization version.
- Replay/revocation check failure where that check is part of the approved design.
- Database verifier, authorization-state, or key-discovery dependency failure.

Externally visible errors should avoid disclosing whether a tenant or identity exists when the caller is not authorized to know that fact. Internal audit events may record a stable denial reason without logging bearer tokens or secret material.

## 9. Audit and observability

Audit events for authorization decisions should capture, subject to data minimization:

- event timestamp;
- internal identity, tenant, and membership identifiers when known;
- action/resource and decision (allow/deny);
- stable denial category;
- context version and non-secret key identifier when applicable;
- request/correlation identifier;
- authorization version or policy revision where available.

Never log raw access tokens, signed context tokens, private keys, database URLs, passwords, or secret values. Audit records must be append-only under the approved database ownership and privilege model.

## 10. Required verification plan

| Test group | Minimum acceptance evidence | Current status |
|---|---|---|
| Auth0 token validation | Positive and negative issuer, audience, signature, algorithm, expiry, and not-before vectors | PENDING |
| Identity mapping | Exact issuer/subject mapping; unknown and duplicate mapping denial | PENDING |
| Tenant membership | Active, absent, revoked, expired, and cross-tenant membership cases | PENDING |
| Tenant state | Active versus suspended tenant | PENDING |
| Permissions | Positive and negative role/permission resolution; stale permission version | PENDING |
| Context integrity | Tamper, substitution, wrong audience, malformed payload, unknown version | BLOCKED pending mechanism decision |
| Expiry and replay | Expired, future-issued, duplicate/replayed, revoked context | PENDING |
| Key lifecycle | Rotation overlap, unknown/retired key, compromised key response | BLOCKED pending key-based mechanism decision |
| RLS | Tenant A cannot read/write tenant B; absent context denies | Prototype-only coverage exists; production PENDING |
| Runtime privileges | Real authenticated runtime LOGIN, role membership closure, effective privileges, no BYPASSRLS | Disposable fixture only; real Neon PENDING |
| Revocation race | Two-session membership revocation versus protected write | PENDING |
| Pooling | Reuse after commit/rollback/error/cancellation cannot leak context | PENDING |
| Failure mode | Verifier/state dependency outage denies protected operation | PENDING |
| Audit | Denial/allow events are attributable and contain no secrets | PENDING |

The existing PostgreSQL 18 harness provides disposable-fixture evidence only for its documented SEC cases. It does not satisfy the Auth0, cryptographic, Neon, pooling, or production rows above.

## 11. Architecture decisions — explicitly open

No mechanism is selected by this document.

| Decision | Options under evaluation | Required decision owner / evidence |
|---|---|---|
| Context authenticity | Asymmetric signed context; trusted broker; other reviewed mechanism | Security architecture review, threat model, key custody and operational proof |
| Permission representation | Signed bounded snapshot; authorization version plus DB lookup; hybrid | Consistency analysis and query/latency tests |
| Revocation semantics | Short TTL; state/version check; revocation registry; hybrid | Explicit freshness SLO and race tests |
| Replay control | jti registry/cache; one-time exchange; bounded replay window | Threat model and concurrency/retention tests |
| Signing-key custody | Dedicated issuer service / managed key boundary | Free-tier feasibility and isolation evidence; no private key in browser or ordinary runtime env |
| Database verifier placement | PostgreSQL verifier; trusted application/broker exchange; hybrid | Least-privilege analysis and Neon compatibility proof |

HMAC, asymmetric JWT, and broker designs remain candidates only. No choice may be inferred from the CI harness or this proposal.

## 12. Promotion gates

Do not move this proposal into production code or database/migrations/ until all of the following are recorded:

1. Human approval of the identity, tenant, membership, permission, freshness, revocation, and replay contracts.
2. Selection and review of the context authenticity mechanism and key/broker custody.
3. A documented threat model and negative test vectors.
4. Executable tests using authenticated application runtime LOGIN sessions, not only SET ROLE under an administrative session.
5. Demonstrated RLS isolation, no tenant enumeration, and revocation-race behavior.
6. Demonstrated pool/transaction cleanup and fail-closed dependency behavior.
7. Verified Neon role ownership, memberships, attributes, and effective privileges using approved read-only evidence before any migration proposal is considered executable.
8. Separate explicit authorization for any Neon role/grant/migration operation.
9. CI and Preview evidence attached to the exact reviewed commit SHA.
10. Human review and explicit approval before merge or any Production action.

## 13. Current project boundary

- Auth0 remains the identity provider.
- Neon Auth remains out of scope and disabled.
- The database/prototypes/iam-context/ harness remains CI/local disposable-only.
- No production context mechanism is approved.
- No Neon migration, role, grant, policy, secret, Auth0 setting, Vercel setting, or Production deployment is authorized by this document.
- PR #57 remains a separate Draft migration proposal and must not be modified by this prototype work.
