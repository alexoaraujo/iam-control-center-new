# ADR 0001: Start with a modular monolith

- Status: Accepted for MVP
- Decision: Implement a single Next.js application with explicit modules for identity, authorization, tenants, persistence, and audit.
- Rationale: Lower operational complexity and fewer trust boundaries while preserving internal contracts for future extraction.
- Consequences: Modules must not import across boundaries arbitrarily; privileged provider clients stay server-only.
