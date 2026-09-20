

# MetadataUpsertTaskDefinitionRequest


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**name** | **String** |  |  |
|**description** | **String** |  |  [optional] |
|**inputKeys** | **List&lt;String&gt;** |  |  [optional] |
|**outputKeys** | **List&lt;String&gt;** |  |  [optional] |
|**inputSchema** | **Object** |  |  [optional] |
|**outputSchema** | **Object** |  |  [optional] |
|**secretOutputFields** | **List&lt;String&gt;** |  |  [optional] |
|**ownerEmail** | **String** |  |  [optional] |
|**retryCount** | **Integer** |  |  [optional] |
|**retryLogic** | [**RetryLogicEnum**](#RetryLogicEnum) |  |  [optional] |
|**retryDelaySeconds** | **BigDecimal** |  |  [optional] |
|**backoffScaleFactor** | **BigDecimal** |  |  [optional] |
|**maxRetryDelaySeconds** | **BigDecimal** |  |  [optional] |
|**jitter** | **BigDecimal** |  |  [optional] |
|**retryBudget** | **BigDecimal** |  |  [optional] |
|**nonRetryableErrors** | **List&lt;String&gt;** |  |  [optional] |
|**timeoutSeconds** | **BigDecimal** |  |  [optional] |
|**scheduleToStartTimeout** | **BigDecimal** |  |  [optional] |
|**startToCloseTimeout** | **BigDecimal** |  |  [optional] |
|**heartbeatTimeout** | **BigDecimal** |  |  [optional] |
|**responseTimeoutSeconds** | **BigDecimal** |  |  [optional] |
|**pollTimeoutSeconds** | **BigDecimal** |  |  [optional] |
|**timeoutPolicy** | [**TimeoutPolicyEnum**](#TimeoutPolicyEnum) |  |  [optional] |
|**concurrentExecLimit** | **Integer** |  |  [optional] |
|**rateLimitPerFrequency** | **Integer** |  |  [optional] |
|**rateLimitFrequencySeconds** | **Integer** |  |  [optional] |
|**semaphores** | **List&lt;String&gt;** |  |  [optional] |



## Enum: RetryLogicEnum

| Name | Value |
|---- | -----|
| FIXED | &quot;FIXED&quot; |
| LINEAR_BACKOFF | &quot;LINEAR_BACKOFF&quot; |
| EXPONENTIAL_BACKOFF | &quot;EXPONENTIAL_BACKOFF&quot; |



## Enum: TimeoutPolicyEnum

| Name | Value |
|---- | -----|
| ALERT_ONLY | &quot;ALERT_ONLY&quot; |
| RETRY | &quot;RETRY&quot; |
| TIME_OUT_WF | &quot;TIME_OUT_WF&quot; |



