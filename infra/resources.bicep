targetScope = 'resourceGroup'

param location string = 'eastus2'
param publisherEmail string = 'you@example.com'
param publisherName string = 'APIops MCP PoC'
param environmentName string
param nameSuffix string = uniqueString(resourceGroup().id)
@secure()
@minLength(32)
param backendKey string

var tags = {
  purpose: 'apiops-mcp-poc'
  environment: 'poc'
  'azd-env-name': environmentName
}

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'plan-mcp-${nameSuffix}'
  location: location
  tags: tags
  kind: 'linux'
  sku: {
    name: 'B1'
    tier: 'Basic'
    capacity: 1
  }
  properties: {
    reserved: true
  }
}

resource app 'Microsoft.Web/sites@2024-04-01' = {
  name: 'app-mcp-${nameSuffix}'
  location: location
  tags: union(tags, { 'azd-service-name': 'backend' })
  kind: 'app,linux'
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      appCommandLine: 'npm start'
      alwaysOn: true
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      healthCheckPath: '/health'
      appSettings: [
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'true' }
        { name: 'POC_BACKEND_KEY', value: backendKey }
        { name: 'NODE_ENV', value: 'production' }
      ]
    }
  }
}

module sourceApim './apim-instance.bicep' = {
  name: 'source-apim'
  params: {
    location: location
    apimName: 'apim-mcp-src-${nameSuffix}'
    publisherEmail: publisherEmail
    publisherName: publisherName
    tags: union(tags, { role: 'source' })
    backendUrl: 'https://${app.properties.defaultHostName}'
    backendKey: backendKey
  }
}

module targetApim './apim-instance.bicep' = {
  name: 'target-apim'
  params: {
    location: location
    apimName: 'apim-mcp-dst-${nameSuffix}'
    publisherEmail: publisherEmail
    publisherName: publisherName
    tags: union(tags, { role: 'target' })
    backendUrl: 'https://${app.properties.defaultHostName}'
    backendKey: backendKey
  }
}

module source './source-apis.bicep' = {
  name: 'seed-source-apis'
  params: {
    apimName: sourceApim.outputs.apimName
    backendName: sourceApim.outputs.backendName
  }
}

output sourceApimName string = sourceApim.outputs.apimName
output targetApimName string = targetApim.outputs.apimName
output appName string = app.name
output sourceGatewayUrl string = sourceApim.outputs.gatewayUrl
output targetGatewayUrl string = targetApim.outputs.gatewayUrl
output backendUrl string = 'https://${app.properties.defaultHostName}'
