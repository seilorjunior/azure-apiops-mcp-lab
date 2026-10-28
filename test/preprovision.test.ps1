#Requires -Version 7.2
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidGlobalVars', '', Justification = 'Mocks share state and native exit codes with scripts invoked in child scopes.')]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$hook = Join-Path $root 'scripts\ps1\Preprovision.ps1'
$previousSubscription = $env:AZURE_SUBSCRIPTION_ID
$previousKey = $env:POC_BACKEND_KEY
$previousLocation = Get-Location
$global:ApiopsPreprovisionMock = @{ Calls = 0; ExitCode = 0 }

function npm {
    if ((@($args) -join ' ') -ne 'test') { throw 'Unexpected npm invocation.' }
    $global:ApiopsPreprovisionMock.Calls++
    $global:LASTEXITCODE = $global:ApiopsPreprovisionMock.ExitCode
}

function az {
    if ((@($args) -join ' ') -notmatch '^account show ') { throw 'Unexpected Azure invocation.' }
    $global:LASTEXITCODE = 0
    return '{"id":"00000000-0000-4000-8000-000000000001"}'
}

try {
    $matrix = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'shell-matrix.json') | ConvertFrom-Json
    foreach ($scenario in $matrix.preprovision) {
        $env:AZURE_SUBSCRIPTION_ID = $scenario.subscription
        $env:POC_BACKEND_KEY = $scenario.key
        $global:ApiopsPreprovisionMock.Calls = 0
        $global:ApiopsPreprovisionMock.ExitCode = $scenario.npmExit
        $rejected = $false
        try {
            & $hook
        } catch {
            if (-not $scenario.error -or $_.Exception.Message -notmatch $scenario.error) { throw }
            $rejected = $true
        }
        if ($rejected -ne [bool]$scenario.error -or $global:ApiopsPreprovisionMock.Calls -ne $scenario.npmCalls) {
            throw "Unexpected preprovision result for $($scenario.id)."
        }
        if ((Get-Location).Path -ne $previousLocation.Path) {
            throw 'The hook must restore its working directory after failure.'
        }
    }
    Write-Information 'PASS: prompted and environment-supplied parameters, subscription guard, test failure propagation and location restoration.' -InformationAction Continue
} finally {
    $env:AZURE_SUBSCRIPTION_ID = $previousSubscription
    $env:POC_BACKEND_KEY = $previousKey
    Set-Location -LiteralPath $previousLocation.Path
    Remove-Variable -Name ApiopsPreprovisionMock -Scope Global
}
