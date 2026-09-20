

# ExecutionStartRequest


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**version** | **Integer** |  |  [optional] |
|**input** | **Map&lt;String, Object&gt;** |  |  [optional] |
|**taskToDomain** | **Map&lt;String, String&gt;** |  |  [optional] |
|**correlationId** | **String** |  |  [optional] |
|**idempotencyKey** | **String** |  |  [optional] |
|**idempotencyStrategy** | [**IdempotencyStrategyEnum**](#IdempotencyStrategyEnum) |  |  [optional] |
|**priority** | **Integer** |  |  [optional] |
|**variables** | **Map&lt;String, Object&gt;** |  |  [optional] |



## Enum: IdempotencyStrategyEnum

| Name | Value |
|---- | -----|
| RETURN_EXISTING | &quot;RETURN_EXISTING&quot; |
| FAIL | &quot;FAIL&quot; |
| FAIL_ON_RUNNING | &quot;FAIL_ON_RUNNING&quot; |



