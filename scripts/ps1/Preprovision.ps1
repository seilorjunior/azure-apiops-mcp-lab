#Requires -Version 7.2
. (Join-Path $PSScriptRoot 'Common.ps1')
if ($env:AZURE_SUBSCRIPTION_ID -ne $script:SubscriptionId) {
    throw "azd must use the approved subscription: $script:SubscriptionId"
}
Push-Location $script:Root
try {
    Invoke-Checked -Command npm -Arguments @('test')
} finally {
    Pop-Location
}
