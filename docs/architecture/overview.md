# Architecture Overview

## Context
A multi-tenant SaaS IAM control plane. Auth0 authenticates principals; this application owns tenant membership, application roles, and resource authorization. PostgreSQL stores application state.

## Trust boundaries
1. Browser: untrusted; never authoritative for roles, tenant IDs, or permission claims.
2. Next.js server: validates session, tenant membership, resource scope, and permission.
3. Auth0: external identity provider. Management API credentials are server-only and least-privileged.
4. PostgreSQL: private network/SSL where supported; runtime role is not owner/superuser and must not bypass RLS.
5. CI/CD: short-lived or narrowly scoped credentials; production environment approval.

## Identity key
Store external identity as `(issuer, subject)` from validated OIDC claims. Email is a mutable profile attribute, not a stable key.

## Authorization sequence
1. Validate the server-side session / token according to the endpoint contract.
2. Resolve local identity by `(iss, sub)`.
3. Resolve active membership for the requested tenant.
4. Check the required permission and resource scope.
5. Apply database tenant isolation as defense in depth.
6. Emit a structured audit event for security-relevant outcomes.

## Initial technology choices
- Next.js App Router + TypeScript strict mode.
- PostgreSQL with reviewed migrations.
- Auth0 SDK for Next.js; Management SDK only for server-side admin operations.
- GitHub Actions for checks; Vercel Preview per PR.
- Modular monolith before microservices.
