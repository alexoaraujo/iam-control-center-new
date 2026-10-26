# Evidência — protótipo de capability tenant assinada

- Data: 2026-10-26
- Repositório: alexoaraujo83/iam-control-center
- PR: https://github.com/alexoaraujo83/iam-control-center/pull/30 (Draft; não mesclado)
- Branch de trabalho: proposal/initial-iam-schema
- SHA executado pelo CI: 3c8d9fe6c517c4a0e13136e8d036c282b89fec4a
- Workflow: https://github.com/alexoaraujo83/iam-control-center/actions/runs/40405899048
- Conclusão do workflow: **success**
- Horário do run em UTC: início 2026-10-26 21:37:21Z; atualização/conclusão 2026-10-26 21:38:41Z
- Arquivo SQL testado: database/proposals/0001-initial-iam-schema.sql
- SHA-256 do arquivo SQL emitido pelo runner: ce5c19398334c22564858994eab50773c15f8ffc7b3686a7a2ec865678ad01c3
- PostgreSQL: serviço descartável PostgreSQL 18 em GitHub Actions
- Banco alvo dos testes: iam_migration_test / iam_migration_failure_test, criados no container CI
- Dados de teste: fixtures artificiais Tenant A/Tenant B; chave HMAC exclusiva do teste, sem reutilização em produção

## Conclusões verificadas no SHA registrado

O job \`quality\` concluiu com sucesso nas etapas de dependency audit, lint, typecheck, testes existentes, teste SQL de proposta e build. O job \`preview-deployment\` também terminou com sucesso ao verificar status Vercel Preview.

Logs de \`Test proposed database schema in disposable PostgreSQL\` registram explicitamente:
- \`SIGNED CONTEXT TESTS PASSED: HMAC tampering/expiry and plain-GUC spoof are denied.\`
- Alterar \`app.tenant_id\` para tenant B mantendo uma capability assinada de tenant A não mudou o escopo para B.
- O runtime não conseguiu ler \`app_private.tenant_context_keys\`, \`iam.identities\` ou executar DDL.
- O INSERT de auditoria para outro tenant foi recusado por RLS.
- Checksum divergente foi recusado.
- Falha DDL induzida fez rollback integral.
- O SQL candidato original foi reaplicado após a falha e gerou uma única linha no ledger.

O checksum acima foi calculado pelo runner sobre os bytes do SQL candidato; não é checksum de uma migration histórica. Os SQL originais das versões históricas 0001/0002 continuam não recuperados.

## Limites da evidência

Esta evidência comprova somente o protótipo SQL e seus testes no serviço PostgreSQL descartável no SHA indicado. Ela **não** comprova:
- que a aplicação Auth0/Next.js já emite capabilities HMAC;
- que o segredo de produção esteja provisionado/rotacionado no Neon e nas variáveis server-side;
- que a capability de identidade e o bootstrap/descoberta de tenants funcionem;
- que a membership seja resolvida/atualizada corretamente em requisições reais ou após revogação;
- que uma credencial runtime real conecte ao Neon e tenha os privilégios esperados;
- que o schema da proposta esteja aplicado em Production, Development ou Preview;
- que o status Vercel Preview prove conectividade ou isolamento do PostgreSQL.

## Próximos gates

- [ ] Revisão de segurança do \`SECURITY DEFINER\` verifier, owner, \`search_path\`, grants e tratamento de erros.
- [ ] Aprovar contrato da capability e TTL/revogação.
- [ ] Implementar emissor de capability no backend após validar OIDC e membership.
- [ ] Projetar/testar capability de identidade para bootstrap e descoberta sem aceitar identity id arbitrário.
- [ ] Definir bootstrap, armazenamento e rotação da chave real sem imprimir segredos em logs.
- [ ] Testar com credencial runtime real num branch Neon isolado e comparar schema.
- [ ] Aprovar migration versionada antes de qualquer aplicação em Development; Production exige aprovação separada.

**Classificação:** CI do protótipo descartável **PASS** para o SHA registrado; readiness de migration/Neon/Auth0 permanece **BLOCKED**. Nenhum banco Neon compartilhado foi alterado durante estes testes.
