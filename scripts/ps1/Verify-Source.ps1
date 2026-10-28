#Requires -Version 7.2
. (Join-Path $PSScriptRoot 'Common.ps1')
foreach ($name in @('AZURE_RESOURCE_GROUP', 'SOURCE_APIM_NAME', 'TARGET_APIM_NAME', 'SOURCE_GATEWAY_URL', 'BACKEND_URL')) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
        throw "Missing azd output $name. Provision the selected environment first."
    }
}
Assert-Subscription
Test-Preflight -ResourceGroup $env:AZURE_RESOURCE_GROUP -SourceApimName $env:SOURCE_APIM_NAME -TargetApimName $env:TARGET_APIM_NAME
$response = Invoke-WebRequest -Uri "$env:BACKEND_URL/health" -TimeoutSec 60
if (($response.Content | ConvertFrom-Json).status -ne 'ok') {
    throw 'Backend health check failed.'
}
$service = Get-ServiceUrl -ResourceGroup $env:AZURE_RESOURCE_GROUP -ApimName $env:SOURCE_APIM_NAME
$key = Get-TestKey -ServiceUrl $service
Test-McpEndpoints -GatewayUrl $env:SOURCE_GATEWAY_URL -EnvironmentName source -Key $key
Write-Information 'Source MCP tests passed. Next, preview APIops promotion:' -InformationAction Continue
Write-Information ".\scripts\ps1\Promote.ps1 -ResourceGroup $env:AZURE_RESOURCE_GROUP -SourceApimName $env:SOURCE_APIM_NAME -TargetApimName $env:TARGET_APIM_NAME" -InformationAction Continue
