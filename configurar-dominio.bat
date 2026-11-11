@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Junta - configurar dominio

echo.
echo  Configura o seu dominio (ex.: juntaai.stream) para abrir o Junta deste PC
echo  por um tunel da Cloudflare. So precisa rodar uma vez.
echo.
echo  Antes, o dominio ja precisa estar adicionado na sua conta da Cloudflare
echo  (status "Active" no painel).
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale a versao LTS em https://nodejs.org e tente de novo.
  pause
  exit /b 1
)

set "DOMINIO=juntaai.stream"
set /p "DOMINIO=Dominio [juntaai.stream]: "
if "%DOMINIO%"=="" set "DOMINIO=juntaai.stream"

echo.
echo [1/3] Entrando na Cloudflare. O navegador vai abrir: escolha o dominio %DOMINIO% e clique em Authorize.
if exist "%USERPROFILE%\.cloudflared\cert.pem" (
  echo Ja estava autorizado neste PC.
) else (
  call npx --yes cloudflared tunnel login
  if not exist "%USERPROFILE%\.cloudflared\cert.pem" (
    echo A autorizacao nao terminou. Rode este arquivo de novo.
    pause
    exit /b 1
  )
)

echo.
echo [2/3] Criando o tunel "junta"...
call npx --yes cloudflared tunnel info junta >nul 2>nul
if errorlevel 1 (
  call npx --yes cloudflared tunnel create junta
  if errorlevel 1 (
    echo Nao consegui criar o tunel. Veja a mensagem acima.
    pause
    exit /b 1
  )
) else (
  echo O tunel "junta" ja existia.
)

echo.
echo [3/3] Apontando %DOMINIO% para o tunel...
call npx --yes cloudflared tunnel route dns --overwrite-dns junta %DOMINIO%
if errorlevel 1 (
  echo Nao consegui criar o registro DNS. Confira se o dominio esta ativo na Cloudflare.
  pause
  exit /b 1
)

(
  echo tunnel: junta
  echo ingress:
  echo   - hostname: %DOMINIO%
  echo     service: http://127.0.0.1:3000
  echo   - service: http_status:404
) > tunel.yml

echo.
echo Pronto! A partir de agora o iniciar-com-amigos.bat abre o Junta em:
echo   https://%DOMINIO%
echo.
pause
