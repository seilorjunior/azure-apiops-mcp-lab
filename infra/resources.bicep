targetScope = 'resourceGroup'

param location string = 'eastus2'
@minLength(3)
param publisherEmail string
param publisherName string = 'APIops MCP PoC'
param environmentName string
param nameSuffix string = uniqueString(resourceGroup().id)
@secure()
@minLength(32)
param backendKey string
param containerized bool = false
@minValue(0)
param budgetAmount int = 0
param budgetContactEmails array = []
param budgetStartDate string = ''

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
  kind: containerized ? 'app,linux,container' : 'app,linux'
  identity: {
    type: containerized ? 'SystemAssigned' : 'None'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: containerized ? 'DOCKER|${registry!.properties.loginServer}/backend:latest' : 'NODE|22-lts'
      appCommandLine: containerized ? '' : 'npm start'
      acrUseManagedIdentityCreds: containerized
      alwaysOn: true
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      healthCheckPath: '/health'
      appSettings: [
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: containerized ? 'false' : 'true' }
        { name: 'POC_BACKEND_KEY', value: backendKey }
        { name: 'NODE_ENV', value: 'production' }
        { name: 'WEBSITES_PORT', value: '8080' }
      ]
    }
  }
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = if (containerized) {
  name: 'acrmcp${nameSuffix}'
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

resource registryPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (containerized) {
  name: guid(registry!.id, app.id, 'AcrPull')
  scope: registry
  properties: {
    principalId: app.identity!.principalId!
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
  }
}

module budget './budget.bicep' = if (budgetAmount > 0) {
  name: 'lab-budget'
  params: {
    amount: max(1, budgetAmount)
    contactEmails: budgetContactEmails
    startDate: budgetStartDate
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
output containerRegistryEndpoint string = containerized ? registry!.properties.loginServer : ''
