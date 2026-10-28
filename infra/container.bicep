targetScope = 'subscription'

@minLength(1)
param environmentName string
param location string
@minLength(3)
param publisherEmail string
@secure()
@minLength(32)
param backendKey string
@minValue(0)
param budgetAmount int = 0
param budgetContactEmails array = []
param budgetStartDate string = ''

module lab './main.bicep' = {
  name: 'container-lab'
  params: {
    environmentName: environmentName
    location: location
    publisherEmail: publisherEmail
    backendKey: backendKey
    containerized: true
    budgetAmount: budgetAmount
    budgetContactEmails: budgetContactEmails
    budgetStartDate: budgetStartDate
  }
}

output AZURE_RESOURCE_GROUP string = lab.outputs.AZURE_RESOURCE_GROUP
output SOURCE_APIM_NAME string = lab.outputs.SOURCE_APIM_NAME
output TARGET_APIM_NAME string = lab.outputs.TARGET_APIM_NAME
output SOURCE_GATEWAY_URL string = lab.outputs.SOURCE_GATEWAY_URL
output TARGET_GATEWAY_URL string = lab.outputs.TARGET_GATEWAY_URL
output AZURE_WEBAPP_NAME string = lab.outputs.AZURE_WEBAPP_NAME
output BACKEND_URL string = lab.outputs.BACKEND_URL
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = lab.outputs.AZURE_CONTAINER_REGISTRY_ENDPOINT
