@echo off
chcp 65001 >nul
title Gestao Financeira
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto semnode

if exist node_modules goto iniciar
echo Instalando os componentes do programa. Isso acontece somente na primeira vez e pode levar alguns minutos...
call npm install
if errorlevel 1 goto erro

:iniciar
call npm run local
goto fim

:semnode
echo.
echo O Node.js nao esta instalado neste computador.
echo Vou abrir a pagina de download: baixe a versao LTS, instale e depois clique novamente neste arquivo.
start https://nodejs.org/pt
goto fim

:erro
echo.
echo Ocorreu um erro na instalacao. Verifique sua conexao com a internet e tente novamente.

:fim
echo.
pause
