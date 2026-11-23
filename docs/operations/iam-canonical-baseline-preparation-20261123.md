# PEOS G2 — preparação offline da baseline canônica

## Objetivo e limites

O preparador verifica a integridade de um pacote de revisão e vincula os bytes da
evidência, SQL de catálogo, política e quatro migrations a um SHA declarado.
Ele NÃO coleta credenciais, conecta ao Neon, executa SQL, autoriza uma lease,
aprova baseline, cria ledger ou promove Production. A política real continua
`execution_authorized=false`, todos os candidatos `REVIEW_ONLY`.

## Contrato de evidência

- Evidência JSON: contrato da PR #173, manifest de schema e ledger por branch.
  Capture por conexão autenticada de leitura e guarde fora do repositório.
- Pacote: `iam-baseline-review-packet/v1`, scope `OFFLINE_REVIEW_ONLY`, SHA,
  project/database, timestamp UTC ISO (milissegundos), SHA-256 dos bytes da
  evidência, schema-manifest.sql e lineage-policy.json, inventário das quatro
  migrations (arquivo, hash original, hash do payload candidato).
- Duas assinaturas Ed25519 em base64 sobre os mesmos bytes exatos do pacote,
  collector/reviewer com chaves distintas. Trust JSON separado
  (`iam-baseline-review-trust/v1`) exige SHA esperado e fingerprints SHA-256
  dos SPKI DER das duas chaves públicas. A confiança fornecida pelo operador
  não é uma raiz aprovada: precisa de verificação independente. Nunca guardar
  chaves privadas ou evidência sensível no Git.
- Referência de recuperação: run IDs distintos backup/restore, SHA do archive,
  hash do manifest restaurado, branch de restore distinta do futuro clone,
  SHA, data e resultado declarado. O preparador NÃO valida runs ou artefatos
  remotamente; metadata assinada não é prova suficiente de recuperação.
- Lease: branch nova distinta de Development/Production e restore, parent
  Development, banco iam_database, SHA exato, created_at/expires_at UTC,
  janela máxima 24h, scope DISPOSABLE_REHEARSAL_REVIEW_ONLY. A assinatura
  não prova que a branch existe, que o TTL está ativo ou que houve aprovação.
- Captura e recuperação recentes (até 24h), sem datas futuras. Não reutilizar
  leases de G1/G3 ou restauração anterior como autorização de migration.

O executor retorna relatório BLOCKED (exit 1) mesmo com duas assinaturas válidas
e hash coincidente; dados inválidos exit 2. Não há modo execute ou status 0.

```sh
node database/offline/prepare-canonical-baseline.mjs packet.json evidence.json signatures.json trust.json
```

## Linhagem e transações

0001 é alternativa clean-install, não ancestral provado de 0002–0004.
0002 requer sessions e trigger original; 0003 exige definição canônica e
contexto; 0004 exige FORCE RLS, owner policy e ausência do writer. Todos dependem
da respectiva baseline/role graph, não de uma ordem numérica presumida.
O inventário calcula hashes dos bytes históricos e de um candidato sem wrapper
BEGIN/COMMIT, sem gravar/exibir SQL. O reconhecimento de wrapper não é parser
SQL completo nem prova de segurança transacional. Uma revisão separada com
parser PostgreSQL/contrato PG18 é obrigatória antes de criar payload executável.
Não se alteram os arquivos originais, nem se transfere a aprovação histórica.

O ledger de Development tem nomes de colunas canônicas; o clean-proposal tem
contrato incompatível. Nomes de colunas não atestam tipos, constraints,
ownership, ACL ou origem. Ledger vazio/ausente não admite backfill por inferência.

## Próximo gate obrigatório

Aprovar independentemente trust roots, aquisição autenticada e imutável,
origem do SHA checkout, manifest real e ledger completo; verificar runs e
artefatos de recuperação, reconciliar roles/owners/ACL/RLS e vincular nova lease
via control plane. Revisar payloads e DAG canônica em fixture PG18. Só então
solicitar autorização específica para o clone, com execução sob custodiante
separado. Production e G3 seguem HOLD.
