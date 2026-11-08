# Matriz de testes da arquitetura IAM PostgreSQL

**Status:** EM VALIDAÇÃO — contrato dinâmico adicionado ao job de restore PostgreSQL 18; ainda depende de CI no HEAD atualizado.
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
| Restore estrutural | database/tests/restore-source-schema.sh | PostgreSQL 18 descartável; 23 tabelas, 1 view, 9 funções, 7 enums, 12 triggers, 41 policies, 20 tabelas RLS+FORCE, owners, pgcrypto e zero linhas de aplicação | PASS histórico no SHA 69834cc95df9b5b072d350798ad07f0288ce7c78; reexecutar após alterações |
| Contexto válido | database/tests/runtime-rls-contract.sql | HMAC válido e contexto resolvido para tenant A/B | ADICIONADO; CI pendente |
| Ausência de contexto | mesmo arquivo | SELECT de tenants, memberships e identities retorna zero linhas como runtime | ADICIONADO; CI pendente |
| Isolamento cross-tenant | mesmo arquivo | Tenant A vê apenas A; tenant B vê apenas B; identities filtradas pela membership | ADICIONADO; CI pendente |
| Escrita cross-tenant | mesmo arquivo | INSERT em organizations com tenant divergente é rejeitado por RLS/WITH CHECK | ADICIONADO; CI pendente |
| Assinatura adulterada | mesmo arquivo | assinatura inválida é rejeitada e o contexto permanece limpo | ADICIONADO; CI pendente |
| Expiração | mesmo arquivo | contexto expirado e validade superior a 300 segundos são rejeitados | ADICIONADO; CI pendente |
| Roles e memberships | database/tests/run.sh, role-assumption-contract.sql | atributos administrativos, arestas SET/INHERIT/ADMIN, fronteira owner, bootstrap lockout e cenários negativos antes de DDL | PASS histórico no SHA 71c17ae648521b3f3b5d73689e756e981f6f9bfd; conferir SHA atual após novo CI |
| Migration incremental | migration 0001_context_key_hardening.sql e 0001_schema_contract.sql | preflight, índice parcial, SECURITY DEFINER/search_path, ledger, checksum/source SHA e rollback de fixtures | PASS histórico no SHA acima; lineage permanece BLOCKED |
| Concorrência do lock | duas sessões psql independentes | PIDs distintos; sessão B aguarda A; T_B_attempt < T_A_commit < T_B_acquired; ledger final sem entrada de migration de teste | PENDING — evidência independente ainda não registrada |
| Idempotência/checksum | runner de migration | mesma migration/checksum não duplica ledger; checksum divergente deve falhar fechado | Cobertura parcial; reforçar com testes explícitos |
| Estado de membership/identity/tenant | contrato de contexto | membership, identidade ou tenant inativos devem invalidar o contexto | PENDING no novo contrato dinâmico |
| Chave HMAC | contrato de contexto | ausência de chave ativa, chave curta, rotação e múltiplas chaves ativas | Parcial: constraint e índice único são verificados; comportamento de rotação/ausência deve ser testado |
| Auth0/OIDC | E2E externo | issuer, audience, assinatura/JWKS, expiração, claims namespaced e falhas de login/session | PENDING; jobs Auth0 E2E anteriores foram SKIPPED |

## Protocolo de concorrência obrigatório

Executar em uma branch Neon descartável ou PostgreSQL descartável com dois clientes independentes, nunca numa única conexão serializada:

- Sessão A: BEGIN, SET LOCAL ROLE iam_migrator, registrar PID e instante, adquirir iam.acquire_migration_lock(), aguardar e confirmar.
- Sessão B: iniciar depois de A, registrar PID/instante antes de chamar a mesma função; deve ficar bloqueada até A confirmar.
- Evidência: PIDs distintos; A adquiriu antes de B; B só adquiriu depois do COMMIT de A; ambas as transações encerraram; ledger permaneceu inalterado.
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
