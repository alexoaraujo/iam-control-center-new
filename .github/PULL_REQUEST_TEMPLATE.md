# PR — IAM Control Center NEW

## Escopo e rastreabilidade

- **Issues vinculadas (IAM-###):**
- **Tipo de mudança:** feature / fix / security / migration / infra / docs
- **Ambientes afetados:** development / preview / staging / production / nenhum
- **Commit SHA testado:**
- **Alterações e fora de escopo:**

## Critérios de engenharia

- [ ] Dependências e contrato de API/DB revisados, ou justificado N/A.
- [ ] Linters, tipagem, testes, build e testes de banco passaram no SHA exato, ou não se aplicam justificadamente.
- [ ] Testes negativos relevantes: 401/403, cross-tenant, ausência de contexto e falhas externas, ou justificado N/A.
- [ ] Foi provado que nenhum segredo, URL de conexão com senha, token, cookie ou dado pessoal foi registrado.
- [ ] Impacto em roles, grants, policies RLS, SECURITY DEFINER e migrations documentado, ou N/A.
- [ ] Mudança de funcionalidade possui documentação, critérios de aceite e evidências.

## Evidências obrigatórias

| Verificação | Run/URL | SHA/ambiente | Resultado (PASS / FAIL / SKIPPED / BLOCKED / N/A) |
|---|---|---|---|
| CI / lint / typecheck / unit / build | | | |
| PostgreSQL 18 / restore / RLS real | | | |
| Vercel Preview / exact SHA | | | |
| Auth0 E2E real / callback | | | |
| Segurança / revisão / auditoria | | | |

> SKIPPED ou ausência de execução não são PASS. Marque N/A somente com justificativa verificável.

## Plano de release e rollback

- **Gates aplicáveis:** G1 / G2 / G3 / G4
- **Pré-requisitos e bloqueadores:**
- **Mudanças incompatíveis / migração de dados:**
- **Rollback/recovery:**
- **Aprovador técnico / funcional:**

### Controle extra para Production

- [ ] A `main` está protegida; check e revisão obrigatórios verificáveis.
- [ ] Release baseia-se em deployment/commit aprovado e possui plano de reversão testado.
- [ ] Issue [#5 — Neon cutover](https://github.com/alexoaraujo/iam-control-center-new/issues/5) está resolvida e aprovada, caso haja alteração de banco/credenciais.
- [ ] Autorização explícita do responsável pelo ambiente de produção registrada.

**Política:** alterações de `DATABASE_URL` Production, DDL persistente ou cópia de dados entre organizações não são autorizadas por mera aprovação do PR. Exigem gate operacional e autorização próprios.