targetScope = 'subscription'

@minLength(1)
param environmentName string
param location string
param publisherEmail string = 'you@example.com'
@secure()
@minLength(32)
param backendKey string

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: {
    'azd-env-name': environmentName
    purpose: 'apiops-mcp-poc'
    environment: 'poc'
  }
}

module resources './resources.bicep' = {
  name: 'apiops-mcp-resources'
  scope: rg
  params: {
    environmentName: environmentName
    location: location
    publisherEmail: publisherEmail
    backendKey: backendKey
  }
}

output AZURE_RESOURCE_GROUP string = rg.name
output SOURCE_APIM_NAME string = resources.outputs.sourceApimName
output TARGET_APIM_NAME string = resources.outputs.targetApimName
output SOURCE_GATEWAY_URL string = resources.outputs.sourceGatewayUrl
output TARGET_GATEWAY_URL string = resources.outputs.targetGatewayUrl
output AZURE_WEBAPP_NAME string = resources.outputs.appName
output BACKEND_URL string = resources.outputs.backendUrl
