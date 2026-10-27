#Requires -Version 7.2
. (Join-Path $PSScriptRoot 'Common.ps1')
Assert-Subscription
Push-Location $script:Root
try {
    Invoke-Checked -Command npm -Arguments @('test')
} finally {
    Pop-Location
}
