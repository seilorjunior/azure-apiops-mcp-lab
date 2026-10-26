#Requires -Version 7.2
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$mockRoot = Split-Path $PSScriptRoot -Parent
$mockCli = Join-Path $mockRoot 'node_modules\.bin\apiops.cmd'
$global:ApiopsPromotionMock = @{
    Calls = [Collections.Generic.List[object]]::new()
    Folders = [Collections.Generic.List[string]]::new()
    WrongBinding = $false
    ChangedPolicy = $false
    PolicyReads = 0
    ArmScope = '/subscriptions/00000000-0000-4000-8000-000000000001/resourceGroups/test-rg/providers/Microsoft.ApiManagement/service'
}

function Assert-Mock {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function az {
    $arguments = @($args)
    $global:LASTEXITCODE = 0
    if ($arguments[0] -eq 'account') {
        return '{"id":"00000000-0000-4000-8000-000000000001"}'
    }
    Assert-Mock ($arguments[0] -eq 'rest') 'Unexpected Azure command.'
    $url = $arguments[[array]::IndexOf($arguments, '--url') + 1]
    Assert-Mock ($url -match '/service/(src|dst)(/|\?)') 'Unexpected APIM scope.'
    $instance = $Matches[1]
    if ($url -match '/listSecrets\?') {
        return (@{ primaryKey = "$instance-key" } | ConvertTo-Json)
    }
    if ($url -notmatch '/apis/') {
        return (@{ properties = @{ gatewayUrl = "https://$instance.example.test" } } | ConvertTo-Json)
    }
    $path = ($url -split '/apis/', 2)[1].Split('?')[0]
    if ($path -eq 'poc-rest/operations/get-status/policies/policy') {
        if ($arguments -notcontains '--headers' -or $arguments -notcontains 'Accept=application/json') {
            return "$([char]0xFEFF)<policies><inbound /></policies>"
        }
        $global:ApiopsPromotionMock.PolicyReads++
        $marker = if ($global:ApiopsPromotionMock.ChangedPolicy -and $global:ApiopsPromotionMock.PolicyReads -gt 1) {
            'changed'
        } else { 'unchanged' }
        return (@{ properties = @{ format = 'xml'; value = "<policies><inbound><base /></inbound><!-- $marker --></policies>" } } |
            ConvertTo-Json -Depth 20)
    }
    $properties = @{ path = $path; marker = 'unchanged' }
    if ($path -eq 'poc-proxy') { $properties.path = 'poc-proxy/mcp' }
    if ($path -eq 'poc-native') {
        $bindingInstance = if ($global:ApiopsPromotionMock.WrongBinding) { 'src' } else { $instance }
        $properties.mcpTools = @(@{
            name = 'get_status'
            operationId = "$($global:ApiopsPromotionMock.ArmScope)/$bindingInstance/apis/poc-rest/operations/get-status"
        })
    }
    return (@{ properties = $properties } | ConvertTo-Json -Depth 20)
}

function node {
    $arguments = @($args)
    $global:ApiopsPromotionMock.Calls.Add(@{ kind = 'mcp'; gateway = $arguments[1]; environment = $arguments[2]; key = $env:POC_APIM_KEY })
    $global:LASTEXITCODE = 0
}

function Invoke-MockApiops {
    $arguments = @($args)
    Assert-Mock ($env:AZURE_API_VERSION -eq '2025-09-01-preview') 'API version was not set.'
    Assert-Mock ($arguments -contains '--no-transitive') 'Transitive dependencies must stay disabled.'
    Assert-Mock ($arguments -notcontains '--delete-unmatched') 'Deletion flag must not be used.'
    Assert-Mock ($arguments -notcontains '--overrides') 'Cross-instance promotion needs no name affixes.'
    $instance = $arguments[[array]::IndexOf($arguments, '--service-name') + 1]
    $global:ApiopsPromotionMock.Calls.Add(@{ kind = $arguments[0]; instance = $instance; dryRun = ($arguments -contains '--dry-run') })
    if ($arguments[0] -eq 'extract') {
        Assert-Mock ($instance -eq 'src') 'Extraction must use source APIM.'
        $folder = $arguments[[array]::IndexOf($arguments, '--output') + 1]
        $global:ApiopsPromotionMock.Folders.Add($folder)
        foreach ($name in @('poc-rest', 'poc-native', 'poc-proxy')) {
            $directory = Join-Path $folder "apis\$name"
            $null = New-Item -ItemType Directory -Path $directory -Force
            @{
                properties = @{
                    mcpTools = @(@{ name = 'get_status' })
                    mcpProperties = @{ transportType = 'streamable' }
                }
            } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $directory 'apiInformation.json')
        }
    } else {
        Assert-Mock ($arguments[0] -eq 'publish' -and $instance -eq 'dst') 'Publication must use target APIM.'
    }
    $global:LASTEXITCODE = 0
}

$previousVersion = $env:AZURE_API_VERSION
$previousKey = $env:POC_APIM_KEY
Set-Alias -Name $mockCli -Value Invoke-MockApiops
try {
    $env:AZURE_API_VERSION = 'test-previous-version'
    $env:POC_APIM_KEY = 'test-previous-key'
    $promote = Join-Path $mockRoot 'scripts\ps1\Promote.ps1'
    & $promote -ResourceGroup test-rg -SourceApimName src -TargetApimName dst
    $publications = @($global:ApiopsPromotionMock.Calls | Where-Object kind -eq 'publish')
    Assert-Mock ($publications.Count -eq 1 -and $publications[0].dryRun) 'Default run must only dry-run.'
    Assert-Mock ($env:AZURE_API_VERSION -eq 'test-previous-version') 'API-version environment was not restored.'

    $global:ApiopsPromotionMock.Calls.Clear()
    & $promote -ResourceGroup test-rg -SourceApimName src -TargetApimName dst -Apply
    $publications = @($global:ApiopsPromotionMock.Calls | Where-Object kind -eq 'publish')
    Assert-Mock ($publications.Count -eq 2 -and $publications[0].dryRun -and -not $publications[1].dryRun) 'Apply must preview before publishing.'
    $tests = @($global:ApiopsPromotionMock.Calls | Where-Object kind -eq 'mcp')
    Assert-Mock ($tests.Count -eq 3) 'Source must be tested before and after, and target after publication.'
    Assert-Mock ($tests[0].gateway -eq 'https://src.example.test' -and $tests[0].key -eq 'src-key') 'Source gateway/key mismatch.'
    Assert-Mock ($tests[2].gateway -eq 'https://dst.example.test' -and $tests[2].key -eq 'dst-key') 'Target gateway/key mismatch.'
    Assert-Mock ($env:POC_APIM_KEY -eq 'test-previous-key') 'Subscription-key environment was not restored.'

    $global:ApiopsPromotionMock.ChangedPolicy = $true
    $global:ApiopsPromotionMock.PolicyReads = 0
    $rejected = $false
    try {
        & $promote -ResourceGroup test-rg -SourceApimName src -TargetApimName dst -Apply
    } catch {
        if ($_.Exception.Message -notmatch 'Source API configuration changed') { throw }
        $rejected = $true
    }
    Assert-Mock $rejected 'Changed source policy content must fail preservation checks.'
    $global:ApiopsPromotionMock.ChangedPolicy = $false

    $global:ApiopsPromotionMock.WrongBinding = $true
    $rejected = $false
    try {
        & $promote -ResourceGroup test-rg -SourceApimName src -TargetApimName dst -Apply
    } catch {
        if ($_.Exception.Message -notmatch 'Target MCP tool still references') { throw }
        $rejected = $true
    }
    Assert-Mock $rejected 'A target MCP binding to source APIM must fail.'
    Assert-Mock ($env:AZURE_API_VERSION -eq 'test-previous-version') 'Environment must be restored on failure.'

    $rejected = $false
    try {
        & $promote -ResourceGroup test-rg -SourceApimName src -TargetApimName src
    } catch {
        if ($_.Exception.Message -notmatch 'must be different') { throw }
        $rejected = $true
    }
    Assert-Mock $rejected 'Identical source/target instances must be rejected.'
    Write-Host 'PASS: offline promotion wiring, dry-run/apply, distinct gateways/keys, scope guard and environment restoration.'
} finally {
    Remove-Item -LiteralPath "Alias:$mockCli"
    $env:AZURE_API_VERSION = $previousVersion
    $env:POC_APIM_KEY = $previousKey
    foreach ($folder in $global:ApiopsPromotionMock.Folders) {
        for ($attempt = 1; $attempt -le 5 -and (Test-Path -LiteralPath $folder); $attempt++) {
            try {
                Remove-Item -LiteralPath $folder -Recurse -ErrorAction Stop
            } catch [System.IO.IOException] {
                if ($attempt -eq 5) { throw }
                Write-Warning "Temporary test artifact is locked; retrying cleanup ($attempt/5)."
                Start-Sleep -Milliseconds 200
            }
        }
    }
    Remove-Variable -Name ApiopsPromotionMock -Scope Global
}
