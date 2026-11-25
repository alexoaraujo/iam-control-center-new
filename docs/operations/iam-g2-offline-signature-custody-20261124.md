# PEOS G2 — custódia offline das assinaturas Ed25519

Dependência: PR #180. Não ativar aquisição nem criar trust roots reais nesta
etapa. O montador não usa rede, não acessa banco, não lê chaves privadas e
não assina. A autorização permanece false.

## Cerimônia de custódia (após autorização específica)

- Dois custodiante(s) independentes, em dispositivos privados e separados.
  Cada um cria sua própria chave Ed25519 cifrada, guarda a senha separadamente
  e conserva backup recuperável. Não usar chave AES de G1, HMAC de RBAC, chave
  RSA de recuperação CMS ou credencial de Neon como chave de assinatura.
- Em cada dispositivo, fora do checkout e fora de diretórios sincronizados,
  criar diretório 0700; umask 077. OpenSSL solicitará senha interativamente.
  Exemplo para uma única custódia, repetir somente no dispositivo do outro
  custodiante com nome distinto:
 
      openssl genpkey -algorithm ED25519 -aes-256-cbc -out collector-private.pem
      openssl pkey -in collector-private.pem -pubout -out collector-public.pem
      openssl pkey -pubin -in collector-public.pem -outform DER | openssl dgst -sha256

- Registrar somente PEM público e fingerprint SPKI SHA-256 após conferir
  identidade e posse com cada custodiante por canal independente. Não inserir
  chave privada/senha no GitHub, Vercel, Neon, CI ou chat.
- Construir e revisar packet.json e evidence.json conforme contrato #176.
  Ambos verificam bytes do packet, hashes do evidence, policy, migrations,
  referências de backup/restore e lease, SHA exato e escopo OFFLINE_REVIEW_ONLY.
  O pin SHA256 do trust.json e do packet.json deve vir por canal independente,
  não ser simplesmente aceito de um arquivo recebido junto com as assinaturas.
- Cada custódia assina os mesmos bytes sem reserializar JSON, e verifica
  localmente a assinatura antes de transferir somente os 64 bytes destacados:

      openssl pkeyutl -sign -rawin -inkey collector-private.pem -in packet.json -out collector.sig
      openssl pkeyutl -verify -rawin -pubin -inkey collector-public.pem -in packet.json -sigfile collector.sig

  Repetir com reviewer-private.pem no outro dispositivo. Não reunir chaves.
  Nenhuma chave privada é enviada ao operador de montagem.

## Montagem

Em dispositivo privado Linux/macOS com checkout revisado, executar
interativamente, sem CI, arquivos 0600, diretório 0700 fora do repositório:

    node database/offline/assemble-canonical-signatures.mjs /private/packet.json /private/evidence.json /private/trust.json /private/collector.sig /private/reviewer.sig PACKET_SHA256 TRUST_SHA256 /private/signatures.json

O montador valida pins dos bytes, formato, 64 bytes por assinatura,
chaves distintas via preparador #176, revisão de lineage e validade de
lease/recuperação declaradas. Rejeita assinatura trocada, alteração dos bytes,
pin incorreto, symlink direto, arquivo compartilhado e overwrite. Não comprova
identidade do custodiante, proveniência histórica, aprovação independente,
ou existência de lease. O resultado contém somente collector/reviewer em
base64, compatível com o preparador #176. PASS significa montagem válida,
nunca aprovação de baseline. Arquivos reais não devem ser publicados em
repositório público. Testes usam exclusivamente chaves efêmeras sintéticas.

G3, Production, ativação do coletor, grants, lease e migrations seguem HOLD.
