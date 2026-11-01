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


## Evidência read-only do Neon — 01/11/2026

Projeto `floral-surf-85783683`, database `iam_control_center`. Nenhuma instrução DDL/DML foi executada durante esta inspeção.

| Branch | ID | Estado | Relações de aplicação |
|---|---|---|---|
| production | `br-super-flower-b6k7w8wp` | ready | Nenhuma |
| development | `br-bitter-rain-b6j4sexv` | ready | Nenhuma |
| preview | `br-holy-rain-b6i380c9` | ready | Nenhuma |

### Roles e memberships observadas

- `iam_owner`, `iam_migrator` e `iam_app_runtime`: roles de grupo NOLOGIN e NOBYPASSRLS.
- `iam_migrator_login`: LOGIN e NOBYPASSRLS; membro de `iam_migrator` com `INHERIT` e `SET`.
- `iam_app_runtime_login`: LOGIN e NOBYPASSRLS; membro de `iam_app_runtime` com `INHERIT` e `SET`.
- Não existe membership de `iam_migrator` em `iam_owner`, nem membership direta de `iam_migrator_login` em `iam_owner`. Logo, a cadeia proposta `iam_migrator_login → iam_migrator → iam_owner` **não está configurada**.
- A sessão disponibilizada pelo conector está fixada em `Administrador`; a consulta read-only como `iam_app_runtime_login` foi rejeitada pelo conector por não permitir trocar a role da conexão. Portanto, não há prova de sessão runtime efetiva.
- `Administrador` possui privilégios administrativos elevados, incluindo `CREATEROLE`, `CREATEDB`, `REPLICATION` e `BYPASSRLS`. Essa sessão não é evidência válida para isolamento RLS.

### Resultado de CI no SHA da PR

- PR #57 head: `459eeaf42f12107dc35fd2e81e0d8fdde6ea7327`.
- [Database schema tests #41271402479](https://github.com/alexoaraujo83/iam-control-center/actions/runs/41271402479): SUCCESS.
- [CI #41271402534](https://github.com/alexoaraujo83/iam-control-center/actions/runs/41271402534): SUCCESS.
- O teste PostgreSQL 18.6 descartável confirmou contrato estrutural, FK composta cross-tenant e RLS default-deny. Não valida a cadeia de roles real no Neon nem o contexto de tenant confiável.

### Decisão de gate

**EXECUÇÃO EM NEON: BLOCKED.** A migration exige `current_user = iam_owner`, mas o login migrator não pode assumir `iam_owner` com a topologia observada. O runtime login também não foi testado como sessão efetiva. Não corrigir isso concedendo privilégios ao papel administrativo, nem usar `Administrador` como runtime.

Para desbloquear, é necessária uma decisão revisável sobre a cadeia de assunção de roles e um método de teste que autentique efetivamente como os logins dedicados, sem revelar ou reutilizar credenciais administrativas. Qualquer mudança de membership/role no Neon exige autorização separada.

### Integridade da identidade do ator em auditoria — corrigida na proposta

A revisão identificou que a FK original correlacionava membership e tenant, mas não garantia que `actor_identity_id` fosse a identidade daquela membership. A proposta foi corrigida no head atual:
- `iam.memberships` agora declara chave única `(id, tenant_id, identity_id)`.
- `audit.events` exige `actor_identity_id` quando `actor_membership_id` está preenchido.
- A FK de auditoria agora referencia `(actor_membership_id, tenant_id, actor_identity_id)` para a membership.
- O teste de contrato rejeita identidade divergente e identidade ausente, e aceita o par correspondente.

Evidência automatizada: **PASS** no workflow [database-schema-tests #41303224076](https://github.com/alexoaraujo83/iam-control-center/actions/runs/41303224076), executado com PostgreSQL 18.6 e SHA de código `1c5a4533151534eafb758fd021a626ab53ff84ca`. O workflow de qualidade [CI #41303238973](https://github.com/alexoaraujo83/iam-control-center/actions/runs/41303238973) também concluiu SUCCESS no head documental `8ced97f7d3aacb582b7748bcf082d0502ee9078b`.

Nenhuma migration foi aplicada em production, development ou preview. As três branches continuam sem tabelas de aplicação.
