#!/bin/bash
# Junta — liga um domínio seu (ex.: juntaai.stream) ao Junta deste Mac por um túnel da Cloudflare. Rode uma vez.
cd "$(dirname "$0")" || exit 1
falha() { echo; echo "$1"; read -r -p "Aperte Enter para fechar."; exit 1; }
command -v node >/dev/null 2>&1 || falha "Node.js não encontrado. Instale a versão LTS em https://nodejs.org e tente de novo."
echo
echo " O domínio já precisa estar na sua conta da Cloudflare (status \"Active\")."
echo
read -r -p "Domínio [juntaai.stream]: " DOMINIO
DOMINIO=${DOMINIO:-juntaai.stream}
CF="npx --yes cloudflared"
CRED="$HOME/.cloudflared/junta.json"

echo; echo "[1/3] Entrando na Cloudflare. No navegador, escolha $DOMINIO e clique em Authorize."
if [ -f "$HOME/.cloudflared/cert.pem" ]; then echo "Já estava autorizado neste Mac."
else $CF tunnel login; [ -f "$HOME/.cloudflared/cert.pem" ] || falha "A autorização não terminou. Rode este arquivo de novo."; fi

echo; echo "[2/3] Preparando o túnel \"junta\"..."
$CF tunnel info junta >/dev/null 2>&1 || $CF tunnel create junta || falha "Não consegui criar o túnel."
# baixa a credencial do túnel (funciona mesmo se ele foi criado no PC)
$CF tunnel token --cred-file "$CRED" junta >/dev/null || falha "Não consegui baixar a credencial do túnel."

echo; echo "[3/3] Apontando $DOMINIO para o túnel..."
$CF tunnel route dns --overwrite-dns junta "$DOMINIO" || falha "Não consegui criar o registro DNS. Confira se o domínio está ativo na Cloudflare."

cat > tunel.yml <<YML
tunnel: junta
credentials-file: $CRED
ingress:
  - hostname: $DOMINIO
    service: http://127.0.0.1:3000
  - service: http_status:404
YML
echo; echo "Pronto! O iniciar-com-amigos.command agora abre o Junta em https://$DOMINIO"
read -r -p "Aperte Enter para fechar."
