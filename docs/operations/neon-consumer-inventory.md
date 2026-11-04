# Inventário de consumidores PostgreSQL — Etapa A

**Status:** CLIENTE SERVER-ONLY IMPLEMENTADO / CONSULTA REAL AINDA NÃO EXECUTADA  
**Projeto:** IAM Control Center  
**Repositório:** alexoaraujo83/iam-control-center  
**Branch de referência:** proposal/pooler-runtime-migration-isolation  
**HEAD de referência:** a8c902302b4477bdf5de8889e7d9a8fb549a004b  
**Data da atualização:** 2026-11-03

## 1. Resultado executivo atualizado

A PR #69 adiciona diretamente a dependência @neondatabase/serverless 1.2.0 ao pacote apps/web e implementa apps/web/src/lib/db.ts como módulo server-only. A função getSql() valida se DATABASE_URL está presente e não vazia e instancia o cliente Neon.

**Limite funcional:** getSql() não executa uma query, não abre uma sessão comprovada e não valida host, TLS, usuário, grants, RLS ou conectividade com o projeto Neon canônico. Os testes de db.ts mockam o factory neon(); portanto, comprovam somente a validação de configuração e a instanciação do cliente.

O endpoint GET /api/health continua sendo um indicador de configuração, não um teste de conectividade PostgreSQL. Não há executor de migrations implementado nesta branch.

**Conclusão:** existe agora um scaffold de cliente PostgreSQL no runtime web, mas ainda não existe um consumidor de query funcional. Pooling não deve ser ativado nem declarado operacional sem identificar e testar a conexão real.

## 2. Evidências por arquivo e estado atual

| Arquivo | Estado observado na branch | Limite da evidência |
|---|---|---|
| package.json | pnpm permanece como package manager; scripts raiz delegam para apps/web | Não comprova conexão PostgreSQL |
| apps/web/package.json | Declara @neondatabase/serverless 1.2.0 | Dependência instalada não comprova uso funcional |
| apps/web/src/lib/db.ts | Módulo server-only; getSql() valida DATABASE_URL e retorna neon(connectionString) | Não executa query nem abre sessão |
| apps/web/src/lib/db.test.ts | Testes mockados para variável vazia, whitespace e factory neon() | Não testa rede, TLS, role, grants ou RLS |
| apps/web/src/lib/env.ts | Mantém validação de presença de configuração | Não comprova conectividade |
| apps/web/src/app/api/health/route.ts | Health verifica configuração | Não executa SELECT nem valida sessão |
| .env.example | Documenta DATABASE_URL | Não contém executor de migrations |
| pnpm-lock.yaml | Registra @neondatabase/serverless 1.2.0 no importer apps/web | Lockfile não comprova execução |
| database/migrations/README.md | Define revisão e gates de migration | Não existe executor operacional nesta branch |
| .github/workflows/quality.yml | Executa quality e build; testes do cliente usam mocks | Não conecta ao Neon nem prova integração runtime |

## 3. Mapa atual de consumidores

| Consumidor | Variável | Estado verificado | Resultado |
|---|---|---|---|
| Health endpoint Next.js | DATABASE_URL | Verifica presença/configuração | CONFIGURATION CHECK ONLY |
| Cliente Neon server-only | DATABASE_URL | Factory neon() instanciado por getSql() | SCAFFOLD IMPLEMENTED |
| Query PostgreSQL no runtime | DATABASE_URL | Nenhuma query real demonstrada | NOT IMPLEMENTED |
| Sessão real autenticada como runtime | DATABASE_URL | Não comprovada | NOT VERIFIED |
| Executor de migrations | DATABASE_MIGRATION_URL | Nenhum executor identificado | NOT IMPLEMENTED |
| CI de qualidade desta branch | PostgreSQL descartável | Testes do cliente usam mocks; sem conexão Neon | MOCKED TESTS ONLY |
| Workflow de verificação Neon | NEON_REVIEW_DATABASE_URL | Workflow separado, manual e read-only | SEPARATE REVIEW CHECK |

DATABASE_MIGRATION_URL não deve ser exposta ao runtime web. Sua implementação futura deverá usar um executor protegido, conexão direta e ambiente explicitamente autorizado.

## 4. Implicações para pooling e conectividade

O estado de pooler desabilitado foi registrado na reconciliação read-only do projeto Neon canônico. Reconfirmar o estado atual no console/API antes de qualquer mudança.

Não é possível concluir compatibilidade com PgBouncer em modo transacional apenas pela presença do pacote @neondatabase/serverless. Antes de habilitar pooling, a implementação deverá declarar e testar:

1. Driver e versão efetivamente utilizados.
2. Host, database e role da conexão, sem registrar a connection string.
3. TLS, timeouts e comportamento de retry.
4. Uso de prepared statements, estado de sessão, SET, advisory locks e tabelas temporárias.
5. Estratégia de concorrência e limites de conexão no runtime serverless.
6. Query de integração em PostgreSQL descartável.
7. Query autenticada em branch Development isolada, usando a role runtime dedicada.
8. Privilégios efetivos e políticas RLS com a role real, não com owner/admin.

Não habilitar pooler com base apenas em uma decisão documental. Não usar credenciais administrativas, owner ou migrator como runtime.

## 5. Próximas ações revisáveis

1. Manter getSql() server-only e não expor DATABASE_URL ao bundle cliente.
2. Implementar uma operação de leitura mínima que execute SELECT 1 em PostgreSQL descartável e valide erros/timeouts.
3. Criar teste de integração com PostgreSQL 18 no CI da cadeia apropriada, sem credenciais Neon.
4. Reconciliar a proposta com o projeto Neon canônico e confirmar o endpoint/role efetivos sem revelar valores.
5. Provar conexão real com login runtime dedicado em Development, após revisão e autorização específica.
6. Definir executor separado para DATABASE_MIGRATION_URL, sem acesso pelo runtime web.
7. Testar compatibilidade de pooling antes de qualquer habilitação.
8. Manter Preview e Production sem alterações até aprovação própria.

## 6. Limites e não execução

- A dependência @neondatabase/serverless 1.2.0 e o módulo server-only foram adicionados na PR #69.
- Os testes de db.ts usam mocks e não comprovam conectividade.
- Nenhuma query de aplicação foi executada contra o Neon nesta entrega.
- Nenhuma connection string foi descriptografada ou impressa.
- Nenhuma variável ou secret foi criada, removida ou alterada.
- Nenhuma role, membership, ACL, branch, endpoint ou pooler Neon foi alterado.
- Nenhuma migration ou SQL de escrita foi executado.
- Nenhuma configuração Auth0 foi alterada.
- Nenhum deploy Production foi realizado.

## 7. Critérios de aceite da Etapa A

- Cliente server-only: IMPLEMENTED.
- Dependência no manifest/lockfile: IMPLEMENTED.
- Testes unitários mockados: PASS no SHA/run correspondente.
- Query real no PostgreSQL descartável: PENDING.
- Conexão real com Neon Development: NOT VERIFIED.
- Identidade e grants da role runtime: NOT VERIFIED.
- RLS multi-tenant: NOT VERIFIED.
- Compatibilidade PgBouncer: NOT TESTED.
- Executor DATABASE_MIGRATION_URL: NOT IMPLEMENTED.

A conclusão permanece limitada ao scaffold de cliente. Não declarar integração Neon concluída até haver query real, sessão autenticada com role runtime e evidência de privilégios/RLS.
