param(
  [string]$Port = "3010"
)

$ErrorActionPreference = "Stop"

$codexHome = Join-Path $env:USERPROFILE ".codex"
$configPath = Join-Path $codexHome "config.toml"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = Join-Path $codexHome "config.toml.bak-setup-kimi-$stamp"

function Write-WarnBanner {
  Write-Host ""
  Write-Host "================================================================================" -ForegroundColor Red
  Write-Host "  REESCREVENDO config.toml - so MCP sera preservado" -ForegroundColor Yellow
  Write-Host "================================================================================" -ForegroundColor Red
  Write-Host ""
}

function Get-McpBlocks {
  param([string]$Text)

  if ([string]::IsNullOrWhiteSpace($Text)) {
    return ""
  }

  $lines = $Text -split "`r?`n", -1
  $kept = New-Object System.Collections.Generic.List[string]
  $inMcp = $false

  foreach ($line in $lines) {
    $trim = $line.Trim()

    if ($trim -match '^\[([^\]]+)\]\s*$') {
      $table = $Matches[1]
      if ($table -eq "mcp_servers" -or $table.StartsWith("mcp_servers.")) {
        $inMcp = $true
        $kept.Add($line) | Out-Null
        continue
      }
      $inMcp = $false
      continue
    }

    if ($inMcp) {
      $kept.Add($line) | Out-Null
    }
  }

  $block = ($kept -join "`n").TrimEnd()
  if ([string]::IsNullOrWhiteSpace($block)) {
    return ""
  }

  return $block + "`n"
}

Write-WarnBanner

if (-not (Test-Path $codexHome)) {
  New-Item -ItemType Directory -Path $codexHome -Force | Out-Null
  Write-Host "Criado: $codexHome"
}

$mcpBlock = ""
if (Test-Path $configPath) {
  $old = Get-Content -Path $configPath -Raw -Encoding UTF8
  Copy-Item -Path $configPath -Destination $backupPath -Force
  Write-Host "Backup salvo em:" -ForegroundColor Cyan
  Write-Host "  $backupPath"
  $mcpBlock = Get-McpBlocks -Text $old
  if ($mcpBlock) {
    Write-Host "MCP preservado do config antigo." -ForegroundColor Green
  }
  else {
    Write-Host "Nenhum [mcp_servers.*] encontrado no config antigo." -ForegroundColor DarkYellow
  }
}
else {
  Write-Host "config.toml ainda nao existia; sera criado do zero." -ForegroundColor DarkYellow
}

$base = @"
# =========================
# Gerado por setup-codex (KimiProxy)
# Provider local sem API key / sem login OpenAI
# Porta da proxy: $Port
# =========================

model = "k2d6-thinking"
model_provider = "kimi"

model_reasoning_effort = "xhigh"
approvals_reviewer = "user"

[model_providers.kimi]
name = "Kimi Proxy (local)"
base_url = "http://127.0.0.1:$Port/v1"
wire_api = "responses"
requires_openai_auth = false
request_max_retries = 4
stream_max_retries = 10
stream_idle_timeout_ms = 600000

[windows]
sandbox = "unelevated"

"@

if ($mcpBlock) {
  $out = $base + "`n# =========================`n# MCP (preservado do config anterior)`n# =========================`n`n" + $mcpBlock
}
else {
  $out = $base + "`n# Nenhum MCP foi encontrado no config anterior.`n"
}

$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($configPath, $out.TrimEnd() + "`n", $utf8NoBom)

Write-Host ""
Write-Host "Escrito:" -ForegroundColor Green
Write-Host "  $configPath"
Write-Host ""
Write-Host "Resumo do novo config:"
Write-Host "  model            = k2d6-thinking"
Write-Host "  model_provider   = kimi"
Write-Host "  base_url         = http://127.0.0.1:$Port/v1"
Write-Host "  openai auth      = desligado"
if ($mcpBlock) {
  $mcpNames = [regex]::Matches($mcpBlock, '(?m)^\[mcp_servers\.([^\].]+)') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
  Write-Host ("  mcp_servers      = " + (($mcpNames | ForEach-Object { $_ }) -join ", "))
}
else {
  Write-Host "  mcp_servers      = (nenhum)"
}
Write-Host ""
exit 0
