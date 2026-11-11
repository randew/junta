@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Junta

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale a versao LTS em https://nodejs.org e tente de novo.
  pause
  exit /b 1
)

rem Se a pasta estiver ligada ao Git, baixa a versao mais nova antes de iniciar
if exist ".git" (
  where git >nul 2>nul && (
    echo Procurando atualizacoes...
    git pull --ff-only
  )
)

echo Conferindo dependencias...
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 (
  echo O npm install falhou. Veja a mensagem acima.
  pause
  exit /b 1
)

start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:3000"
rem o tunel abre numa segunda janela; o link https://...trycloudflare.com aparece nela
start "Junta - link para amigos" cmd /k "ping -n 4 127.0.0.1 >nul & npx --yes cloudflared tunnel --url http://127.0.0.1:3000"
echo.
echo Junta iniciando. O link para os amigos aparece na outra janela,
echo numa linha com "trycloudflare.com". Para encerrar, feche as duas janelas.
echo.
call npm start
pause
