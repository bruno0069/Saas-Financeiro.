#!/bin/bash
# Clique duas vezes para abrir o programa no Mac.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "O Node.js não está instalado neste computador."
  echo "Vou abrir a página de download: baixe a versão LTS, instale e depois clique novamente neste arquivo."
  open "https://nodejs.org/pt"
  read -r -p "Pressione Enter para fechar..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Instalando os componentes do programa (somente na primeira vez; pode levar alguns minutos)..."
  npm install || { echo "Erro na instalação. Verifique a internet e tente novamente."; read -r -p "Pressione Enter para fechar..."; exit 1; }
fi

npm run local
read -r -p "Pressione Enter para fechar..."
