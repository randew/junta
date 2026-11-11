#!/bin/bash
# Junta — guarda a chave do TURN da Cloudflare (rode uma vez)
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js não encontrado. Instale a versão LTS em https://nodejs.org"; read -r; exit 1; }
node scripts/configurar-turn.js "$@"
echo; read -r -p "Aperte Enter para fechar."
