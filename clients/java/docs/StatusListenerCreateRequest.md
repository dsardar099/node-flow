

# StatusListenerCreateRequest


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**name** | **String** |  |  |
|**description** | **String** |  |  [optional] |
|**enabled** | **Boolean** |  |  [optional] |
|**workflowNames** | **List&lt;String&gt;** |  |  [optional] |
|**events** | [**List&lt;EventsEnum&gt;**](#List&lt;EventsEnum&gt;) |  |  [optional] |
|**sink** | [**SinkEnum**](#SinkEnum) |  |  |
|**config** | [**StatusListenerCreateRequestConfig**](StatusListenerCreateRequestConfig.md) |  |  |
|**includeOutput** | **Boolean** |  |  [optional] |



## Enum: List&lt;EventsEnum&gt;

| Name | Value |
|---- | -----|
| STARTED | &quot;STARTED&quot; |
| COMPLETED | &quot;COMPLETED&quot; |
| FAILED | &quot;FAILED&quot; |
| TIMED_OUT | &quot;TIMED_OUT&quot; |
| TERMINATED | &quot;TERMINATED&quot; |
| PAUSED | &quot;PAUSED&quot; |
| RESUMED | &quot;RESUMED&quot; |
| RESTARTED | &quot;RESTARTED&quot; |



## Enum: SinkEnum

| Name | Value |
|---- | -----|
| WEBHOOK | &quot;WEBHOOK&quot; |
| KAFKA | &quot;KAFKA&quot; |
| NATS | &quot;NATS&quot; |
| AMQP | &quot;AMQP&quot; |
| SQS | &quot;SQS&quot; |



