# Proposta — reconciliação Neon ↔ Vercel por ambiente

**Status:** proposta para revisão; não aplicada  
**Data do inventário:** 2026-11-02  
**Projeto Neon canônico:** `wandering-wildflower-90908845`  
**Projeto Vercel:** `iam-control-center`

## 1. Objetivo e limites

Alinhar as referências de projeto e o desenho das conexões Vercel com o projeto Neon canônico, sem expor credenciais e sem alterar valores nesta proposta.

Esta documentação não autoriza:
- modificar variáveis ou secrets no Vercel;
- descriptografar, copiar, registrar ou imprimir connection strings;
- criar/alterar roles, memberships, ACLs, branches ou snapshots Neon;
- executar migrations ou SQL de escrita;
- modificar a configuração de Production;
- habilitar pooler;
- executar o workflow legado.

Auth0 permanece como único provedor de identidade. Neon Auth permanece desabilitado. Neon é utilizado como PostgreSQL gerenciado.

## 2. Baseline observado

| Ambiente | Branch Neon canônica | Branch ID | Estado do pooler observado |
|---|---|---|---|
| Development | Development | `br-nameless-wave-b49yqod7` | Desabilitado |
| Preview | Preview | `br-broad-base-b4gnjmg5` | Desabilitado |
| Production | Production | `br-dry-mouse-b4gyjp04` | Desabilitado |

Os três endpoints consultados estavam em estado `ready`. Os identificadores de endpoint não são connection strings e não demonstram qual endpoint está sendo usado pela Vercel.

Inventário Vercel realizado com descriptografia desabilitada:
- `NEON_PROJECT_ID` estava cadastrado em Development e Preview com a referência antiga `floral-surf-85783683`.
- `DATABASE_URL` estava cadastrada em Development, Preview e Production.
- `DATABASE_MIGRATION_URL` estava cadastrada em Development e Preview.
- Os comentários associados a variáveis são metadados informativos; não comprovam hostname, database, branch, usuário ou role efetivos.
- Não foi possível validar os valores das connection strings sem acessar segredos. Nenhum segredo foi revelado.

Inventário de roles Neon retornou apenas `Iam-control-center_owner` em cada uma das três branches consultadas. Isso não prova que não existam roles adicionais ocultas por permissões/escopo da consulta, nem confirma as identidades usadas nas URLs Vercel.

## 3. Estado-alvo proposto

| Ambiente | `NEON_PROJECT_ID` | `DATABASE_URL` runtime | `DATABASE_MIGRATION_URL` |
|---|---|---|---|
| Development | `wandering-wildflower-90908845` | Branch `br-nameless-wave-b49yqod7`; role runtime dedicada; conexão direta enquanto pooler estiver desabilitado | Direta para Development; identidade migrator separada |
| Preview | `wandering-wildflower-90908845` | Branch `br-broad-base-b4gnjmg5`; role runtime dedicada; conexão direta enquanto pooler estiver desabilitado | Direta para Preview; identidade migrator separada |
| Production | Sem alteração nesta proposta | Sem alteração nesta proposta; branch esperada `br-dry-mouse-b4gyjp04` ainda precisa de validação independente | Não criar nem alterar nesta proposta |

**Importante:** `NEON_PROJECT_ID` identifica o projeto, não seleciona uma branch. A branch efetiva é determinada pelo endpoint/database presentes na connection string.

Nenhuma role runtime ou migrator deve ser presumida existente. O bootstrap de roles segue sujeito à PR #65 e à autorização operacional específica. Não usar a role owner como credencial de runtime.

## 4. Critérios para validar as URLs sem divulgar segredos

A validação deve ocorrer em execução controlada, sem imprimir a URL, senha, query string ou variável completa. Registrar somente resultados não sensíveis:

1. hostname normalizado e endpoint ID correspondente;
2. database retornado por `current_database()`;
3. identidade de conexão por `session_user` e `current_user`;
4. atributos de segurança da role efetiva (`rolcanlogin`, `rolsuper`, `rolbypassrls`, `rolcreatedb`, `rolcreaterole`);
5. branch/ambiente esperado, demonstrado pela associação endpoint → branch no Neon;
6. resultado de `SELECT 1` e timeout;
7. confirmação de TLS exigido;
8. ausência de credenciais nos logs e artefatos.

Não executar testes de escrita para validar a conexão. Testes RLS e cross-tenant são uma etapa separada e exigem fixture e identidades reais apropriadas.

## 5. Pooling e gerenciamento de conexões

No inventário de 2026-11-02, o pooler estava desabilitado nas três branches. Portanto:
- não usar hostname `-pooler` nem afirmar que a conexão é pooled;
- não habilitar pooler como parte desta proposta;
- se o pooler for habilitado futuramente, validar endpoint, role, TLS, limites e comportamento transacional antes de mudar a URL;
- manter pool limitado no runtime Node.js e avaliar integração com o ciclo de vida do Vercel Fluid Compute;
- migrations devem usar conexão direta/unpooled e credencial separada.

## 6. Sequência segura de implantação futura

1. Aprovar esta proposta em revisão.
2. Confirmar roles e memberships no Development; não inferir existência a partir de comentários ou CI.
3. Aprovar e executar separadamente o bootstrap de roles somente após preflight, checkpoint e autorização explícita.
4. Confirmar endpoint/branch/database/role de cada URL sem revelar segredos.
5. Alterar apenas `NEON_PROJECT_ID` em Development e Preview para o ID canônico, mediante aprovação explícita.
6. Atualizar Development `DATABASE_URL` somente depois da validação de branch e role runtime.
7. Validar Preview em etapa separada, sem tocar Production.
8. Manter `DATABASE_MIGRATION_URL` direta e separada, após validar role migrator.
9. Produzir evidência por ambiente, SHA, horário e resultado redigido.
10. Production exige proposta e autorização próprias; não faz parte desta entrega.

## 7. Rollback

Antes de qualquer alteração futura, registrar metadados não secretos da configuração anterior (nome, target, git branch e comentário), sem copiar valores secretos para GitHub ou documentação.

Rollback deve restaurar somente a variável/target alterada, com aprovação e verificação posterior. Não usar rollback de variável para encobrir uma branch ou role incorreta; interromper e investigar.

## 8. Evidências e pendências

| Controle | Estado em 2026-11-02 |
|---|---|
| Branches Neon canônicas identificadas | PASS — inventário read-only |
| Pooler | NOT CONFIGURED — desabilitado nas três branches |
| `NEON_PROJECT_ID` Development/Preview | FAIL — referência antiga |
| Host/database/role de `DATABASE_URL` | NOT VERIFIED — secrets não descriptografados |
| Role runtime dedicada | NOT VERIFIED — inventário retornou apenas owner |
| `DATABASE_MIGRATION_URL` separada | PASS — variável cadastrada em Development e Preview; conteúdo não validado |
| Production | BLOCKED — fora do escopo de alteração |
| Teste real de conectividade e RLS | PENDING |

## 9. Evidência de segurança

Nenhuma variável Vercel foi modificada, nenhum secret foi revelado, nenhuma branch/role/ACL Neon foi alterada e nenhuma migration foi executada durante a preparação desta proposta.
