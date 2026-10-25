# Referência Neon: gerenciamento de bancos de dados

**Estado:** documentação de referência; não comprova configuração nem execução no ambiente do IAM Control Center.  
**Fonte primária:** [Neon — Manage databases](https://neon.com/docs/manage/databases)  
**Última consulta da fonte:** 2026-10-25.

## Objetivo

Registrar as regras operacionais da documentação oficial Neon para bancos PostgreSQL e os cuidados relevantes ao desenho de persistência do IAM Control Center. Esta página não autoriza alterações em bancos compartilhados nem substitui revisão de schema, migrations ou testes isolados.

## Modelo de recursos

- Um banco de dados pertence a uma **branch** dentro de um projeto Neon.
- Um banco contém objetos SQL, como schemas, tabelas, views, funções e índices.
- A documentação Neon informa um limite de 500 bancos por branch.
- Se nenhum nome for escolhido ao criar o projeto, a branch default recebe normalmente o banco `neondb`, pertencente à role default do projeto.
- Bancos novos incluem o schema `public`; objetos SQL são criados nele por padrão.
- Ao criar uma child branch, os bancos existentes na branch pai são copiados. Para branches criadas a partir de um ponto específico no tempo, bancos criados depois desse ponto podem não ser copiados.

Fonte: [Manage databases](https://neon.com/docs/manage/databases).

## Criar, consultar e alterar

A Neon documenta gerenciamento pela Console, CLI, API e SQL. Antes de automatizar uma operação, confirmar o endpoint e o formato de request/response na [referência oficial da API](https://neon.com/docs/reference/api).

### Criação

A criação exige escolher o projeto, branch, nome do banco e owner. Em SQL, a documentação apresenta `CREATE DATABASE nome_do_banco;`. O criador torna-se owner do banco. Não executar comandos de criação em recursos compartilhados sem aprovação explícita.

### Renomear

O nome do banco faz parte da connection string. Após renomear, atualizar referências de aplicação, scripts e secrets de forma coordenada. PostgreSQL não permite renomear o banco ao qual a sessão está conectada; conecte-se a outro banco da mesma branch primeiro. Conexões abertas podem impedir a operação.

### Excluir

**A exclusão é permanente.** Os objetos pertencentes ao banco — incluindo schemas, tabelas e demais objetos — também são excluídos. Antes de qualquer exclusão, verificar o projeto, branch, banco e ambiente; obter aprovação; e confirmar backup/recuperação apropriados. Esta documentação não executa nem autoriza exclusões.

## Roles, ownership e privilégios

- A role que cria um banco passa a ser sua owner.
- Segundo a documentação Neon, a role `neon_superuser` recebe privilégios amplos nos bancos criados pela Console.
- Roles Neon criadas via Console, CLI ou API não são superusers PostgreSQL completos; a documentação descreve restrições para transferir diretamente ownership de tabelas entre roles.
- Se for necessário transferir ownership de objetos entre roles, seguir o procedimento oficial com role de grupo compartilhada ou `REASSIGN OWNED`, depois de avaliar dependências e privilégios. Não improvisar comandos de ownership em um ambiente compartilhado.

### Schema `public` no PostgreSQL 15+

A documentação informa que, a partir do PostgreSQL 15, somente o owner do banco tem por padrão o privilégio `CREATE` no schema `public`. Outras roles podem precisar de concessão explícita. Não adicionar `GRANT CREATE` automaticamente: decidir com base no modelo de least privilege e no papel efetivo da role.

## Aplicação ao IAM Control Center

O desenho de persistência do projeto prevê separação entre uma role controlada para migrations e uma role de runtime com privilégios mínimos. A documentação Neon é referência de operação do serviço, mas não substitui decisões de autorização, constraints, isolamento por tenant ou RLS.

Antes de implementar migrations executáveis:

1. Confirmar o PostgreSQL major version e as capacidades suportadas no projeto Neon usado.
2. Definir explicitamente owner, role de migrations e role runtime; não usar credenciais de owner na aplicação.
3. Revisar grants de schema, tabelas, sequences e funções; validar privilégios efetivos em PostgreSQL.
4. Criar e testar migrations apenas em banco/branch descartável ou ambiente isolado aprovado.
5. Testar banco vazio e upgrade, integridade referencial, constraints tenant-aware, RLS fail-closed, isolamento cross-tenant e comportamento da role runtime não-owner.
6. Registrar SHA, execução de CI, versão do PostgreSQL, comandos e resultados sem incluir tokens, senhas ou connection strings.
7. Não renomear nem excluir bancos, nem aplicar SQL a produção, como parte desta etapa documental.

Referência interna: [desenho do schema e plano de migrations PostgreSQL](../database/postgresql-migration-design.md).

## Checklist de validação

- [ ] Nome do projeto, branch e banco confirmados antes de cada operação.
- [ ] Owner e privilégios mínimos revisados.
- [ ] Connection strings atualizadas após eventual renomeação, sem expor valores.
- [ ] Operações destrutivas revisadas e aprovadas separadamente.
- [ ] Migrations testadas em banco isolado, incluindo upgrade e recuperação.
- [ ] RLS e permissões testadas com a role real de runtime, não com owner/superuser.
- [ ] Evidência associada ao SHA exato e ao run correspondente.
- [ ] Nenhuma alteração compartilhada foi feita apenas por adicionar esta documentação.

## Fonte normativa

- [Neon — Manage databases](https://neon.com/docs/manage/databases)
- [Neon — API Reference](https://neon.com/docs/reference/api)
- [PostgreSQL — CREATE DATABASE](https://www.postgresql.org/docs/current/sql-createdatabase.html)
- [PostgreSQL — Database roles and privileges](https://www.postgresql.org/docs/current/user-manag.html)
