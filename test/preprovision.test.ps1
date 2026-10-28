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
    $env:AZURE_SUBSCRIPTION_ID = '00000000-0000-4000-8000-000000000001'
    $env:POC_BACKEND_KEY = $null
    & $hook
    if ($global:ApiopsPreprovisionMock.Calls -ne 1) {
        throw 'An interactively resolved azd parameter must not prevent local tests.'
    }
    $env:POC_BACKEND_KEY = 'test-only-key-with-at-least-32-characters'
    & $hook
    if ($global:ApiopsPreprovisionMock.Calls -ne 2) {
        throw 'Environment-supplied parameters must also allow local tests.'
    }
    $env:AZURE_SUBSCRIPTION_ID = '00000000-0000-4000-8000-000000000002'
    $rejected = $false
    try {
        & $hook
    } catch {
        if ($_.Exception.Message -notmatch 'configured subscription') { throw }
        $rejected = $true
    }
    if (-not $rejected -or $global:ApiopsPreprovisionMock.Calls -ne 2) {
        throw 'The subscription guard must reject the request before invoking npm.'
    }
    $env:AZURE_SUBSCRIPTION_ID = $null
    $rejected = $false
    try {
        & $hook
    } catch {
        if ($_.Exception.Message -notmatch 'Set AZURE_SUBSCRIPTION_ID') { throw }
        $rejected = $true
    }
    if (-not $rejected) { throw 'Missing subscription must fail before tests.' }
    $env:AZURE_SUBSCRIPTION_ID = '00000000-0000-4000-8000-000000000001'
    $global:ApiopsPreprovisionMock.ExitCode = 1
    $rejected = $false
    try {
        & $hook
    } catch {
        if ($_.Exception.Message -notmatch 'npm failed with exit code 1') { throw }
        $rejected = $true
    }
    if (-not $rejected) { throw 'Local test failures must block provisioning.' }
    if ((Get-Location).Path -ne $previousLocation.Path) {
        throw 'The hook must restore its working directory after failure.'
    }
    Write-Information 'PASS: prompted and environment-supplied parameters, subscription guard, test failure propagation and location restoration.' -InformationAction Continue
} finally {
    $env:AZURE_SUBSCRIPTION_ID = $previousSubscription
    $env:POC_BACKEND_KEY = $previousKey
    Set-Location -LiteralPath $previousLocation.Path
    Remove-Variable -Name ApiopsPreprovisionMock -Scope Global
}
