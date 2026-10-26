param apimName string
param backendName string

resource apim 'Microsoft.ApiManagement/service@2024-05-01' existing = {
  name: apimName
}

resource rest 'Microsoft.ApiManagement/service/apis@2025-09-01-preview' = {
  parent: apim
  name: 'poc-rest'
  properties: {
    displayName: 'PoC REST source'
    apiType: 'http'
    path: 'poc-rest'
    protocols: ['https']
    subscriptionRequired: true
  }
}

resource status 'Microsoft.ApiManagement/service/apis/operations@2024-05-01' = {
  parent: rest
  name: 'get-status'
  properties: {
    displayName: 'Get status'
    description: 'Return deterministic PoC status.'
    method: 'GET'
    urlTemplate: '/status'
    responses: [
      {
        statusCode: 200
        representations: [
          {
            contentType: 'application/json'
            examples: {
              default: {
                value: '{"status":"apiops-rest-ok"}'
              }
            }
          }
        ]
      }
    ]
  }
}

resource mock 'Microsoft.ApiManagement/service/apis/operations/policies@2024-05-01' = {
  parent: status
  name: 'policy'
  properties: {
    format: 'rawxml'
    value: '<policies><inbound><base /><return-response><set-status code="200" reason="OK" /><set-header name="Content-Type" exists-action="override"><value>application/json</value></set-header><set-body>{"status":"apiops-rest-ok"}</set-body></return-response></inbound><backend><base /></backend><outbound><base /></outbound><on-error><base /></on-error></policies>'
  }
}

resource native 'Microsoft.ApiManagement/service/apis@2025-09-01-preview' = {
  parent: apim
  name: 'poc-native'
  properties: {
    displayName: 'PoC REST-to-MCP source'
    type: 'mcp'
    path: 'poc-native'
    protocols: ['https']
    subscriptionRequired: true
    mcpTools: [
      {
        name: 'get_status'
        description: 'Read the deterministic PoC status.'
        operationId: status.id
      }
    ]
  }
  dependsOn: [mock]
}

resource proxy 'Microsoft.ApiManagement/service/apis@2025-09-01-preview' = {
  parent: apim
  name: 'poc-proxy'
  properties: {
    displayName: 'PoC external MCP source'
    type: 'mcp'
    path: 'poc-proxy/mcp'
    protocols: ['https']
    subscriptionRequired: true
    backendId: backendName
    mcpProperties: {
      transportType: 'streamable'
    }
  }
}
