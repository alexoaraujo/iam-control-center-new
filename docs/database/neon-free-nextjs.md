# Neon PostgreSQL Free + Next.js — integração, migrations e segurança

**Estado:** desenho técnico para implementação controlada. A aplicação ainda não possui integração Neon funcional no runtime; este guia não afirma que o driver esteja instalado ou que uma consulta tenha sido executada.
**Plano:** Neon Free. **Runtime:** Next.js 16.4.3 / Node.js 24.x / TypeScript.

## 1. Arquitetura

- Neon fornece PostgreSQL gerenciado.
- Next.js executa consultas exclusivamente em módulos server-side.
- Para tráfego serverless frequente, usar connection string pooled (hostname com -pooler).
- Para migrations, psql, pg_dump ou operações que exigem conexão/session dedicada, usar endpoint direto.
- Role runtime deve ter privilégios mínimos, sem superuser, sem ownership das tabelas e BYPASSRLS=false.
- Credenciais administrativas nunca entram no runtime.
- Browser nunca recebe DATABASE_URL ou DIRECT_URL.

## 2. Projeto e branches Neon Free

1. Criar/selecionar projeto e região próxima do runtime.
2. Criar branches não produtivas para desenvolvimento, revisão e teste; respeitar limite Free de até 10 branches por projeto.
3. No botão Connect, selecionar branch, database e role corretos.
4. Copiar separadamente endpoint pooled e direto.
5. Guardar connection strings como secrets.
6. Registrar branch ID, hostname não secreto, região, versão PostgreSQL e data.

Nunca testar migrations, RLS, grants ou seeds em branch Production.

## 3. Variáveis

| Variável | Uso | Segredo |
|---|---|---:|
| DATABASE_URL | endpoint pooled para aplicação | sim |
| DIRECT_URL | endpoint direto para migrations controladas | sim |

Exemplo sem credenciais reais:

    DATABASE_URL="postgresql://APP_ROLE:REDACTED@HOST-pooler.REGION.aws.neon.tech/DB?sslmode=require"
    DIRECT_URL="postgresql://MIGRATION_ROLE:REDACTED@HOST.REGION.aws.neon.tech/DB?sslmode=require"

DATABASE_URL usa role runtime e endpoint pooled. DIRECT_URL usa credencial de migration controlada e endpoint direto. Não usar neondb_owner/administrador como credencial da aplicação. Rotacionar imediatamente credenciais expostas.

## 4. Driver serverless

O driver mínimo recomendado para consultas SQL no Next.js é @neondatabase/serverless. Ele não constava em apps/web/package.json na inspeção de 31/10/2026. Instalar somente em commit próprio, com lockfile, audit e CI atualizados:

    pnpm --filter @iam-control-center/web add @neondatabase/serverless

Módulo proposto apps/web/src/lib/db.ts:

    import "server-only";
    import { neon } from "@neondatabase/serverless";

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not configured");
    }
    export const sql = neon(connectionString);

Consulta parametrizada:

    import { sql } from "@/lib/db";

    export async function findUserByIssuerAndSubject(
      issuer: string,
      subject: string,
    ) {
      const rows = await sql`
        select id, issuer, subject, email
        from iam.users
        where issuer = ${issuer}
          and subject = ${subject}
        limit 1
      `;
      return rows[0] ?? null;
    }

Regras:
- Tagged template do driver para parametrização; nunca concatenar entrada de usuário em SQL.
- Importar db.ts somente em Server Components, Route Handlers ou Server Actions.
- Nunca importar em componente "use client".
- Retornar somente colunas necessárias.
- Não registrar tokens OIDC, cookies ou secrets.
- Avaliar limites transacionais/prepared statements do driver HTTP antes de operações multi-step. Para semântica de sessão/transação não suportada pelo endpoint HTTP, usar cliente PostgreSQL compatível com conexão direta e runtime Node.
- Exemplo não substitui camada de repositório nem autorização por tenant.

## 5. Pooling e Vercel

Usar endpoint pooled com -pooler no hostname para workloads serverless. O pooler opera em transaction mode; não depender de estado de sessão entre requisições. Não assumir que driver HTTP equivale a conexão PostgreSQL TCP persistente. Validar compatibilidade de cada ORM, migration runner e operação transacional.

Usar endpoint direto para migrations e tarefas administrativas que precisem de conexão dedicada. DIRECT_URL nunca deve ser usado em requisições comuns.

## 6. Autenticação e autorização multi-tenant

Fluxo requerido por requisição:

1. Validar sessão Auth0 no servidor.
2. Extrair iss e sub de sessão/token validado.
3. Resolver usuário local por (issuer, subject).
4. Resolver membership ativo do usuário no tenant solicitado.
5. Verificar permission e escopo do recurso.
6. Definir contexto de tenant confiável no limite da transação/conexão.
7. Consultar/alterar dados com filtros de tenant e RLS como defesa em profundidade.
8. Registrar auditoria para ações sensíveis.

Não derivar tenant de e-mail, domínio de e-mail, query param, header arbitrário ou metadata editável. Não confiar em tenant_id enviado pelo browser.

### Bloqueio: GUC falsificável

A migration atual usa app.tenant_id (custom PostgreSQL setting) como contexto de RLS. Uma sessão SQL normal pode alterar um custom GUC; portanto, uma role que execute SQL arbitrário pode tentar definir outro tenant. FORCE ROW LEVEL SECURITY não transforma o GUC em identidade criptograficamente confiável.

**Não declarar isolamento forte com base apenas em SET app.tenant_id ou set_config('app.tenant_id', ...).** A RFC docs/architecture/tenant-context-rfc.md propõe contexto assinado e verificado no banco, mas ainda é proposta. Exige revisão, rotação de chave, privilégio EXECUTE mínimo, proteção contra replay/forja, escopo transacional e testes de abuso.

## 7. Roles e grants

Separar:
- owner/migration: apenas migrations aprovadas; nunca runtime;
- runtime: LOGIN, NOBYPASSRLS, não superuser, sem ownership;
- teste: sem BYPASSRLS e com grants equivalentes ao runtime;
- role administrativa Neon: operacional, nunca credencial da aplicação.

Auditoria somente em branch isolada:

    select rolname, rolsuper, rolbypassrls, rolcanlogin
    from pg_roles
    where rolname in ('iam_app_runtime', 'iam_app_runtime_dev_safe');

    select schemaname, tablename, rowsecurity, forcerowsecurity
    from pg_tables
    where schemaname = 'iam'
    order by tablename;

Verificar também pg_class.relowner, grants de tabelas/sequences/schema, pg_policies, funções SECURITY DEFINER, search_path fixo e EXECUTE. rolbypassrls deve ser false para runtime. Não usar owner ou role BYPASSRLS para comprovar isolamento.

## 8. Migrations

Migrations versionadas em database/migrations. A migration inicial é destinada a database limpo; não é script de reset e não deve ser aplicada sobre objetos existentes.

Fluxo, após autorização de branch descartável:
1. Criar branch Neon isolada a partir de Development, nunca Production.
2. Confirmar schema vazio ou precondições documentadas.
3. Revisar SQL, locks, índices, FKs e RLS.
4. Fazer backup lógico quando houver dados.
5. Executar com role migration e endpoint direto.
6. Registrar versão, checksum, timestamp, branch e resultado em ledger.
7. Inspecionar schema, grants, policies, FORCE RLS e constraints.
8. Executar testes positivos/negativos com login real da role runtime.
9. Testar recuperação numa branch descartável.
10. Guardar logs sem credenciais e vincular evidência ao SHA.

Exemplo **somente depois de revisão e autorização explícita do alvo**:

    psql "$DIRECT_URL" -v ON_ERROR_STOP=1 \
      -f database/migrations/0001_initial_iam_schema.sql

Não executar automaticamente migrations no build/deploy Vercel. O mecanismo efetivo de checksum/ledger e a política de rollback/forward-fix ainda precisam ser implementados; iam.schema_migrations vazia nas branches inspecionadas não prova que migrations foram aplicadas.

## 9. Testes de isolamento

Somente em branch de teste descartável e role runtime sem BYPASSRLS:
- Tenant A lê seus registros.
- Tenant A não lê, atualiza ou exclui registros de B.
- Ausência de contexto confiável resulta em negação/falha segura.
- Tenant ID forjado pelo cliente não muda contexto do banco.
- Alterar diretamente app.tenant_id não concede acesso ao outro tenant.
- Usuário sem membership ou com membership suspenso/revogado não acessa tenant.
- Runtime não altera catálogo de permissions, roles globais ou grants administrativos.
- Requisições concorrentes não vazam contexto entre tenants.

Guardar casos, resultados e SHA. Se não for possível autenticar como role runtime real, classificar BLOCKED; não substituir por role administrativa.

## 10. Limites Free e recuperação

Monitorar CU-hours, storage por projeto e agregado, transferência pública, branches, scale-to-zero e cold start. Cotas Free não são SLA. Manter backup lógico independente e testar restore; o histórico limitado do Free não é estratégia única de recuperação.

## 11. Estado verificado em 31/10/2026

- @neondatabase/serverless não constava das dependências.
- DATABASE_URL aparece no .env.example, mas não comprova conectividade.
- /api/health verifica presença de variáveis, não abre conexão PostgreSQL.
- Development não tinha tabelas IAM nem iam.schema_migrations.
- Branches review/test tinham tabelas e RLS enabled/forced, mas ledger iam.schema_migrations vazio.
- Não foi possível selecionar a role efetiva de runtime no conector Neon; roles de teste com BYPASSRLS=true não provam isolamento.
- Nenhuma migration foi executada.
- Production não foi consultada nem modificada.

**Resultado:** integração runtime, migrations aplicadas, grants efetivos e isolamento tenant-to-tenant permanecem pendentes/bloqueados.

## Referências oficiais

- https://neon.com/docs/get-started/connect-neon
- https://neon.com/docs/connect/connection-pooling
- https://neon.com/docs/guides/serverless-connection-pooling
- https://neon.com/docs/introduction/plans
- https://github.com/neondatabase/serverless
- https://www.postgresql.org/docs/current/ddl-rowsecurity.html
