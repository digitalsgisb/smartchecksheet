$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

# The token stays in the ignored backend .env file. It is never sent to React.
$envPath = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path -LiteralPath $envPath)) {
    throw 'Local test configuration is missing. Configure .env first.'
}
$settings = [IO.File]::ReadAllText($envPath)
if ($settings -notmatch '(?m)^ATTENDANCE_TOKEN=.+$') {
    Write-Host 'In Attendance on the AI PC: System settings > Connected devices > Add connection.'
    Write-Host 'Choose Production app / checksheet (read only), then copy its token.'
    $secret = Read-Host 'Paste the read-only integration token (hidden)' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try {
        $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer).Trim()
        if (-not $token -or $token -match '[\r\n''"#\s]') { throw 'The token is empty or contains unsupported characters.' }
        $originMatch = [regex]::Match($settings, '(?m)^ATTENDANCE_API_URL=(.+)\r?$')
        if (-not $originMatch.Success) { throw 'Set ATTENDANCE_API_URL in .env first.' }
        $origin = $originMatch.Groups[1].Value.Trim()
        try {
            $result = Invoke-RestMethod -Uri "$origin/api/employees" -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 10
        } catch { throw 'Cannot connect with this token. Check Tailscale, the AI PC and the read-only integration token.' }
        if ($result.connection_scope -ne 'integration') { throw 'Use a read-only integration token for this connection.' }
        $settings = [regex]::Replace($settings, '(?m)^ATTENDANCE_TOKEN=.*\r?\n?', '')
        [IO.File]::WriteAllText($envPath, $settings.TrimEnd() + "`nATTENDANCE_TOKEN=$token`n", [Text.UTF8Encoding]::new($false))
        Write-Host 'Attendance connected. Token saved in the local backend configuration.'
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        $token = $null
        $result = $null
        $secret.Dispose()
    }
}
Write-Host 'Open http://localhost:3700/#attendance and sign in as abb3 or admin.'
$running = $null
try { $running = Invoke-RestMethod -Uri 'http://127.0.0.1:3700/api/config' -TimeoutSec 2 } catch { }
if ($running.demo -eq $true) {
    Write-Host 'The local demo server is already running. Refresh Attendance in your browser.'
    Write-Host 'If you started it with npm start, restart that server once to load the saved token.'
    return
}
Write-Host 'Keep this window open. Press Ctrl+C to stop the local test server.'
& node scripts/local-test-server.js
