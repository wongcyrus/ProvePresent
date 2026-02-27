# Durable Functions Monitoring and Metrics

This document describes the monitoring and observability features added to the capture timeout durable functions.

## Overview

The capture timeout orchestrator and activity functions emit comprehensive logs and custom metrics to Application Insights. These metrics enable monitoring of system health, performance, and troubleshooting issues.

## Custom Metrics

### Orchestrator Metrics

#### CaptureOrchestrator.Duration
Tracks the total duration of orchestrator execution from start to completion.

**Properties:**
- `captureRequestId`: UUID of the capture request
- `earlyTermination`: Boolean indicating if this was an early termination
- `value`: Duration in milliseconds

**Query Example:**
```kusto
traces
| where message startswith "[METRIC] CaptureOrchestrator.Duration"
| extend metricData = parse_json(tostring(customDimensions))
| extend 
    captureRequestId = tostring(metricData.captureRequestId),
    durationMs = todouble(metricData.value),
    earlyTermination = tobool(metricData.earlyTermination)
| summarize 
    avgDuration = avg(durationMs),
    maxDuration = max(durationMs),
    minDuration = min(durationMs),
    count = count()
    by earlyTermination
| project earlyTermination, avgDuration, maxDuration, minDuration, count
```

#### CaptureOrchestrator.EarlyTermination
Tracks when orchestrators complete via early termination (all students uploaded before timeout).

**Properties:**
- `captureRequestId`: UUID of the capture request
- `value`: Always 1 (count metric)

**Query Example:**
```kusto
traces
| where message startswith "[METRIC] CaptureOrchestrator.EarlyTermination"
| extend metricData = parse_json(tostring(customDimensions))
| extend captureRequestId = tostring(metricData.captureRequestId)
| summarize earlyTerminationCount = count()
| project earlyTerminationCount
```

**Early Termination Rate:**
```kusto
let earlyTerminations = traces
| where message startswith "[METRIC] CaptureOrchestrator.EarlyTermination"
| count;
let totalOrchestrators = traces
| where message startswith "Orchestrator started for capture:"
| count;
print earlyTerminationRate = todouble(earlyTerminations) / todouble(totalOrchestrators) * 100
```

#### CaptureOrchestrator.Success
Tracks orchestrator success/failure rate.

**Properties:**
- `captureRequestId`: UUID of the capture request
- `success`: Boolean indicating success
- `value`: 1 for success, 0 for failure

**Query Example:**
```kusto
traces
| where message startswith "[METRIC] CaptureOrchestrator.Success"
| extend metricData = parse_json(tostring(customDimensions))
| extend 
    captureRequestId = tostring(metricData.captureRequestId),
    success = tobool(metricData.success)
| summarize 
    totalCount = count(),
    successCount = countif(success == true),
    failureCount = countif(success == false)
| extend successRate = todouble(successCount) / todouble(totalCount) * 100
| project totalCount, successCount, failureCount, successRate
```

### Activity Function Metrics

#### CaptureTimeout.Success
Tracks activity function success/failure rate.

**Properties:**
- `captureRequestId`: UUID of the capture request
- `uploadedCount`: Number of uploads processed
- `success`: Boolean indicating success
- `value`: 1 for success, 0 for failure

**Query Example:**
```kusto
traces
| where message startswith "[METRIC] CaptureTimeout.Success"
| extend metricData = parse_json(tostring(customDimensions))
| extend 
    captureRequestId = tostring(metricData.captureRequestId),
    uploadedCount = toint(metricData.uploadedCount),
    success = tobool(metricData.success)
| summarize 
    totalCount = count(),
    successCount = countif(success == true),
    failureCount = countif(success == false)
| extend successRate = todouble(successCount) / todouble(totalCount) * 100
| project totalCount, successCount, failureCount, successRate
```

#### CaptureTimeout.UploadCount
Tracks the number of uploads processed per capture request.

**Properties:**
- `captureRequestId`: UUID of the capture request
- `totalCount`: Total expected uploads
- `uploadPercentage`: Percentage of students who uploaded
- `value`: Number of uploads

**Query Example:**
```kusto
traces
| where message startswith "[METRIC] CaptureTimeout.UploadCount"
| extend metricData = parse_json(tostring(customDimensions))
| extend 
    captureRequestId = tostring(metricData.captureRequestId),
    uploadedCount = toint(metricData.value),
    totalCount = toint(metricData.totalCount),
    uploadPercentage = toint(metricData.uploadPercentage)
| summarize 
    avgUploadCount = avg(uploadedCount),
    avgUploadPercentage = avg(uploadPercentage),
    maxUploadCount = max(uploadedCount),
    minUploadCount = min(uploadedCount)
| project avgUploadCount, avgUploadPercentage, maxUploadCount, minUploadCount
```

## Lifecycle Logging

### Orchestrator Logs

The orchestrator emits the following lifecycle logs:

1. **Orchestrator Started**
   ```
   Orchestrator started for capture: {captureRequestId}
   ```

2. **Timer Created**
   ```
   Timer created with expiration: {expiresAt}
   ```

3. **Early Termination**
   ```
   Early termination for capture: {captureRequestId}
   ```

4. **Timer Expired**
   ```
   Timer expired for capture: {captureRequestId}
   ```

5. **Orchestrator Completed**
   ```
   Orchestrator completed successfully for capture: {captureRequestId}
   ```

6. **Orchestrator Failed**
   ```
   Orchestrator failed for capture: {captureRequestId}
   ```

**Query Example - Orchestrator Lifecycle:**
```kusto
traces
| where message contains "Orchestrator" and message contains "capture:"
| extend captureRequestId = extract(@"capture: ([a-f0-9-]+)", 1, message)
| project timestamp, message, captureRequestId
| order by timestamp asc
```

### Activity Function Logs

The activity function emits detailed logs for each processing step:

1. **Processing Started**
   ```
   Processing timeout for capture: {captureRequestId}
   ```

2. **Upload Count**
   ```
   Found {uploadedCount}/{totalCount} uploads for request: {captureRequestId}
   ```

3. **Status Updates**
   ```
   Updated status to ANALYZING for request: {captureRequestId}
   ```

4. **GPT Estimation**
   ```
   Calling GPT position estimation with {uploadedCount} images
   Position estimation completed successfully
   ```

5. **Results Broadcast**
   ```
   Broadcasted captureExpired event for request: {captureRequestId}
   Broadcasted successful results for request: {captureRequestId}
   ```

## Error Logging

### Orchestrator Errors

Orchestrator failures are logged with full error details:

```kusto
traces
| where message contains "Orchestrator failed for capture:"
| extend captureRequestId = extract(@"capture: ([a-f0-9-]+)", 1, message)
| project timestamp, message, captureRequestId, customDimensions
| order by timestamp desc
```

### Activity Function Errors

Activity function errors include detailed context:

```kusto
traces
| where message contains "Error processing capture timeout" or message contains "GPT position estimation failed"
| extend errorData = parse_json(tostring(customDimensions))
| extend 
    captureRequestId = tostring(errorData.captureRequestId),
    errorType = tostring(errorData.errorType),
    sessionId = tostring(errorData.sessionId)
| project timestamp, message, captureRequestId, errorType, sessionId
| order by timestamp desc
```

### External Event Failures

External event raise failures are logged as warnings:

```kusto
traces
| where message contains "Failed to raise external event"
| extend captureRequestId = extract(@"captureRequestId: ([a-f0-9-]+)", 1, message)
| project timestamp, message, captureRequestId
| order by timestamp desc
```

## Monitoring Dashboards

### Recommended Metrics to Monitor

1. **Orchestrator Success Rate**
   - Target: > 99%
   - Alert if < 95%

2. **Average Orchestrator Duration**
   - Target: < 60 seconds (timeout duration)
   - Alert if > 90 seconds

3. **Early Termination Rate**
   - Informational metric
   - Higher is better (indicates students uploading quickly)

4. **Activity Function Success Rate**
   - Target: > 99%
   - Alert if < 95%

5. **Average Upload Percentage**
   - Target: > 80%
   - Alert if < 50%

### Sample Dashboard Query

```kusto
let timeRange = 24h;
let orchestratorMetrics = traces
| where timestamp > ago(timeRange)
| where message startswith "[METRIC] CaptureOrchestrator"
| extend metricData = parse_json(tostring(customDimensions))
| extend 
    metricName = extract(@"\[METRIC\] ([^\:]+)", 1, message),
    captureRequestId = tostring(metricData.captureRequestId),
    value = todouble(metricData.value),
    success = tobool(metricData.success),
    earlyTermination = tobool(metricData.earlyTermination);
orchestratorMetrics
| summarize 
    avgDuration = avgif(value, metricName == "CaptureOrchestrator.Duration"),
    successRate = avgif(value, metricName == "CaptureOrchestrator.Success") * 100,
    earlyTerminationRate = countif(metricName == "CaptureOrchestrator.EarlyTermination") * 100.0 / count()
| project avgDuration, successRate, earlyTerminationRate
```

## Alerting Rules

### Critical Alerts

1. **Orchestrator Failure Rate > 5%**
   ```kusto
   traces
   | where timestamp > ago(5m)
   | where message startswith "[METRIC] CaptureOrchestrator.Success"
   | extend metricData = parse_json(tostring(customDimensions))
   | extend success = tobool(metricData.success)
   | summarize failureRate = countif(success == false) * 100.0 / count()
   | where failureRate > 5
   ```

2. **Activity Function Failure Rate > 5%**
   ```kusto
   traces
   | where timestamp > ago(5m)
   | where message startswith "[METRIC] CaptureTimeout.Success"
   | extend metricData = parse_json(tostring(customDimensions))
   | extend success = tobool(metricData.success)
   | summarize failureRate = countif(success == false) * 100.0 / count()
   | where failureRate > 5
   ```

### Warning Alerts

1. **Average Duration > 90 seconds**
   ```kusto
   traces
   | where timestamp > ago(5m)
   | where message startswith "[METRIC] CaptureOrchestrator.Duration"
   | extend metricData = parse_json(tostring(customDimensions))
   | extend durationMs = todouble(metricData.value)
   | summarize avgDuration = avg(durationMs) / 1000
   | where avgDuration > 90
   ```

2. **Low Upload Percentage < 50%**
   ```kusto
   traces
   | where timestamp > ago(15m)
   | where message startswith "[METRIC] CaptureTimeout.UploadCount"
   | extend metricData = parse_json(tostring(customDimensions))
   | extend uploadPercentage = toint(metricData.uploadPercentage)
   | summarize avgUploadPercentage = avg(uploadPercentage)
   | where avgUploadPercentage < 50
   ```

## Troubleshooting

### Common Issues

#### High Orchestrator Failure Rate

1. Check activity function errors:
   ```kusto
   traces
   | where timestamp > ago(1h)
   | where message contains "Error processing capture timeout"
   | project timestamp, message, customDimensions
   ```

2. Check for retry attempts:
   ```kusto
   traces
   | where timestamp > ago(1h)
   | where message contains "Processing timeout for capture:"
   | summarize retryCount = count() by tostring(customDimensions.captureRequestId)
   | where retryCount > 1
   ```

#### Low Upload Percentage

1. Check capture expiration timing:
   ```kusto
   traces
   | where timestamp > ago(1h)
   | where message contains "Capture window expired with partial uploads"
   | project timestamp, message, customDimensions
   ```

2. Analyze upload patterns:
   ```kusto
   traces
   | where timestamp > ago(1h)
   | where message startswith "[METRIC] CaptureTimeout.UploadCount"
   | extend metricData = parse_json(tostring(customDimensions))
   | extend uploadPercentage = toint(metricData.uploadPercentage)
   | summarize count() by bin(uploadPercentage, 10)
   | render columnchart
   ```

## Performance Optimization

### Metrics to Track

1. **Orchestrator Duration Distribution**
   ```kusto
   traces
   | where timestamp > ago(24h)
   | where message startswith "[METRIC] CaptureOrchestrator.Duration"
   | extend metricData = parse_json(tostring(customDimensions))
   | extend durationMs = todouble(metricData.value)
   | summarize count() by bin(durationMs, 5000)
   | render columnchart
   ```

2. **Early Termination Impact**
   ```kusto
   traces
   | where timestamp > ago(24h)
   | where message startswith "[METRIC] CaptureOrchestrator.Duration"
   | extend metricData = parse_json(tostring(customDimensions))
   | extend 
       durationMs = todouble(metricData.value),
       earlyTermination = tobool(metricData.earlyTermination)
   | summarize avgDuration = avg(durationMs) by earlyTermination
   | project earlyTermination, avgDurationSeconds = avgDuration / 1000
   ```

## References

- [Azure Functions Monitoring](https://learn.microsoft.com/azure/azure-functions/functions-monitoring)
- [Application Insights Telemetry](https://learn.microsoft.com/azure/azure-monitor/app/data-model-complete)
- [Kusto Query Language](https://learn.microsoft.com/azure/data-explorer/kusto/query/)
- [Durable Functions Monitoring](https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-diagnostics)
