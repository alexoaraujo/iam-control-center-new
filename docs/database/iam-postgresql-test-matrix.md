# Matriz de testes da arquitetura IAM PostgreSQL

**Status:** BLOCKED — o contrato de roles/migration passou no SHA 51f9098a5a8b8506fae05909c9e289b799fea97a, mas o restore integral falhou porque o dump versionado mantém search_path antigo em current_tenant_id().
**Fonte estrutural:** Neon iam-database-delivery / iam_database, projeto twilight-fire-88497009, branch main (br-little-fire-b6adup9f).
**Regra de evidência:** PASS só é atribuído ao SHA exato em que o job correspondente terminou com sucesso. Restore descartável não prova equivalência com a origem Neon; RLS/FORCE RLS no catálogo não prova isolamento funcional.

## Decisões arquiteturais que os testes devem preservar

1. O banco não cria automaticamente tenant, identidade, membership ou permissões para uma identidade recém-autenticada. O vínculo de identidade com tenant/membership é explícito e persistido.
2. A aplicação usa uma role runtime sem SUPERUSER, BYPASSRLS, CREATEROLE, CREATEDB ou privilégios de owner/migrator.
3. O contexto de tenant não é confiável por ser apenas um GUC. app_private.current_tenant_id() valida um contexto assinado HMAC-SHA256 cujo payload canônico é tenant|identity|expires|nonce.
4. O contexto é fail-closed: exige tenant, identidade, expiração, nonce, assinatura, chave ativa, assinatura válida e tenant/identity/membership ativos. A expiração aceita no máximo 300 segundos.
5. Tabelas tenant-scoped devem ter RLS e FORCE RLS; testes de comportamento executam como iam_app_runtime, não apenas como owner/superuser.
6. Migrations são executadas por sessão direta iam_migrator_login, seguem a cadeia SET-only revisada, adquirem advisory transaction lock e registram checksum e source SHA no ledger na mesma transação.
7. Bootstrap de banco vazio, restore da baseline operacional e migrations incrementais são trilhas diferentes. Não inferir que a fixture reduzida de uma migration representa o schema integral.

## Cobertura automatizada

| Área | Teste / artefato | Cobertura comprovada ou pretendida | Estado |
|---|---|---|---|
| Restore estrutural | database/tests/restore-source-schema.sh | PostgreSQL 18 descartável; 23 tabelas, 1 view, 9 funções, 7 enums, 12 triggers, 41 policies, 20 tabelas RLS+FORCE, owners, pgcrypto, índice parcial e search_path hardened | FAIL no SHA 51f9098a5a8b8506fae05909c9e289b799fea97a: dump restaurado tem current_tenant_id search_path incluindo public; PASS histórico anterior não cobre este contrato atualizado |
| Contexto válido | database/tests/runtime-rls-contract.sql | HMAC válido e contexto resolvido para tenant A/B | ADICIONADO; CI pendente |
| Ausência de contexto | mesmo arquivo | SELECT de tenants, memberships e identities retorna zero linhas como runtime | ADICIONADO; CI pendente |
| Isolamento cross-tenant | mesmo arquivo | Tenant A vê apenas A; tenant B vê apenas B; identities filtradas pela membership | ADICIONADO; CI pendente |
| Escrita cross-tenant | mesmo arquivo | INSERT em organizations com tenant divergente é rejeitado por RLS/WITH CHECK | ADICIONADO; CI pendente |
| Assinatura adulterada | mesmo arquivo | assinatura inválida é rejeitada e o contexto permanece limpo | ADICIONADO; CI pendente |
| Expiração | mesmo arquivo | contexto expirado e validade superior a 300 segundos são rejeitados | ADICIONADO; CI pendente |
| Roles e memberships | database/tests/run.sh, role-assumption-contract.sql | atributos administrativos, arestas SET/INHERIT/ADMIN, fronteira owner, bootstrap lockout e cenários negativos antes de DDL | PASS histórico no SHA 71c17ae648521b3f3b5d73689e756e981f6f9bfd; conferir SHA atual após novo CI |
| Migration incremental | migration 0001_context_key_hardening.sql e 0001_schema_contract.sql | preflight, índice parcial, SECURITY DEFINER/search_path, ledger, checksum/source SHA e rollback de fixtures | PASS histórico no SHA acima; lineage permanece BLOCKED |
| Concorrência do lock | duas sessões psql independentes | PIDs distintos; sessão B aguarda A; T_B_attempt < T_A_lock_release < T_B_acquired; ledger final sem entrada de migration de teste | PENDING — evidência independente ainda não registrada |
| Idempotência/checksum | runner de migration | mesma migration/checksum não duplica ledger; checksum divergente deve falhar fechado | Cobertura parcial; reforçar com testes explícitos |
| Estado de membership/identity/tenant | contrato de contexto | membership, identidade ou tenant inativos devem invalidar o contexto | PENDING no novo contrato dinâmico |
| Chave HMAC | contrato de contexto | ausência de chave ativa, chave curta, rotação e múltiplas chaves ativas | Parcial: constraint e índice único são verificados; comportamento de rotação/ausência deve ser testado |
| Auth0/OIDC | E2E externo | issuer, audience, assinatura/JWKS, expiração, claims namespaced e falhas de login/session | PENDING; jobs Auth0 E2E anteriores foram SKIPPED |

## Protocolo de concorrência obrigatório

Executar em uma branch Neon descartável ou PostgreSQL descartável com dois clientes independentes, nunca numa única conexão serializada:

- Sessão A: BEGIN, SET LOCAL ROLE iam_migrator, registrar PID e instante, adquirir iam.acquire_migration_lock(), aguardar e confirmar.
- Sessão B: iniciar depois de A, registrar PID/instante antes de chamar a mesma função; deve ficar bloqueada até A confirmar.
- Evidência: PIDs distintos; A adquiriu antes de B tentar; o evento A_LOCK_RELEASE ocorre antes de B adquirir; como a função usa pg_advisory_xact_lock, o lock só é liberado no COMMIT de A; ambas as transações encerraram; ledger permaneceu inalterado.
- Não marcar PASS com apenas pg_sleep em uma única sessão ou logs sem correlação temporal entre os dois clientes.

## Limites e pendências

- O contrato dinâmico adicionado é executado no restore PostgreSQL descartável. Ele não executa DDL nem dados na fonte Neon.
- O teste ainda não comprova comportamento em branch Neon isolada com as memberships/provider grants reais.
- A fixture iam_database_context_key_baseline.sql é reduzida e serve apenas à migration incremental. Não é a baseline canônica.
- A migration incremental 0001_context_key_hardening.sql e a migration proposta 0001_initial_iam_schema.sql compartilham o identificador 0001 e pressupõem estados diferentes. A sequência canônica deve ser decidida antes de integração.
- Não ler nem versionar secrets, chaves HMAC, hashes, JWTs, payloads ou linhas reais de negócio.
- Não aplicar migration, DDL, GRANT, seed ou alteração de dados em Neon persistente/Production como parte destes testes.


### Drift detectado na comparação fonte × dump

- Neon canônico (consulta de catálogo read-only em 2026-11-08): app_private.current_tenant_id() é SECURITY DEFINER, owner iam_owner, search_path=pg_catalog, app_private, iam.
- Dump versionado atual: a mesma função ainda declara search_path=pg_catalog, app_private, iam, public.
- O restore contract agora exige a configuração endurecida exata e deve falhar até que o dump seja regenerado da fonte canônica aprovada.
- Não editar o dump manualmente nem atribuir PASS ao restore anterior como prova de equivalência. O PASS anterior só validou a versão histórica do artefato e os objetos que aquele teste verificava.


## Atualização de semântica do contexto — 2026-11-08

O primeiro CI do contrato dinâmico no SHA anterior falhou no caso de assinatura adulterada porque o teste tentou validar a ausência de contexto depois de já ter estabelecido um contexto válido para tenant A. Em PostgreSQL, quando a chamada que altera GUCs transaction-local termina com exceção e a exceção é capturada pelo chamador, os efeitos da instrução com erro são revertidos; o contexto válido anterior pode permanecer ativo.

O teste foi corrigido para chamar iam.clear_tenant_context() e confirmar estado vazio antes de testar assinatura adulterada, expiração e TTL acima de 300 segundos. O novo SHA precisa passar o restore + runtime RLS para que esses casos sejam PASS.

**Implicação operacional:** o consumidor deve iniciar a operação de contexto em estado limpo. Se capturar uma exceção de iam.set_tenant_context() dentro da mesma transação, deve abortar a transação ou chamar iam.clear_tenant_context() antes de continuar; não deve presumir que a tentativa inválida removeu um contexto válido anterior. A tentativa inválida não deve ser usada como mecanismo de troca de tenant.

Replay de nonce continua PENDING: o payload inclui nonce, mas o contrato atual não demonstra persistência/consumo único do nonce nem rejeição de replay. Não afirmar proteção anti-replay até existir implementação e teste concorrente apropriados.


## Resultado de restore e comparação com a origem — 2026-11-08

No SHA 51f9098a5a8b8506fae05909c9e289b799fea97a:
- CI quality: SUCCESS.
- postgres-18-schema-contract: SUCCESS.
- postgres-18-source-schema-restore: FAILURE no contrato catalog.

O erro foi reproduzido no restore descartável: o dump contém app_private.current_tenant_id() como SECURITY DEFINER, owner iam_owner, porém com search_path pg_catalog, app_private, iam, public. O contrato exige a configuração pós-hardening sem public.

Consulta read-only atual à fonte Neon canônica confirmou app_private.current_tenant_id() SECURITY DEFINER, owner iam_owner e search_path=pg_catalog, app_private, iam. Portanto, a origem está hardened e o arquivo iam_database_schema.sql versionado está desatualizado; não corrigir o dump por edição manual nem declarar equivalência. É necessário regenerar o dump com pg_dump 18 autenticado contra a fonte allowlisted, preservar checksum/manifesto, restaurar novamente e comparar objeto-a-objeto.

O workflow neon-schema-export está configurado apenas para push em main e o Environment neon-schema-export/deployment branch policy não foi verificado por ferramenta disponível nesta sessão. Não foi executado export autenticado nesta rodada. O gate de baseline permanece BLOCKED até existir artefato exportado da fonte, com provenance e checksum verificáveis.


## Resultado de CI — 2026-11-08 (HEAD 51f9098a5a8b8506fae05909c9e289b799fea97a)

- CI run 42460672899: quality SUCCESS no HEAD da PR; preview-deployment e auth0-e2e SKIPPED.
- Database run 42460672895: postgres-18-schema-contract SUCCESS; postgres-18-source-schema-restore FAILURE.
- Causa exata: o restore restaurou 23 tabelas, 1 view, 9 funções, 7 enums, 12 triggers, 41 policies, 63 índices, 20 tabelas com RLS/FORCE RLS, ownership e pgcrypto; porém app_private.current_tenant_id() no dump foi restaurada com config search_path=pg_catalog, app_private, iam, public, enquanto o catálogo Neon atual confirma search_path=pg_catalog, app_private, iam. O novo gate falhou corretamente e bloqueou o contrato dinâmico seguinte.
- O primeiro run do contrato dinâmico (42460479806) falhou no caso de assinatura adulterada porque os casos estavam agrupados em um único bloco DO. A implementação foi separada em DOs independentes; ainda não há execução verde do contrato dinâmico, pois o restore agora falha antes de invocá-lo.
- Estado: catálogo/restore atual BLOCKED por drift real do dump; contrato dinâmico ADDED / NOT YET EXECUTED; não declarar PASS.
- Próximo passo seguro: export autenticado via workflow aprovado da fonte Neon canônica, regenerar artefato sem edição manual, validar checksum e comparação objeto-a-objeto; depois reexecutar restore e contrato runtime.


### Precisão da instrumentação do lock

O teste registra A_LOCK_RELEASE imediatamente antes do COMMIT de A e B_LOCK_ACQUIRED depois de a sessão B retornar de pg_advisory_xact_lock. Não comparar o timestamp de um SELECT executado depois do COMMIT de A com B_LOCK_ACQUIRED: a sessão B pode acordar e adquirir o lock antes que A execute esse SELECT pós-commit, embora o COMMIT tenha necessariamente liberado o lock. A semântica transacional de pg_advisory_xact_lock, o evento A_LOCK_RELEASE anterior ao COMMIT, o evento B_LOCK_ACQUIRED posterior e o tempo de bloqueio comprovam a contenção sem essa corrida de observabilidade.
