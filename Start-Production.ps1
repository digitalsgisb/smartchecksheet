$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
$taskLogDirectory = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Path $taskLogDirectory -Force | Out-Null
$taskLogFile = Join-Path $taskLogDirectory ('server-' + (Get-Date -Format 'yyyy-MM') + '.log')
('Starting Production Digital at ' + (Get-Date -Format 'o')) | Out-File -LiteralPath $taskLogFile -Append -Encoding utf8
$ErrorActionPreference = 'Continue' # Native stderr warnings should be logged, not stop the server.
& $taskNode --env-file-if-exists=.env server/index.js 2>&1 | Out-File -LiteralPath $taskLogFile -Append -Encoding utf8
exit $LASTEXITCODE
