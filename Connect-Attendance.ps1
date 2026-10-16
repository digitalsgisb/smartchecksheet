$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
Write-Host 'In Attendance: System settings > Add connection > Production app / checksheet (read only).'
$attendanceOrigin = Read-Host 'Attendance address [http://127.0.0.1:8765]'
if (!$attendanceOrigin) { $attendanceOrigin = 'http://127.0.0.1:8765' }
$attendanceUri = [Uri]$attendanceOrigin
if ($attendanceUri.Scheme -notin @('http','https') -or $attendanceUri.UserInfo -or $attendanceUri.AbsolutePath -ne '/' -or $attendanceUri.Query -or $attendanceUri.Fragment) { throw 'Enter a server origin only.' }
$choices = @(
  @{id='fc1';label='FC Line 1';lines=@('FC');assignment='fc1';accountLines=@('ABB2')},
  @{id='fc3';label='FC Line 3';lines=@('FC');assignment='fc3';accountLines=@('ABB3')},
  @{id='mf';label='Mini Forming';lines=@('MF');accountLines=@('ABB7')},
  @{id='roll-making';label='Roll Making';section='ROLL MAKING';accountLines=@('ROLL MAKING')}
)
for ($i=0; $i -lt $choices.Count; $i++) { Write-Host "$($i+1). $($choices[$i].label)" }
$selection = Read-Host 'Attendance group for this Checksheet installation (1-4)'
if ($selection -notmatch '^[1-4]$') { throw 'Choose 1 to 4.' }
$chosen = $choices[[int]$selection-1]
$protectedToken = Read-Host 'Read-only integration token (hidden)' -AsSecureString
$plainToken = [System.Net.NetworkCredential]::new('', $protectedToken).Password
if ($plainToken -notmatch '^[A-Za-z0-9_-]{20,200}$') { throw 'Invalid integration token.' }
try {
  $reply = Invoke-RestMethod -Uri ($attendanceUri.GetLeftPart([UriPartial]::Authority)+'/api/employees') -Headers @{Authorization="Bearer $plainToken"} -TimeoutSec 8 -MaximumRedirection 0
} catch { throw 'Attendance connection failed. Verify the local address and integration token.' }
if ($reply.connection_scope -ne 'integration') { throw 'Use a read-only integration token.' }
$groupJson = ConvertTo-Json -InputObject @($chosen) -Compress -Depth 5
$envPath = Join-Path $PSScriptRoot '.env'
$envText = if (Test-Path -LiteralPath $envPath) { [IO.File]::ReadAllText($envPath) } else { '' }
foreach ($key in @('ATTENDANCE_API_URL','ATTENDANCE_TOKEN','ATTENDANCE_GROUPS')) {
  $envText = [regex]::Replace($envText, "(?m)^$key=.*\r?\n?", '')
}
$newText = $envText.TrimEnd()+"`nATTENDANCE_API_URL=$($attendanceUri.GetLeftPart([UriPartial]::Authority))`nATTENDANCE_TOKEN=$plainToken`nATTENDANCE_GROUPS='$groupJson'`n"
[IO.File]::WriteAllText($envPath, $newText)
$plainToken = $null
$newText = $null
$matched = @($reply.employees | Where-Object { $_.active -and $_.department -and $_.line -and $_.department.Trim().ToUpper() -eq 'PRODUCTION' -and ((!$chosen.section -and $_.line.Trim().ToUpper() -in $chosen.lines) -or ($chosen.section -and ($_.production_section -eq 'ROLL MAKING' -or (!$_.production_section -and $_.line.Trim().ToUpper() -eq 'ROLL MAKING')))) -and (!$chosen.assignment -or $_.checksheet_group -eq $chosen.assignment) })
Write-Host "Connection verified and saved for $($chosen.label). $($matched.Count) matching employees. Restart Smart Checksheet, then open Attendance."
if ($chosen.assignment -and !$matched.Count) { Write-Host 'Assign FC employees in Attendance > Employees > Profile > Checksheet tablet assignment.' }
