# Documentação técnica — IAM Control Center

Documentação de referência para Next.js + TypeScript, Auth0, Neon PostgreSQL, GitHub Actions e Vercel, mantendo somente planos Free/Hobby.

## Começar

- [Auditoria integral do repositório — 2026-11-07](evidence/repository-audit-2026-11-07.md)

- [Visão geral da arquitetura](architecture/overview.md)
- [Política de planos Free e limites](operations/free-plan-policy.md)
- [Evidências de validação e bloqueios](evidence/validation-2026-10-31.md)

## Instalação e identidade

- [Auth0 Free com Next.js 16](auth/auth0-free-nextjs16.md)
- [Auth0 SDK e migração v4](../apps/web/src/lib/auth0.ts)
- [Proxy Next.js 16](../apps/web/src/proxy.ts)

## Banco de dados

- [Neon Free: integração, pooling, migrations e RLS](database/neon-free-nextjs.md)
- [Migrations e critérios de segurança](../database/migrations/README.md)
- [Contratos IAM](architecture/iam-contracts.md)
- [RFC de contexto confiável de tenant](architecture/tenant-context-rfc.md)

## Operação e segurança

- [Política Free](operations/free-plan-policy.md)
- [Evidências e matriz de aceitação](evidence/validation-2026-10-31.md)
- [Política de evidências](evidence/policy.md)

## Regra de promoção

CI aprovado não equivale a autenticação E2E, isolamento RLS ou autorização de release. Não mesclar nem promover Production enquanto houver requisito PENDENTE/BLOQUEADO. Vercel Hobby é elegível somente para uso pessoal e não comercial.
