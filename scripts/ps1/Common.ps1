#Requires -Version 7.2
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$script:SubscriptionId = $env:AZURE_SUBSCRIPTION_ID
$script:ApiVersion = '2025-09-01-preview'

function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed with exit code $LASTEXITCODE."
    }
}

function Invoke-AzJson {
    param([string[]]$Arguments)
    $json = & az @Arguments --only-show-errors --output json
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI request failed with exit code $LASTEXITCODE."
    }
    ($json -join "`n") | ConvertFrom-Json -AsHashtable
}

function Assert-Subscription {
    $subscription = [guid]::Empty
    if (-not [guid]::TryParseExact($script:SubscriptionId, 'D', [ref]$subscription)) {
        throw 'Set AZURE_SUBSCRIPTION_ID to the intended Azure subscription UUID.'
    }
    $account = Invoke-AzJson -Arguments @('account', 'show')
    if ($account.id -ne $script:SubscriptionId) {
        throw "Select the configured subscription first: az account set --subscription $script:SubscriptionId"
    }
}

function Get-ServiceUrl {
    param([string]$ResourceGroup, [string]$ApimName)
    "https://management.azure.com/subscriptions/$script:SubscriptionId/resourceGroups/$ResourceGroup/providers/Microsoft.ApiManagement/service/$ApimName"
}

function Get-TestKey {
    param([string]$ServiceUrl)
    $keys = Invoke-AzJson -Arguments @('rest', '--method', 'post', '--url',
        "$ServiceUrl/subscriptions/poc-test-client/listSecrets?api-version=$script:ApiVersion")
    if (-not $keys.primaryKey) { throw 'Test subscription primary key was not returned.' }
    $keys.primaryKey
}

function Test-McpEndpoints {
    param([string]$GatewayUrl, [string]$EnvironmentName, [string]$Key)
    $previous = $env:POC_APIM_KEY
    try {
        $env:POC_APIM_KEY = $Key
        Invoke-Checked -Command node -Arguments @(
            (Join-Path $script:Root 'scripts\test-mcp.mjs'), $GatewayUrl, $EnvironmentName)
    } finally {
        $env:POC_APIM_KEY = $previous
    }

}

function Start-Stage {
    param([string]$Name)
    Invoke-Checked -Command node -Arguments @((Join-Path $script:Root 'scripts\report.mjs'), 'start', $Name)
}

function Complete-Stage {
    param([string]$Name)
    Invoke-Checked -Command node -Arguments @((Join-Path $script:Root 'scripts\report.mjs'), 'pass', $Name)
}

function Test-Preflight {
    param([string]$ResourceGroup, [string]$SourceApimName, [string]$TargetApimName)
    Invoke-Checked -Command node -Arguments @((Join-Path $script:Root 'scripts\preflight.mjs'),
        '--resource-group', $ResourceGroup, '--source-apim-name', $SourceApimName,
        '--target-apim-name', $TargetApimName)
}
