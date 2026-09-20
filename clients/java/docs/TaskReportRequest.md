

# TaskReportRequest


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**queueName** | **String** |  |  |
|**workflowId** | **UUID** |  |  |
|**leaseToken** | **UUID** |  |  |
|**status** | [**StatusEnum**](#StatusEnum) |  |  |
|**output** | **Map&lt;String, Object&gt;** |  |  [optional] |
|**reason** | **String** |  |  [optional] |



## Enum: StatusEnum

| Name | Value |
|---- | -----|
| COMPLETED | &quot;COMPLETED&quot; |
| FAILED | &quot;FAILED&quot; |
| FAILED_WITH_TERMINAL_ERROR | &quot;FAILED_WITH_TERMINAL_ERROR&quot; |



