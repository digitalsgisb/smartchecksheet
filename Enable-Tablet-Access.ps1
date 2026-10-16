# Run from PowerShell opened as Administrator when the Wi-Fi address changes.
# Allows only this app port, this PC address, and the current Wi-Fi subnet.
$ErrorActionPreference = 'Stop'
$taskRuleName = 'ProductionDigital-Tablet-LAN-3700'
$taskWifi = @(Get-NetIPAddress -InterfaceAlias 'Wi-Fi' -AddressFamily IPv4 |
    Where-Object { $_.AddressState -eq 'Preferred' -and $_.IPAddress -notlike '169.254.*' })
if ($taskWifi.Count -ne 1) { throw 'Connect to Wi-Fi with one IPv4 address, then run this script again.' }
$taskAddress = $taskWifi[0].IPAddress
$taskPrefix = [int]$taskWifi[0].PrefixLength
if ($taskPrefix -lt 16 -or $taskPrefix -gt 32) { throw 'Use a specific local subnet for the firewall rule.' }
$taskBytes = [Net.IPAddress]::Parse($taskAddress).GetAddressBytes()
$taskNetwork = for ($taskIndex = 0; $taskIndex -lt 4; $taskIndex++) {
    $taskBits = [Math]::Min(8, [Math]::Max(0, $taskPrefix - 8 * $taskIndex))
    $taskMask = if ($taskBits -eq 0) { 0 } else { (255 -shl (8 - $taskBits)) -band 255 }
    $taskBytes[$taskIndex] -band $taskMask
}
$taskSubnet = ($taskNetwork -join '.') + '/' + $taskPrefix
$taskParameters = @{
    Name = $taskRuleName
    Direction = 'Inbound'
    Action = 'Allow'
    Protocol = 'TCP'
    LocalPort = 3700
    LocalAddress = $taskAddress
    RemoteAddress = $taskSubnet
    Profile = 'Any'
    Enabled = 'True'
}
if (Get-NetFirewallRule -Name $taskRuleName -ErrorAction SilentlyContinue) {
    Set-NetFirewallRule @taskParameters | Out-Null
} else {
    New-NetFirewallRule @taskParameters -DisplayName 'Production Digital tablet LAN (3700)' | Out-Null
}
Write-Host "Tablet access enabled. On the same Wi-Fi, open http://$($taskAddress):3700/#checksheet"
