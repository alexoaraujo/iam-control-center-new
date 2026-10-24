# Security Policy

## Reporting
Do not report vulnerabilities in public issues. Use GitHub's private vulnerability reporting if enabled, or contact the repository owner through a private channel.

## Non-negotiable controls
- No secrets, access tokens, session cookies, or real user exports in Git.
- Auth0 Management API and Vercel credentials are server-only.
- Deny by default; verify authentication, active tenant membership, and permission server-side for every protected operation.
- Use `(issuer, subject)` as the external identity key; never use email as a stable identity key.
- Never grant a tenant, membership, or privileged role automatically on first login.
- Audit privileged actions without recording credentials or bearer tokens.
- Production changes require review, explicit approval, and evidence tied to the deployed commit.
- No production database migration until reviewed, tested on an isolated database, and accompanied by a rollback/recovery plan.

## Vulnerability severity
Critical/high findings block release until remediated or explicitly risk-accepted by an authorized owner with a documented expiry and compensating controls.
