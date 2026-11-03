# Revisão de ownership e privilégio do migrator

**Status: topologia de roles executada somente em Development sob autorização específica; credenciais de login não provisionadas; migration 0001 não executada.**

## Escopo do projeto canônico — inventário read-only 03/11/2026

Projeto Neon: wandering-wildflower-90908845.

O bootstrap de roles IAM foi executado somente no branch Development, no database Iam-control-center, usando a proposta revisada da PR #80. A inspeção SQL read-only posterior confirmou cinco roles IAM e três memberships da topologia aprovada.

Development contém:
- iam_owner: NOLOGIN, NOINHERIT, NOSUPERUSER, NOBYPASSRLS.
- iam_migrator: NOLOGIN, NOINHERIT, NOSUPERUSER, NOBYPASSRLS.
- iam_migrator_login: LOGIN, NOINHERIT, NOSUPERUSER, NOBYPASSRLS.
- iam_app_runtime: NOLOGIN, INHERIT, NOSUPERUSER, NOBYPASSRLS.
- iam_app_runtime_login: LOGIN, INHERIT, NOSUPERUSER, NOBYPASSRLS.

Memberships observadas:
- iam_migrator_login → iam_migrator: INHERIT FALSE / SET TRUE / ADMIN FALSE.
- iam_migrator → iam_owner: INHERIT FALSE / SET TRUE / ADMIN FALSE.
- iam_app_runtime_login → iam_app_runtime: INHERIT TRUE / SET FALSE / ADMIN FALSE.

O Neon também mantém memberships provider-managed em que Iam-control-center_owner é membro e cloud_admin é grantor. Essas associações administrativas não são concedidas aos principals IAM e não devem ser revogadas como correção dos testes.

A role administrativa Iam-control-center_owner possui privilégios de proprietário/gestão do Neon, incluindo CREATEDB, CREATEROLE, REPLICATION e BYPASSRLS. Ela não deve ser usada como DATABASE_URL do runtime.

Preview e Production foram consultados por inventário de branches, roles, databases e relações: somente a role proprietária do database foi listada; não foram identificadas roles IAM nem tabelas de aplicação. Nenhuma alteração foi aplicada nesses branches.

## Estado operacional do Development

- iam_owner tem CREATE no database.
- iam_migrator_login e iam_app_runtime_login têm CONNECT explícito.
- Os logins e roles runtime não têm CREATE no database.
- As memberships IAM possuem ADMIN FALSE.
- A role runtime não é membro de iam_owner ou iam_migrator.
- O database ainda não possui as tabelas da aplicação; a consulta de relações retornou vazio.
- A migration 0001 não foi executada.
- Nenhuma credencial de senha foi provisionada para os dois LOGINs.

Uma tentativa read-only de conexão pelo conector Neon usando role_name iam_migrator_login e iam_app_runtime_login falhou com “missing authentication credentials: required password”. Portanto, os atributos LOGIN e memberships estão presentes, mas a autenticação real desses principals ainda não foi validada. A criação de senha/credencial deve ser uma ação separada, com secret store apropriado e autorização específica.

## Estado observado na migration 0001

A migration exige current_user = iam_owner, cria os schemas iam, audit e app_private com AUTHORIZATION iam_owner, e cria as tabelas sob essa identidade efetiva. O ledger iam.schema_migrations fica sem FORCE RLS e sem grants ao runtime. As tabelas de negócio/auditoria recebem ENABLE + FORCE RLS, sem policies nem grants de runtime na baseline.

O bootstrap PostgreSQL 18 descartável concede CREATE no database a iam_owner. A introspecção SQL read-only no Neon Development confirmou esse privilégio. A execução da migration continua bloqueada pela ausência de credencial autenticável para iam_migrator_login e pela necessidade de revisar o SQL da migration no SHA candidato.

## Alternativas arquiteturais

| Alternativa | Ownership de schemas/tabelas | Capacidade do login migrator | Avaliação |
|---|---|---|---|
| A. Owner separado, migrator assume owner | iam_owner | iam_migrator_login → iam_migrator → iam_owner via SET TRUE | Preserva owner NOLOGIN e identidade administrativa separada; cadeia precisa ser estritamente limitada e auditada |
| B. Migrator como owner | iam_migrator | Assume somente iam_migrator | Remove o salto para owner, mas mistura identidade de execução de migrations com ownership duradouro dos objetos |
| C. Login assume owner diretamente | iam_owner | iam_migrator_login → iam_owner | Mais simples, mas elimina o grupo intermediário como fronteira organizacional |

## Recomendação para revisão

Manter a Alternativa A como topologia aprovada para o protótipo, condicionada aos controles abaixo. Ela preserva a distinção entre:
- iam_owner: owner NOLOGIN dos objetos e schemas IAM.
- iam_migrator: role de capacidade de execução de migrations.
- iam_migrator_login: credencial LOGIN dedicada, NOINHERIT e NOBYPASSRLS.
- iam_app_runtime: role de aplicação sem membership em owner/migrator.

A cadeia de assunção é um privilégio administrativo efetivo: quem pode assumir iam_owner pode alterar objetos pertencentes ao owner. iam_migrator não deve ser tratado como role de baixo privilégio só por ser NOLOGIN. A credencial migrator deve ficar fora do runtime e ser usada apenas por processo controlado, com migration revisada e checksum registrado.

A Alternativa B não é recomendada para a baseline atual porque deixa o role de execução como owner persistente de todos os objetos. Pode ser reconsiderada se houver requisito operacional que justifique ownership pelo migrator e uma revisão completa do preflight, dos owners e do ledger.

## Preflight e testes adicionais obrigatórios antes de qualquer execução Neon

1. Confirmar que a credencial dedicada de iam_migrator_login autentica sem usar Iam-control-center_owner.
2. Confirmar session_user = iam_migrator_login e current_user = iam_owner na sessão real, após os dois SET ROLE.
3. Confirmar que os schemas e objetos criados pertencem a iam_owner.
4. Confirmar iam_owner, iam_migrator e iam_app_runtime como NOLOGIN/NOBYPASSRLS e iam_migrator_login como LOGIN/NOINHERIT/NOBYPASSRLS.
5. Confirmar que iam_app_runtime não é membro direto ou transitivo de iam_migrator ou iam_owner.
6. Executar a migration primeiro em PostgreSQL descartável e branch Development isolada, com checksum e rollback revisados.
7. Validar as policies RLS com a role runtime autenticada, depois de grants/policies aprovados.

## Decisão e limites

O bootstrap de roles foi aplicado somente em Development sob autorização específica. Não foram provisionadas senhas para os principals LOGIN, não foi executada a migration 0001, não foram criadas tabelas de aplicação e não foi alterado Preview ou Production. Auth0 permanece como IdP; Neon Auth não faz parte desta arquitetura.
