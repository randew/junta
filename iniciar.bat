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

rem abre o navegador 2 segundos depois, quando o servidor ja respondeu
start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:3000"
echo.
echo Junta iniciando. Para encerrar, feche esta janela ou aperte Ctrl+C.
echo.
call npm start
pause
