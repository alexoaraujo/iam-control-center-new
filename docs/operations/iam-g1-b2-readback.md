# IAM-G1 — Readback independente do objeto sintético criptografado

## Prova anterior (somente upload)

- GitHub Actions [#43987013885](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/43987013885), em `main` SHA `469339973b03009de68e505fe1aeb2da5f169117`: `PASS_B2_ENCRYPTED_SYNTHETIC_UPLOAD`.
- Bucket privado: `iam-control-center-g1-backups` no endpoint `https://s3.us-east-005.backblazeb2.com`.
- Objeto **fixo e somente sintético**: `iam-g1/probes/20261117T002204Z-43987013885.aesgcm`.
- SHA-256 do ciphertext: `fe9a991b063bd0241bab475c2710389c618fb92f654ed97e1444c9e8bda16f27`.
- O upload não comprova capacidade de leitura, recuperação de plaintext, proteção/escrow da chave AES-GCM ou restauração.

## Pré-requisitos de custódia independente

1. Revisor de custódia distinto do responsável pelo upload deve verificar a necessidade/escopo da chave e aprovar a leitura.
2. Criar na Backblaze uma **standard application key** separada, de acesso **Read Only** (`readFiles`), limitada ao bucket `iam-control-center-g1-backups` e prefixo de objetos `iam-g1/probes/`; se houver necessidade técnica comprovada por um SDK de `List Buckets`, avaliar `listAllBucketNames` **separadamente**. Não conceder `writeFiles` nem `deleteFiles`, não reutilizar a chave writer.
3. Criar GitHub Environment **`IAM-G1-B2-Readback-Custody`**, restrito exclusivamente à branch `main`, com aprovadores independentes, `Prevent self-review` e `Allow administrators to bypass` desabilitado onde suportado. Se o plano/visibilidade impedir proteção, **não** executar nem flexibilizar o gate; revisar método alternativo de execução com custódia privada.
4. Nesse Environment, adicionar **somente** os secrets `IAM_G1_B2_READ_ACCESS_KEY_ID` (Backblaze `keyID`) e `IAM_G1_B2_READ_SECRET_ACCESS_KEY` (Backblaze `applicationKey`). Nunca imprimir, encaminhar em chat, GitHub Issue, PR ou arquivos versionados.
5. Aprovar e mesclar a PR de readback após testes e revisão. Disparar manualmente em `main` [workflow IAM-G1 readback](https://github.com/alexoaraujo/iam-control-center-new/actions/workflows/iam-g1-b2-readback.yml); aprovar o job protegido.
6. Registrar na [Issue #97](https://github.com/alexoaraujo/iam-control-center-new/issues/97) o URL do run, resultado de `PASS_B2_INDEPENDENT_READBACK_CIPHERTEXT_SHA256`, objeto, tamanho e SHA-256; **não** registrar bytes do objeto ou dados pessoais.

## Garantias e limites

- O workflow executa `get_object` apenas sobre a chave fixa acima, com conexão TLS validada pelo SDK; não lista bucket, não grava ou exclui objetos, não consulta Neon e não dispara backups.
- O script interrompe a leitura se houver metadados incompatíveis, conteúdo ausente ou tamanho maior que **1 MiB**; calcula SHA-256 do corpo inteiro e compara ao esperado, sem imprimir bytes.
- Os testes offline cobrem SHA-256 íntegro, alteração de bytes, truncamento, tamanho excessivo e metadados incorretos, sem credenciais ou acesso à internet.
- A chave AES-256-GCM usada no upload sintético era **efêmera e não foi armazenada**. Mesmo com readback íntegro, **não** é possível demonstrar recuperação do plaintext. Backups reais exigirão custódia/escrow de chave própria, criptografia e restauração isolada com autorização independente.
- O clone G1 originário `br-spring-grass-b6gap6kp` não existe mais no projeto. Não reutilizar contrato vencido nem substituir por `br-sweet-union-b6j80a7j` sem nova autorização.

**Gates:** `B2_SYNTHETIC_UPLOAD=PASS`; `B2_INDEPENDENT_READBACK=PENDING`; `FULL_BACKUP_OWNER_APPROVAL=BLOCKED`; `RESTORE=NOT_EXECUTED`.
