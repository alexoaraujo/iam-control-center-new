# IAM migration 0001 — revisão humana e gates

Status: **aguardando revisão; nenhuma execução autorizada**.

## Revisão do contrato

- [ ] Aprovar IAM-DC01 a IAM-DC09 em `docs/architecture/iam-decisions.md`.
- [ ] Confirmar que email não é chave de identidade/autorização.
- [ ] Confirmar slug opcional e política de ciclo de vida.
- [ ] Confirmar estados de tenant e membership.
- [ ] Confirmar FKs compostas e escopo tenant-scoped.
- [ ] Aprovar auditoria sem IP/User-Agent e definir retenção em decisão posterior.

## Revisão de segurança PostgreSQL

- [ ] Aprovar baseline RLS default-deny sem policies.
- [ ] Aprovar ownership de schemas/tabelas por `iam_owner`.
- [ ] Definir e provar caminho de assunção de role do migrator para `iam_owner`.
- [ ] Confirmar `iam_owner`, `iam_migrator`, `iam_app_runtime` NOLOGIN/NOBYPASSRLS.
- [ ] Escolher mecanismo de contexto confiável; GUC simples permanece rejeitado como fronteira.
- [ ] Revisar policies `USING`/`WITH CHECK` e grants em PR separado antes de habilitar acesso funcional.
- [ ] Confirmar que runtime não administra catálogo, roles, memberships/role assignments ou ledger.

## Evidência automatizada

- [ ] CI PostgreSQL 18 descartável passou no SHA do PR.
- [ ] Teste de FK composta cross-tenant passou.
- [ ] Teste de RLS default-deny passou com role runtime.
- [ ] Checksum SHA-256 da migration registrado.
- [ ] Nenhuma variável/segredo Neon é referenciada no workflow.

## Gate de execução

- [ ] Revisão humana concluída e PR explicitamente aprovado.
- [ ] Plano de execução/recovery aprovado para Development isolado e limpo.
- [ ] Autorização explícita separada para execução em Development.
- [ ] Preview validado após Development.
- [ ] Production somente com aprovação explícita independente.

**Não marcar PASS** para isolamento multi-tenant forte, Auth0 E2E, Neon runtime ou RLS real com base apenas no CI descartável.
