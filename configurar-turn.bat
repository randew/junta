@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Junta - configurar TURN
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale a versao LTS em https://nodejs.org e tente de novo.
  pause
  exit /b 1
)
node scripts\configurar-turn.js %*
echo.
pause
