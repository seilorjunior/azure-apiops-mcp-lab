#Requires -Version 7.2
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ResourceGroup,
    [Parameter(Mandatory)][string]$SourceApimName,
    [Parameter(Mandatory)][string]$TargetApimName,
    [switch]$Apply
)
. (Join-Path $PSScriptRoot 'Common.ps1')
Assert-Subscription
if ($SourceApimName -eq $TargetApimName) {
    throw 'Source and target APIM instances must be different.'
}
$service = Get-ServiceUrl -ResourceGroup $ResourceGroup -ApimName $SourceApimName
$targetService = Get-ServiceUrl -ResourceGroup $ResourceGroup -ApimName $TargetApimName
$apim = Invoke-AzJson -Arguments @('rest', '--url', "${service}?api-version=$script:ApiVersion")
$targetApim = Invoke-AzJson -Arguments @('rest', '--url', "${targetService}?api-version=$script:ApiVersion")
$gateway = $apim.properties.gatewayUrl
$targetGateway = $targetApim.properties.gatewayUrl
$key = Get-TestKey -ServiceUrl $service
$targetKey = Get-TestKey -ServiceUrl $targetService
$sourceNames = @('poc-rest', 'poc-native', 'poc-proxy')

function Get-SourceSnapshot {
    $snapshot = [ordered]@{}
    foreach ($path in @('poc-rest', 'poc-native', 'poc-proxy',
        'poc-rest/operations/get-status', 'poc-rest/operations/get-status/policies/policy')) {
        $resource = Invoke-AzJson -Arguments @('rest', '--url', "$service/apis/${path}?api-version=$script:ApiVersion",
            '--headers', 'Accept=application/json')
        $snapshot[$path] = $resource.properties
    }
    $snapshot | ConvertTo-Json -Depth 100 -Compress
}

$previousApiVersion = $env:AZURE_API_VERSION
Push-Location $script:Root
try {
    $env:AZURE_API_VERSION = $script:ApiVersion
    Test-Preflight -ResourceGroup $ResourceGroup -SourceApimName $SourceApimName -TargetApimName $TargetApimName
    Start-Stage source-mcp
    Test-McpEndpoints -GatewayUrl $gateway -EnvironmentName source -Key $key
    Complete-Stage source-mcp
    Start-Stage source-snapshot
    $before = Get-SourceSnapshot
    Complete-Stage source-snapshot
    $folder = Join-Path $script:Root "artifacts\run-$([guid]::NewGuid().ToString('N'))"
    $cli = Join-Path $script:Root 'node_modules\.bin\apiops.cmd'
    if (-not (Test-Path -LiteralPath $cli)) { throw 'Run npm ci before promoting.' }
    $filter = Join-Path $script:Root 'config\source-filter.yaml'
    $context = @('--subscription-id', $script:SubscriptionId, '--resource-group', $ResourceGroup)
    Start-Stage extraction
    Invoke-Checked -Command $cli -Arguments (@('extract') + $context + @('--service-name', $SourceApimName) +
        @('--output', $folder, '--filter', $filter, '--no-transitive'))
    Complete-Stage extraction
    Start-Stage artifact-validation
    $before | & node (Join-Path $script:Root 'scripts\validate-extraction.mjs') $folder
    if ($LASTEXITCODE -ne 0) { throw 'Extracted API configuration validation failed.' }
    $publish = @('publish') + $context + @('--service-name', $TargetApimName,
        '--source', $folder, '--filter', $filter, '--no-transitive')
    Start-Stage publisher-preview
    Invoke-Checked -Command $cli -Arguments ($publish + @('--dry-run'))
    Complete-Stage publisher-preview
    if (-not $Apply) {
        Write-Host "Dry-run complete. Artifacts: $folder"
        Write-Host "Review changes to $TargetApimName, then re-run with -Apply to publish and test."
        return
    }
    Start-Stage publication
    Invoke-Checked -Command $cli -Arguments $publish
    Complete-Stage publication
    Start-Stage target-validation
    foreach ($name in $sourceNames) {
        $target = Invoke-AzJson -Arguments @('rest', '--url',
            "$targetService/apis/${name}?api-version=$script:ApiVersion")
        if ($name -eq 'poc-native') {
            $expected = "$targetService/apis/poc-rest/operations/get-status".Replace('https://management.azure.com', '')
            if ($target.properties.mcpTools[0].operationId -ne $expected) {
                throw 'Target MCP tool still references the source REST API or an unexpected operation.'
            }
        }
        $expectedPath = if ($name -eq 'poc-proxy') { 'poc-proxy/mcp' } else { $name }
        if ($target.properties.path -ne $expectedPath) {
            throw "Target API $name did not preserve the canonical gateway path."
        }
    }
    Complete-Stage target-validation
    Start-Stage source-preservation
    if ((Get-SourceSnapshot) -ne $before) { throw 'Source API configuration changed during promotion.' }
    Complete-Stage source-preservation
    Start-Stage source-mcp
    Test-McpEndpoints -GatewayUrl $gateway -EnvironmentName source -Key $key
    Complete-Stage source-mcp
    Start-Stage target-mcp
    Test-McpEndpoints -GatewayUrl $targetGateway -EnvironmentName target -Key $targetKey
    Complete-Stage target-mcp
    Write-Host "PASS: both MCP modes promoted; source configuration unchanged. Artifacts: $folder"
} finally {
    $env:AZURE_API_VERSION = $previousApiVersion
    Pop-Location
}
