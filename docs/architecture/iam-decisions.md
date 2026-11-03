# Contratos IAM — proposta para revisão

Status: **proposta Draft; não aprovada para execução**  
Escopo: identidade OIDC, tenant, membership, RBAC e auditoria para a primeira migration do IAM Control Center.

## Princípios normativos

- UUIDs são identificadores internos; valores externos do IdP não substituem as chaves internas.
- Autorização é negada por padrão. Autenticação OIDC, membership ativa e autorização da operação são verificações distintas.
- E-mail é atributo de contato, não chave de identidade nem prova para vincular automaticamente contas.
- Toda relação pertencente a tenant deve carregar `tenant_id` e usar FK composta quando relacionar entidades tenant-scoped.
- Nenhum papel de runtime recebe `BYPASSRLS), propriedade de objetos, administração de roles ou privilégios implícitos.
- Nenhuma migration inicial deve semear tenants, usuários, roles ou permissões operacionais.

## Decisões propostas

| ID | Contrato | Proposta | Estado |
|---|---|---|---|
| IAM-DC01 | Identificadores | UUID interno para tenant, identity, membership e role. | Proposto |
| IAM-DC02 | Identidade externa | Chave única exata `(issuer, subject)`; issuer validado como HTTPS; subject opaco e case-sensitive. | Proposto |
| IAM-DC03 | E-mail | Pode ser nulo; nunca autoriza acesso, vinculação automática ou recuperação de identidade por si só. | Proposto |
| IAM-DC04 | Tenant | UUID; `slug` opcional e único quando informado; status `active/suspended/deleted`. | Proposto |
| IAM-DC05 | Membership | Uma linha por `(tenant_id, identity_id)`; estados `invited/active/suspended/revoked`; somente `active` autoriza. Reativação reutiliza o registro. | Proposto |
| IAM-DC06 | Roles | Roles são tenant-scoped; unicidade `(tenant_id, key)`; FKs compostas impedem associação entre tenants. | Proposto |
| IAM-DC07 | Permissions | Catálogo global com chave estável; concessões explícitas; nenhum seed ou grant automático na migration inicial. | Proposto |
| IAM-DC08 | Auditoria | Eventos append-only; sem tokens, cookies, segredos, IP ou User-Agent nesta fase; retenção ainda não definida. | Proposto |
| IAM-DC09 | Contexto RLS | GUC UUID simples não é fronteira confiável. Contexto assinado, roles por tenant e broker permanecem alternativas não aprovadas. | Bloqueador |

## Modelo relacional proposto

- `iam.tenants`: organização/tenant.
- `iam.identities`: identidade global identificada por issuer + subject.
- `iam.memberships`: vínculo de identidade com tenant.
- `iam.roles`: papéis definidos dentro de tenant.
- `iam.permissions`: catálogo global de permissões.
- `iam.membership_roles`: associação de membership a role no mesmo tenant.
- `iam.role_permissions`: permissões concedidas a uma role no mesmo tenant.
- `iam.invitations`: convites vinculados a tenant e, opcionalmente, membership emissora.
- `audit.events`: trilha de eventos append-only.
- `iam.schema_migrations`: ledger de versão/checksum administrado pelo processo de migration.

## Limites desta primeira entrega

1. A migration cria estrutura e ativa/força RLS, mas não cria policies de acesso de aplicação.
2. Ausência de policy é intencional: PostgreSQL aplica default-deny. A aplicação não terá acesso funcional até que o RFC de contexto confiável, policies e grants sejam aprovados.
3. A migration não cria/alter roles, não instala extensões, não concede privilégios ao runtime e não insere dados de negócio.
4. A execução exige objetos de role previamente provisionados e sessão efetiva como `iam_owner`. A cadeia de membership do login migrator até `iam_owner` precisa ser definida fora desta migration e revisada.
5. A migration é apenas para banco limpo. Não usar como reset nem sobre o protótipo existente.

## Questões em aberto para revisão humana

- Aprovar modelo de ownership e caminho de `iam_migrator_login → iam_migrator → iam_owner`.
- Escolher e testar o mecanismo de contexto tenant confiável antes de criar policies.
- Definir operações de provisionamento de tenant, catálogo de permissions e administração RBAC fora do acesso SQL direto do runtime.
- Definir retenção, particionamento e acesso de leitura à auditoria.
- Definir política de slug: mutabilidade, reserva e eventual não reutilização.
- Definir se convites serão consumidos por token de uso único e qual algoritmo/rotação será adotado para hash.

## Evidência e aprovação

Este documento expressa propostas, não decisões implementadas. Aprovação requer revisão do diff, dos testes, da cadeia de roles e do RFC. Nenhuma execução em Neon está autorizada por este PR.
