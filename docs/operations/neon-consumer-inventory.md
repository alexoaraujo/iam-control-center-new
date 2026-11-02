# Inventário de consumidores PostgreSQL — Etapa A

**Status:** INSPEÇÃO READ-ONLY CONCLUÍDA / NÃO IMPLEMENTADO  
**Projeto:** IAM Control Center  
**Repositório:** `alexoaraujo83/iam-control-center`  
**Branch da proposta:** `proposal/pooler-runtime-migration-isolation`  
**Commit de referência da proposta:** `1c9ea1357d49866f9e56c9f165e9b6367a961640`  
**Data:** 2026-11-02

## 1. Resultado executivo

A aplicação web ainda não possui um consumidor PostgreSQL implementado e identificável nos manifests inspecionados. O pacote `apps/web` declara Next.js, React e Auth0 SDK, mas não declara diretamente driver PostgreSQL nem ORM (por exemplo, `pg`, Prisma ou Drizzle). Os scripts de pacote não incluem comandos de migration.

`DATABASE_URL` aparece no scaffold apenas como variável cuja presença é verificada pelo endpoint de health. Essa verificação não abre conexão, não valida TLS, não executa consulta e não comprova acesso ao Neon.

`DATABASE_MIGRATION_URL` não aparece nos arquivos de aplicação, manifest, exemplo de ambiente ou workflow de qualidade inspecionados. A busca de código do conector GitHub consulta a branch padrão; por isso, a ausência em resultados de busca não é tratada isoladamente como prova exaustiva para todas as branches. Nos arquivos diretamente buscados na branch desta proposta, não foi encontrado consumidor dessa variável fora do texto documental da proposta.

**Conclusão:** não há base técnica para ativar pooler ou escolher parâmetros de compatibilidade PgBouncer neste momento. Primeiro é necessário decidir e implementar um driver/ORM e seu ciclo de conexão; depois validar o modo de pooling suportado por esse cliente.

## 2. Evidências por arquivo

| Arquivo | Blob SHA | Observação |
|---|---|---|
| `package.json` | `03f5f43a1cc759f8879b58abcb2409923d5b4a74` | Scripts raiz apenas delegam dev/build/lint/typecheck/test; nenhum script de migration. |
| `apps/web/package.json` | `3e2055f334dae6d6ce07a24c607916e2e20dd659` | Dependências diretas: `@auth0/nextjs-auth0`, `next`, `react`, `react-dom`; sem driver PostgreSQL ou ORM declarado. |
| `apps/web/src/lib/env.ts` | `34b6905088aabb57234d3faaad455fa37dd15a6a` | `DATABASE_URL` é consultada apenas por `isConfigured(...)`; não há cliente/conexão. |
| `apps/web/src/app/api/health/route.ts` | `7b3de43dc51295609131e553549b89ba4f97e261` | Health expõe indicador de configuração; não executa query nem verifica conectividade. |
| `.env.example` | `4a1886ed4377a987d94af1a5cf2db423d33a9f97` | Contém `DATABASE_URL=`; não contém `DATABASE_MIGRATION_URL`. |
| `pnpm-workspace.yaml` | `e9b0dad63bacd2aa6865fcb9b7e86ad630964730` | Workspace inclui `apps/*` e `packages/*`. |
| `pnpm-lock.yaml` | `a4a5a4998663496d33b5449e286998da465d3872` | Importer `apps/web` lista Auth0/Next/React; sem dependência direta de driver/ORM no importer. |
| `database/migrations/README.md` | `8a2cb2a8a3fac04f0a805b838c10ae51619f3c79` | Define sequência de revisão/testes; não documenta um executor implementado. |
| `database/migrations/0001_initial_iam_schema.sql` | `97aad3ef36ca5638c79128fa0a2a47a309824989` | SQL versionado; arquivo SQL por si só não comprova ferramenta ou execução de migrations. |
| `.github/workflows/quality.yml` | `cc5c57e68058bdf1e0088610163c0f25534063d7` | CI executa install/audit/lint/typecheck/test/build; não declara serviço PostgreSQL. |
| `.github/workflows/neon-review-role-verification.yml` | `e132f9a2449a44a1dcd66a535b68b46ca8cf90e3` | Workflow manual separado para verificação read-only de role/RLS em branch de revisão allowlisted; não executa migrations e não implementa `DATABASE_MIGRATION_URL`. |

## 3. Mapa atual de consumidores

| Consumidor | Variável | Estado verificado | Resultado |
|---|---|---|---|
| Health endpoint Next.js | `DATABASE_URL` | Verifica apenas string não vazia | CONFIGURATION CHECK ONLY |
| Cliente PostgreSQL no runtime web | `DATABASE_URL` | Nenhum driver/ORM direto identificado no manifest da aplicação | NOT IMPLEMENTED |
| Executor de migrations | `DATABASE_MIGRATION_URL` | Nenhum executor ou script identificado nos arquivos inspecionados | NOT IMPLEMENTED |
| CI de qualidade | PostgreSQL descartável | Workflow não declara serviço PostgreSQL | NOT CONFIGURED |
| Workflow de verificação Neon | `NEON_REVIEW_DATABASE_URL` | Usa psql para checks de role/RLS em branch de revisão específica; não é executor de migrations | SEPARATE REVIEW CHECK |

## 4. Implicações para pooling

Não é possível concluir compatibilidade com PgBouncer em modo transacional sem identificar o cliente efetivo e testar seus comportamentos. Antes de habilitar pooler em Development/Preview, a implementação deverá declarar:

1. driver/ORM e versão efetivamente instalados;
2. configuração TLS e política de timeout/retry;
3. uso ou não de prepared statements nomeados;
4. uso ou não de estado de sessão, `SET`, advisory locks, temporary tables ou listeners;
5. estratégia de pool no runtime serverless e limites de conexões;
6. teste de integração repetido contra endpoint pooled de Development, sem credencial de owner.

Não habilitar pooler com base apenas na decisão arquitetural. O pooler permanece desabilitado conforme a evidência operacional anterior.

## 5. Próximas ações revisáveis

1. Definir e aprovar o driver/ORM a ser usado pela aplicação (sem adicionar dependência nesta etapa documental).
2. Implementar um módulo server-only de conexão que consuma exclusivamente `DATABASE_URL`.
3. Criar testes com PostgreSQL descartável no CI antes de conectar qualquer ambiente Neon.
4. Definir executor de migrations separado, com `DATABASE_MIGRATION_URL` em segredo de ambiente protegido dedicado e sem exposição ao Vercel/runtime/PR.
5. Somente após testes de compatibilidade, habilitar pooler em Development e depois Preview mediante autorização específica.
6. Manter Production fora do escopo.

## 6. Limites e não execução

- Nenhuma dependência foi instalada ou alterada.
- Nenhum código de runtime ou workflow foi modificado.
- Nenhuma variável ou secret foi lido/descriptografado, criado, removido ou alterado.
- Nenhuma conexão de aplicação ao Neon foi aberta.
- Nenhuma migration ou SQL de escrita foi executado.
- Nenhum pooler, role, endpoint, Auth0 ou configuração Vercel foi alterado.
- Nenhum deploy Production foi realizado.

## 7. Critérios de aceite da Etapa A

A etapa de inventário está documentalmente concluída para os arquivos e manifests listados acima. A confirmação de um consumidor PostgreSQL real permanece **PENDING**, pois ele ainda não está implementado. A compatibilidade PgBouncer permanece **NOT TESTED**. A configuração de PostgreSQL efêmero no CI permanece **NOT CONFIGURED**.
