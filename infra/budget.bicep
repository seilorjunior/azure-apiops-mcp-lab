targetScope = 'resourceGroup'

@minValue(1)
@description('Monthly budget in the subscription billing currency. Alerts do not cap spending.')
param amount int
@minLength(1)
@description('Email recipients for cost alerts. Do not commit personal addresses.')
param contactEmails array
@minLength(10)
@description('First day of the budget start month, YYYY-MM-01. Preserve this value on redeployments.')
param startDate string

resource budget 'Microsoft.Consumption/budgets@2024-08-01' = {
  name: 'apiops-mcp-monthly'
  properties: {
    category: 'Cost'
    amount: amount
    timeGrain: 'Monthly'
    timePeriod: { startDate: startDate }
    notifications: {
      actual80: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 80
        thresholdType: 'Actual'
        contactEmails: contactEmails
      }
      actual100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Actual'
        contactEmails: contactEmails
      }
      forecast100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Forecasted'
        contactEmails: contactEmails
      }
    }
  }
}
