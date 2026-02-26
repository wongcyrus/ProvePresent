// Azure Storage Account with Table Storage
// Requirements: 19.1, 19.4

@description('Storage Account name')
param storageAccountName string

@description('Location for the storage account')
param location string

@description('Tags to apply to the resource')
param tags object

// ============================================================================
// STORAGE ACCOUNT
// ============================================================================

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageAccountName
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true // Required for Table Storage
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
    encryption: {
      services: {
        table: {
          enabled: true
          keyType: 'Account'
        }
        blob: {
          enabled: true
          keyType: 'Account'
        }
      }
      keySource: 'Microsoft.Storage'
    }
  }
}

// ============================================================================
// TABLE SERVICE
// ============================================================================

resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-01-01' = {
  parent: storageAccount
  name: 'default'
  properties: {}
}

// Create tables for the application
resource sessionsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: tableService
  name: 'Sessions'
}

resource attendanceTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: tableService
  name: 'Attendance'
}

resource tokensTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: tableService
  name: 'Tokens'
}

resource chainsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: tableService
  name: 'Chains'
}

resource scanLogsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: tableService
  name: 'ScanLogs'
}

resource userSessionsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: tableService
  name: 'UserSessions'
}

resource attendanceSnapshotsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: tableService
  name: 'AttendanceSnapshots'
}

resource chainHistoryTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: tableService
  name: 'ChainHistory'
}

resource deletionLogTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: tableService
  name: 'DeletionLog'
}

// Quiz tables
resource quizQuestionsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: tableService
  name: 'QuizQuestions'
}

resource quizResponsesTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: tableService
  name: 'QuizResponses'
}

resource quizMetricsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: tableService
  name: 'QuizMetrics'
}

// Student image capture tables
resource captureRequestsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: tableService
  name: 'CaptureRequests'
}

resource captureUploadsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: tableService
  name: 'CaptureUploads'
}

resource captureResultsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: tableService
  name: 'CaptureResults'
}

// ============================================================================
// BLOB SERVICE
// ============================================================================

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: 7
    }
  }
}

// Quiz slides container
resource quizSlidesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: 'quiz-slides'
  properties: {
    publicAccess: 'None'
  }
}

// Student image captures container
resource studentCapturesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: 'student-captures'
  properties: {
    publicAccess: 'None'
  }
}

// ============================================================================
// OUTPUTS
// ============================================================================

@description('Storage Account name')
output storageAccountName string = storageAccount.name

@description('Storage Account ID')
output storageAccountId string = storageAccount.id

@description('Storage Account Table endpoint')
output tableEndpoint string = storageAccount.properties.primaryEndpoints.table

@description('Storage Account primary key')
output storageAccountKey string = storageAccount.listKeys().keys[0].value

@description('Storage Account Blob endpoint')
output blobEndpoint string = storageAccount.properties.primaryEndpoints.blob
