# Catálogo de roles e privilégios — branch Neon isolado

- Data: 2026-10-26
- Projeto Neon: `floral-surf-85783683`
- Branch: `rls-test-isolated-2026-10-26`
- Branch ID: `br-super-darkness-b6a0w5vc`
- Parent: Development (`br-mute-pine-b6lc6bip`)
- Banco: `neondb`
- Repositório: `alexoaraujo83/iam-control-center`
- PR: [#27 — Draft](https://github.com/alexoaraujo83/iam-control-center/pull/27)
- Tipo de inspeção: SELECT-only no catálogo PostgreSQL, pela conexão do conector fixada em `Administrador`.
- Estado: evidência de catálogo; **não é teste de autenticação runtime nem prova de isolamento RLS**.

## Roles e atributos observados

| Role | LOGIN | SUPERUSER | BYPASSRLS | CREATEDB | CREATEROLE | Membership observada |
|---|---:|---:|---:|---:|---:|---|
| `Administrador` | Sim | Não | **Sim** | **Sim** | **Sim** | `iam_app_runtime_dev_safe` (aparece duas vezes no agregado), `iam_migrator`, `iam_app_runtime`, `neon_superuser` |
| `iam_app_runtime` | Não | Não | Não | Não | Não | Nenhuma |
| `iam_app_runtime_dev_safe` | Sim | Não | Não | Não | Não | `iam_app_runtime` |
| `iam_migrator` | Não | Não | Não | Não | Não | Nenhuma |

A sessão administrativa tem privilégios elevados e membership em roles de runtime/migrator. Por isso, resultados de consulta por essa conexão não podem ser usados como prova de comportamento do runtime real.

## RLS e privilégios diretos do role base `iam_app_runtime`

| Tabela | RLS | FORCE RLS | SELECT | INSERT | UPDATE | DELETE |
|---|---:|---:|---:|---:|---:|---:|
| `iam.identities` | Não | Não | Sim | Sim | Sim | Não |
| `iam.invitations` | Sim | Sim | Sim | Sim | Sim | Não |
| `iam.membership_roles` | Sim | Sim | Sim | Sim | Sim | Não |
| `iam.memberships` | Sim | Sim | Sim | Sim | Sim | Não |
| `iam.permissions` | Não | Não | Sim | Não | Não | Não |
| `iam.role_permissions` | Não | Não | Sim | Não | Não | Não |
| `iam.roles` | Não | Não | Sim | Não | Não | Não |
| `iam.schema_migrations` | Não | Não | Não | Não | Não | Não |
| `iam.tenants` | Não | Não | Sim | Não | Não | Não |

## Interpretação e bloqueios

1. A role `iam_app_runtime_dev_safe` está configurada com LOGIN e sem `SUPERUSER`, `BYPASSRLS`, `CREATEDB` ou `CREATEROLE`; ela é membro de `iam_app_runtime`.
2. Isso é somente evidência de atributos de catálogo. A conexão usada na inspeção é `Administrador`, que possui `BYPASSRLS`, `CREATEDB`, `CREATEROLE` e memberships privilegiadas.
3. A tentativa de selecionar `role_name = iam_app_runtime_dev_safe` foi recusada pelo conector porque a conexão está fixada em `Administrador`. Não foi autenticada uma sessão independente como runtime.
4. As tabelas `iam.roles`, `iam.role_permissions`, `iam.tenants`, `iam.identities` e `iam.permissions` continuam sem RLS neste branch isolado, conforme o estado herdado do parent. Nenhuma política foi alterada.
5. Não se deve interpretar a inspeção de grants por `has_table_privilege` como prova de que a credencial login funciona, nem como prova de que RLS isola tenants.
6. Não foi executado DDL, DML, `SET ROLE`, grant, alteração de role ou migration. Production não foi acessada.

## Próximo passo

Obter um caminho seguro que autentique diretamente como `iam_app_runtime_dev_safe` (ou outra login role runtime formalmente designada) no branch isolado. Executar primeiro consultas read-only de identidade e privilégios; depois, com fixtures de teste e autorização explícita para testes de comportamento, validar os cenários RLS. Até lá, o teste runtime permanece **BLOCKED** e migrations executáveis continuam fora de escopo.
