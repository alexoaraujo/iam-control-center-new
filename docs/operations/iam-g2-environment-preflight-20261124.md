# G2 — preflight protegido de Environments
Dependência #181. Apenas metadata, sem aquisição. Não criar ambientes automaticamente.
O workflow PR executa somente fixtures sintéticas sem credenciais externas.
O workflow_dispatch também executa apenas fixtures. O GITHUB_TOKEN não
oferece as permissões Secrets/Variables/Environments necessárias aos inventários.
A consulta real é local, interativa, após merge e revisão do SHA exato da main,
checkout limpo e comparação main antes/depois, GET fixo sem redirects.
Em dispositivo privado, usar um fine-grained PAT temporário restrito somente
este repositório, com Contents, Actions, Secrets, Variables e Environments
read (Metadata read implícita). Conferir permissões na emissão e revogar após uso.
Não conceder write, não armazenar em CI, não enviar em chat ou argumentos.

    python3 .github/scripts/iam-g2-environment-preflight.py SHA_MAIN_APROVADO

O prompt privado lê o token sem eco; falha se não houver TTY. Se API negar
leitura, HOLD, sem ampliar automaticamente permissões ou relaxar proteção.
Nenhum job referencia um Environment, logo não libera seus secrets.
 
## Contrato
Ambos: branch policy exclusiva main (sem tags/wildcards), reviewer
alexoaraujo83 obrigatório, prevent self-review, admin bypass false,
sem custom rules não revisadas. IDs distintos. Repositório pessoal;
se virar organização, contrato precisa de revisão de herança.
 
| Environment | Secret exclusivo | Variáveis não secretas |
|---|---|---|
| IAM-G2-Neon-Endpoint-Attestation | IAM_G2_NEON_ENDPOINT_READ_TOKEN | IAM_G2_APPROVED_SHA |
| IAM-G2-Development-Evidence-Acquisition | IAM_G2_READER_PASSWORD | IAM_G2_APPROVED_SHA, IAM_G2_RECIPIENT_CERT_SHA256 |
 
Não usar NEON_API_KEY administrativa, owner URL, G1 AES, HMAC G3,
chaves Ed25519 privadas ou RSA privada nesses ambientes. Nenhuma credencial
G2 no escopo de repositório. Não registrar valores de secrets ou variáveis
não relacionadas em logs. O pin do certificado é SHA256 hex minúsculo.
 
PASS_METADATA_ONLY não prova valor, escopo real da credencial no provedor,
posse de chave, autorização operacional, paridade, backup/restore ou lease.
A policy de aquisição segue activation_authorized=false.
O futuro executor deverá revalidar o SHA, as proteções e os escopos
antes de cada uso, ter controle de corrida e exigir aprovações independentes
por job. Não habilitar por esta PR. Nenhum G3/Production autorizado.
