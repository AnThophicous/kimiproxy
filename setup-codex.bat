@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul 2>&1
title KimiProxy - Configurar Codex

set "CODEX_HOME=%USERPROFILE%\.codex"
set "CONFIG=%CODEX_HOME%\config.toml"
set "PORT=3010"
if not "%~1"=="" set "PORT=%~1"

echo.
echo ================================================================================
echo.
echo   ATENCAO  /  AVISO CRITICO  /  DESTRUCTIVE ACTION
echo.
echo   Este script VAI APAGAR e REESCREVER o seu Codex config.toml.
echo.
echo   O que SERA REMOVIDO (tudo, sem restaurar automatico):
echo     - model / model_provider atuais
echo     - TODOS os model_providers (openai, xai, ollama, etc.)
echo     - TODOS os [projects.*] (trust_level, pastas confiaveis)
echo     - profiles, tui, windows, notice, sandbox, approval, etc.
echo     - qualquer outra chave que NAO seja MCP
echo.
echo   O que SERA MANTIDO:
echo     - apenas secoes [mcp_servers.*] e subtabelas relacionadas
echo       (ex.: [mcp_servers.foo.http_headers])
echo.
echo   O que SERA ESCRITO NO LUGAR:
echo     - provider local "kimi" -^> http://127.0.0.1:%PORT%/v1
echo     - model = k2d6-thinking
echo     - wire_api = responses
echo     - requires_openai_auth = false  (sem API key / sem login OpenAI)
echo     - seus MCP preservados no final do arquivo
echo.
echo   Backup: sera criado config.toml.bak-setup-kimi-TIMESTAMP
echo   em %CODEX_HOME%
echo.
echo   Arquivo alvo:
echo     %CONFIG%
echo.
echo ================================================================================
echo.
echo   Para continuar, digite exatamente:  SIM APAGAR
echo   Qualquer outra coisa cancela.
echo.

set /p "CONFIRM=> "
if /I not "!CONFIRM!"=="SIM APAGAR" (
  echo.
  echo Cancelado. Nada foi alterado.
  echo.
  pause
  exit /b 1
)

echo.
echo Confirmado. Aplicando configuracao...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-codex.ps1" -Port "%PORT%"
set "ERR=!ERRORLEVEL!"

echo.
if "!ERR!"=="0" (
  echo ================================================================================
  echo   OK - config.toml reescrito para Kimi Proxy.
  echo   Proxy sem API key: http://127.0.0.1:%PORT%/v1
  echo   Suba a proxy com:  npm start
  echo   Reinicie o Codex CLI / App para carregar o config.
  echo ================================================================================
) else (
  echo ================================================================================
  echo   FALHOU - veja as mensagens acima. O backup (se criado) permanece em:
  echo   %CODEX_HOME%
  echo ================================================================================
)
echo.
pause
exit /b !ERR!
