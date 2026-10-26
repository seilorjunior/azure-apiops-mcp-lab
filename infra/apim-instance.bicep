param location string
param apimName string
param publisherEmail string
param publisherName string
param tags object
param backendUrl string
@secure()
param backendKey string

resource apim 'Microsoft.ApiManagement/service@2024-05-01' = {
  name: apimName
  location: location
  tags: tags
  sku: {
    name: 'Developer'
    capacity: 1
  }
  properties: {
    publisherEmail: publisherEmail
    publisherName: publisherName
    publicNetworkAccess: 'Enabled'
  }
}

resource backendSecret 'Microsoft.ApiManagement/service/namedValues@2024-05-01' = {
  parent: apim
  name: 'poc-backend-key'
  properties: {
    displayName: 'poc-backend-key'
    secret: true
    value: backendKey
  }
}

resource backend 'Microsoft.ApiManagement/service/backends@2024-05-01' = {
  parent: apim
  name: 'poc-mcp-backend'
  properties: {
    protocol: 'http'
    url: '${backendUrl}/mcp'
    credentials: {
      header: {
        'x-poc-backend-key': ['{{poc-backend-key}}']
      }
    }
    tls: {
      validateCertificateChain: true
      validateCertificateName: true
    }
  }
  dependsOn: [backendSecret]
}

resource subscription 'Microsoft.ApiManagement/service/subscriptions@2024-05-01' = {
  parent: apim
  name: 'poc-test-client'
  properties: {
    displayName: 'PoC smoke tests'
    scope: '${apim.id}/apis'
    state: 'active'
    allowTracing: false
  }
}

output apimName string = apim.name
output backendName string = backend.name
output gatewayUrl string = apim.properties.gatewayUrl
