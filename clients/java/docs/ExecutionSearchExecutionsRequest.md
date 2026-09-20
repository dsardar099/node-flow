

# ExecutionSearchExecutionsRequest


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**status** | [**List&lt;StatusEnum&gt;**](#List&lt;StatusEnum&gt;) |  |  [optional] |
|**defName** | **String** |  |  [optional] |
|**defVersion** | **Integer** |  |  [optional] |
|**correlationId** | **String** |  |  [optional] |
|**workflowId** | **String** |  |  [optional] |
|**idempotencyKey** | **String** |  |  [optional] |
|**excludeSubWorkflows** | **Boolean** |  |  [optional] |
|**startedAfter** | **OffsetDateTime** |  |  [optional] |
|**startedBefore** | **OffsetDateTime** |  |  [optional] |
|**finished** | **Boolean** |  |  [optional] |
|**limit** | **Integer** |  |  [optional] |
|**cursor** | **String** |  |  [optional] |
|**q** | **String** |  |  [optional] |



## Enum: List&lt;StatusEnum&gt;

| Name | Value |
|---- | -----|
| RUNNING | &quot;RUNNING&quot; |
| PAUSED | &quot;PAUSED&quot; |
| COMPLETED | &quot;COMPLETED&quot; |
| FAILED | &quot;FAILED&quot; |
| TIMED_OUT | &quot;TIMED_OUT&quot; |
| TERMINATED | &quot;TERMINATED&quot; |



