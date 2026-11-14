# PEOS G1 — Inventário de roles e recuperação: pré-validação offline

**Estado: REVIEW ONLY.** Esta alteração não é migration, não substitui a PR #69, não implementa `GRANT`, `REVOKE`, `ALTER ROLE`, `pg_dump`, restore ou aprovação de Production.

## Escopo fechado

- Projeto NEW autorizado: `tiny-rice-70320263`; origem NEW Development `br-ancient-term-b6mmx5ol`, banco `iam_database`.
- Destino de ensaio: child `br-sweet-union-b6j80a7j`, banco **`iam_canonical_validation`**, vazio. Não alterar `iam_database` herdado na child nem Production.
- O projeto legado cross-org `twilight-fire-88497009` é apenas histórico e está excluído do workflow operacional. A validade do destino é reavaliada antes de cada operação; branch tem TTL.
- Seguir `docs/operations/iam-canonical-isolated-workflow-runbook.md` e `database/bootstrap/0000_iam_roles.sql` como referências para os guardrails, sem aplicar automaticamente scripts de bootstrap.

## O que foi implementado

Ferramenta **offline e sem conexão**:
`node database/offline/g1-readiness-report.mjs /caminho/restrito/inventario-sanitizado.json`

O JSON usa `format: "peos/g1-catalog-observation/v1"`, os IDs de projeto e branch permitidos, três roles LOGIN e quatro memberships esperadas de cada lado, contagens do reader, estado vazio do destino (inclusive relações de usuário fora dos schemas IAM) e hashes SHA-256 externos para o catálogo `iam_database` na SOURCE e no banco `iam_database` **herdado** pela branch TARGET (chaves `catalog_sha256.source` e `catalog_sha256.inherited_shadow`). **Não comparar hashes de schema da origem com o banco isolado vazio `iam_canonical_validation`: os objetos não deveriam ser iguais antes do restore.** Nunca incluir URI de conexão, dados pessoais, senhas, JWT, chaves ou dumps no JSON.

A ferramenta rejeita troca de projetos, Production, banco herdado, `BYPASSRLS`, `SET ROLE` excessivo, grants administrativos, principals extras, falta de `MAINTAIN`/schema `USAGE`, `SELECT`/DML extra, origem com ledger inesperado, destino não vazio e hashes malformados/divergentes.

**Limitação deliberada:** o documento JSON é **não confiável**. Os hashes recebidos (source versus inherited-shadow, ambos `iam_database`) não são calculados nem autenticados pelo script; a leitura do catálogo precisa ter evidência independente de TLS, role, origem, integridade, ownership, ACL e aprovação. O script **nunca** emite `PASS` operacional, mesmo se toda a entrada parecer conforme; estado máximo `INDEPENDENT_REVIEW_REQUIRED`; CLI sempre encerra com código 2. Isso impede usar artificialmente a ferramenta como gate de liberação.

Teste offline, independente de secrets e Neon:
`node --test database/offline/g1-readiness-report.test.mjs`

`database/tests/run.sh` chama o teste em CI PostgreSQL 18. Os arquivos estão sob `database/**`, sem exigir novo deploy Vercel nem habilitar Auth0 Preview por mudança de `scripts/**`.

## Ordem dos gates, sem atalhos

1. **PR #69:** revisar a topologia canônica das roles `LOGIN/INHERIT/SET/ADMIN` em ambas as branches, privilegiando o contrato NEW. Mudanças de roles são branch-wide. A revisão do código existente não aprova mutação no Neon.
2. **Manifesto e ledger:** completar proveniência autenticada da NEW Development, ACLs literais, owner, SECURITY DEFINER, RLS/FORCE, views, sequências, objetos e SHA-256. O ledger NEW tem zero registros; **não fabricar** o registro histórico da origem legada.
3. **Recuperação:** antes de qualquer DDL/GRANT, obter ponto de backup recuperável e ensaiar restore e rollback pós-COMMIT em clone recém-aprovado com TTL, revisores e comprovação em nova sessão; 6 horas de history retention não são prova de backup.
4. **Exportação:** avaliar risco de `MAINTAIN` (não é somente lock ACCESS SHARE); apenas no ambiente autorizado considerar lease temporário de `MAINTAIN 23/23` e `USAGE 3/3`, sem `SELECT`, DML ou `BYPASSRLS`, com revogação e pós-teste. Então `readiness_only`, export PostgreSQL 18 e restore isolado sob aprovações independentes.
5. **GitHub:** ruleset `protect-main` exige `quality` e `security-gate`. Este último ainda não é emitido no SHA da PR #69 e existe na PR #41; sem concatenação de PRs ou `SKIPPED=PASS`. Qualquer alteração exige novos checks no novo SHA e revisão independente.
6. **API/frontend:** continuar somente após G1, RLS A/B, rollback e autorização HTTP 200 após grant → 403 após revoke no SHA/Preview/branch corretos, preservando Production até release formal.

**STOP:** branch/DB fora do escopo, segredo exposto, executor sem prova, drift não justificado, destino não vazio, expiração de branch, recuperação ausente, teste omitido, check obrigatório faltando ou aprovação de mudança não registrada. Nenhum sucesso sintético pode ser promovido a sucesso operacional.
