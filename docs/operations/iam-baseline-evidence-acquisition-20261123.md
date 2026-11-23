# PEOS G2 — aquisição autenticada de evidências (fixture PG18)

Esta etapa testa o coletor por autenticação real de uma role dedicada, em um
serviço PostgreSQL 18 local descartável. Nenhum modo Neon existe. A coleta
usa uma única transação REPEATABLE READ READ ONLY, com identidade da sessão,
versão, isolamento e backend conferidos; usa a query de catálogo já integrada,
e lê somente as cinco colunas do ledger canônico. Ledger ausente é null,
ledger vazio é uma lista vazia; formato clean-proposal e permissões faltantes
bloqueiam. Não há leitura de registros de negócio, assinatura ou autorização.

Os arquivos session.json, schema-manifest.json, ledger.json e index.json
ficam em diretório novo 0700 e arquivos 0600, com hashes dos bytes originais.
Nunca publicar manifest/ledger ou credenciais nos logs, PRs ou artefatos
públicos. Os testes usam dados sintéticos e removem o diretório e a role.
A conexão local não usa TLS porque é uma fixture; não extrapolar isso a Neon.

## Readback real (23/11/2026)

Consulta administrativa somente leitura em iam_database, PG18.7, branch SQL
conferida, projeto tiny-rice-70320263:
- Development br-ancient-term-b6mmx5ol: iam_schema_export_reader LOGIN,
  NOINHERIT/NOSUPERUSER/NOBYPASSRLS/NOCREATEROLE/NOCREATEDB/NOREPLICATION,
  CONNECT sim, CREATE não; USAGE em iam e SELECT no ledger ausentes.
  Ledger existe. Não é uma prova de sessão autenticada do leitor.
- Production br-muddy-snow-b63cepcv: leitor e ledger ausentes.

Não conceder privilégios automaticamente. O futuro contrato live requer
aprovação independente de role/grants mínimos por branch, identidade real
e control-plane, conexão direta TLS verify-full, revisão de cobertura do
manifest, commit exato, custódia protegida e saída privada. Nenhuma senha ou
chave de assinatura compartilhada com o coletor. Coletor e revisor devem
assinar separadamente bytes do pacote validado por PR #176, com trust roots
aprovadas e recuperação/lease verificadas independentemente. O coletor fixture
não produz evidência aceitável como aquisição de Development/Production.

Production, G3, execução de migrations, ledger backfill e nova lease HOLD.

## Incremento de preflight — 23/11/2026

`database/scripts/iam-collector-reader-preflight.sql` é consulta exclusivamente
de catálogo: não concede privilégios, não lê ledger ou registros de negócio.
Retorna identidade da sessão inspetora, branch, versão, contrato estrutural do
ledger, flags da role e contagens de ACL. A projeção considera USAGE no schema
iam mesmo quando ausente, para detectar SECURITY DEFINER com EXECUTE já efetivo.
O preflight não comprova autenticação do leitor nem autoriza execução.

Readback administrativo no projeto tiny-rice-70320263, iam_database, PG18.7:
- Development br-ancient-term-b6mmx5ol: ledger presente=true; contrato estrutural=false; leitor LOGIN=true, memberships=0, USAGE IAM=false, SELECT ledger=false, outras relações=0, sequences=0, SECURITY DEFINER projetado=1.
- Production br-muddy-snow-b63cepcv: ledger presente=false; contrato estrutural=false; leitor ausente.
Development: a rotina iam.clear_tenant_context() é SECURITY DEFINER com EXECUTE
de PUBLIC; não há USAGE IAM para o leitor. Não aplicar GRANT de USAGE antes
de revisar dependências e ACL da rotina em fixture/clone aprovado. Não revogar
em ambiente permanente sem aprovação específica e teste de regressão.
A tentativa de login real do leitor não foi comprovada; nenhum grant, senha,
rotina ou role foi alterado no Neon.

O coletor fixture agora rejeita ACL em todas as relações de schemas de usuário
(exceto ledger), sequences e SECURITY DEFINER alcançáveis ou projetados em iam.
Os testes negativos criam apenas objetos sintéticos locais e comprovam rejeição
de PUBLIC EXECUTE, EXECUTE direto, SELECT de coluna fora de IAM e USAGE de
sequence; após remoção, coleta volta a funcionar.

### Contrato do futuro workflow protegido (ainda não implementado)
- Checkout confiável da main no SHA aprovado; sem código do HEAD de PR com secrets.
- Aprovação independente para target, role, privilégios e identidade do endpoint
  direto do Neon, sem pooler, com TLS verify-full e CA confiável.
- Reader com LOGIN NOINHERIT, sem memberships, DDL, escrita, acesso de negócio
  ou SECURITY DEFINER; CONNECT, USAGE e SELECT somente após revisão.
- Evidência privada, cifrada, SHA256 dos bytes; custódia de assinatura Ed25519
  separada entre coletor/revisor, sem chave privada no Git, Vercel ou logs.
- Não transformar relatório administrativo em evidência autenticada do leitor;
  validar sessão real, branch e snapshot, integrar ao pacote da PR #176.
- Production, G3, migrations, lease e ledger backfill continuam HOLD.
