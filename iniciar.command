#!/bin/bash
# Junta — atalho para Mac/Linux: dois cliques para abrir (no Mac, a primeira vez use botão direito > Abrir)
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js não encontrado. Instale a versão LTS em https://nodejs.org e tente de novo."; read -r; exit 1
fi
if [ -d .git ] && command -v git >/dev/null 2>&1; then
  echo "Procurando atualizações..."; git pull --ff-only
fi
echo "Conferindo dependências..."
npm install --no-audit --no-fund --loglevel=error || { echo "O npm install falhou."; read -r; exit 1; }
if [ "$1" = "amigos" ]; then
  if [ -f tunel.yml ]; then
    (sleep 3; npx --yes cloudflared tunnel --config tunel.yml run junta) &
    echo "Link para os amigos: https://$(awk '/hostname:/{print $3; exit}' tunel.yml)"
  else
    (sleep 3; npx --yes cloudflared tunnel --url http://127.0.0.1:3000) &
    echo "O link para os amigos aparece abaixo, numa linha com trycloudflare.com"
  fi
  TUNNEL=$!
  trap 'kill $TUNNEL 2>/dev/null' EXIT
fi
(sleep 2; command -v open >/dev/null && open http://localhost:3000 || xdg-open http://localhost:3000 >/dev/null 2>&1) &
npm start
