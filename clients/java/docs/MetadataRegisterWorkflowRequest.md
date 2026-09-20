

# MetadataRegisterWorkflowRequest


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**name** | **String** |  |  |
|**version** | **Integer** |  |  [optional] |
|**description** | **String** |  |  [optional] |
|**tasks** | [**List&lt;Shared2d711327d8&gt;**](Shared2d711327d8.md) |  |  |
|**inputParameters** | **List&lt;String&gt;** |  |  [optional] |
|**outputParameters** | **Map&lt;String, Object&gt;** |  |  [optional] |
|**variables** | **Map&lt;String, Object&gt;** |  |  [optional] |
|**inputSchema** | **Object** |  |  [optional] |
|**outputSchema** | **Object** |  |  [optional] |
|**failureWorkflow** | **String** |  |  [optional] |
|**failureWorkflowVersion** | **Integer** |  |  [optional] |
|**restartable** | **Boolean** |  |  [optional] |
|**timeoutSeconds** | **BigDecimal** |  |  [optional] |
|**timeoutPolicy** | [**TimeoutPolicyEnum**](#TimeoutPolicyEnum) |  |  [optional] |
|**maxConcurrentExecutions** | **Integer** |  |  [optional] |
|**rateLimitConfig** | [**MetadataRegisterWorkflowRequestRateLimitConfig**](MetadataRegisterWorkflowRequestRateLimitConfig.md) |  |  [optional] |
|**maskedFields** | **List&lt;String&gt;** |  |  [optional] |
|**maxConcurrentTasks** | **Integer** |  |  [optional] |
|**ownerEmail** | **String** |  |  [optional] |
|**tags** | **List&lt;String&gt;** |  |  [optional] |



## Enum: TimeoutPolicyEnum

| Name | Value |
|---- | -----|
| ALERT_ONLY | &quot;ALERT_ONLY&quot; |
| RETRY | &quot;RETRY&quot; |
| TIME_OUT_WF | &quot;TIME_OUT_WF&quot; |



