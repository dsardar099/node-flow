

# Shared2d711327d8CompensateWith


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**name** | **String** |  |  |
|**taskReferenceName** | **String** |  |  |
|**type** | [**TypeEnum**](#TypeEnum) |  |  |
|**description** | **String** |  |  [optional] |
|**inputParameters** | **Map&lt;String, Object&gt;** |  |  [optional] |
|**optional** | **Boolean** |  |  [optional] |
|**asyncComplete** | **Boolean** |  |  [optional] |
|**startDelaySeconds** | **BigDecimal** |  |  [optional] |
|**cacheConfig** | [**Shared2d711327d8CacheConfig**](Shared2d711327d8CacheConfig.md) |  |  [optional] |
|**retryCount** | **Integer** |  |  [optional] |
|**domain** | **String** |  |  [optional] |
|**evaluatorType** | [**EvaluatorTypeEnum**](#EvaluatorTypeEnum) |  |  [optional] |
|**expression** | **String** |  |  [optional] |
|**decisionCases** | **Map&lt;String, List&lt;Shared2d711327d8&gt;&gt;** |  |  [optional] |
|**defaultCase** | [**List&lt;Shared2d711327d8&gt;**](Shared2d711327d8.md) |  |  [optional] |
|**forkTasks** | **List&lt;List&lt;Shared2d711327d8&gt;&gt;** |  |  [optional] |
|**dynamicForkTasksParam** | **String** |  |  [optional] |
|**dynamicForkTasksInputParamName** | **String** |  |  [optional] |
|**joinOn** | **List&lt;String&gt;** |  |  [optional] |
|**loopCondition** | **String** |  |  [optional] |
|**loopOver** | [**List&lt;Shared2d711327d8&gt;**](Shared2d711327d8.md) |  |  [optional] |
|**dynamicTaskNameParam** | **String** |  |  [optional] |
|**subWorkflowParam** | [**Shared2d711327d8SubWorkflowParam**](Shared2d711327d8SubWorkflowParam.md) |  |  [optional] |
|**compensateWith** | [**Shared2d711327d8CompensateWith**](Shared2d711327d8CompensateWith.md) |  |  [optional] |



## Enum: TypeEnum

| Name | Value |
|---- | -----|
| SIMPLE | &quot;SIMPLE&quot; |
| SWITCH | &quot;SWITCH&quot; |
| DO_WHILE | &quot;DO_WHILE&quot; |
| FORK_JOIN | &quot;FORK_JOIN&quot; |
| FORK_JOIN_DYNAMIC | &quot;FORK_JOIN_DYNAMIC&quot; |
| JOIN | &quot;JOIN&quot; |
| EXCLUSIVE_JOIN | &quot;EXCLUSIVE_JOIN&quot; |
| DYNAMIC | &quot;DYNAMIC&quot; |
| SUB_WORKFLOW | &quot;SUB_WORKFLOW&quot; |
| START_WORKFLOW | &quot;START_WORKFLOW&quot; |
| TERMINATE | &quot;TERMINATE&quot; |
| SET_VARIABLE | &quot;SET_VARIABLE&quot; |
| GET_WORKFLOW | &quot;GET_WORKFLOW&quot; |
| YIELD | &quot;YIELD&quot; |
| NOOP | &quot;NOOP&quot; |
| HTTP | &quot;HTTP&quot; |
| HTTP_POLL | &quot;HTTP_POLL&quot; |
| INLINE | &quot;INLINE&quot; |
| JSON_JQ_TRANSFORM | &quot;JSON_JQ_TRANSFORM&quot; |
| EVENT | &quot;EVENT&quot; |
| KAFKA_PUBLISH | &quot;KAFKA_PUBLISH&quot; |
| WAIT | &quot;WAIT&quot; |
| WAIT_FOR_WEBHOOK | &quot;WAIT_FOR_WEBHOOK&quot; |
| PULL_WORKFLOW_MESSAGES | &quot;PULL_WORKFLOW_MESSAGES&quot; |
| WEBHOOK | &quot;WEBHOOK&quot; |
| HUMAN | &quot;HUMAN&quot; |
| BUSINESS_RULE | &quot;BUSINESS_RULE&quot; |
| JDBC | &quot;JDBC&quot; |
| GRPC | &quot;GRPC&quot; |
| UPDATE_TASK | &quot;UPDATE_TASK&quot; |
| UPDATE_SECRET | &quot;UPDATE_SECRET&quot; |
| GET_SIGNED_JWT | &quot;GET_SIGNED_JWT&quot; |
| LLM_TEXT_COMPLETE | &quot;LLM_TEXT_COMPLETE&quot; |
| LLM_CHAT_COMPLETE | &quot;LLM_CHAT_COMPLETE&quot; |
| LLM_GENERATE_EMBEDDINGS | &quot;LLM_GENERATE_EMBEDDINGS&quot; |
| LLM_INDEX_TEXT | &quot;LLM_INDEX_TEXT&quot; |
| LLM_SEARCH_INDEX | &quot;LLM_SEARCH_INDEX&quot; |
| CHUNK_TEXT | &quot;CHUNK_TEXT&quot; |
| LIST_MCP_TOOLS | &quot;LIST_MCP_TOOLS&quot; |
| CALL_MCP_TOOL | &quot;CALL_MCP_TOOL&quot; |
| AGENT | &quot;AGENT&quot; |
| PARSE_DOCUMENT | &quot;PARSE_DOCUMENT&quot; |
| GENERATE_IMAGE | &quot;GENERATE_IMAGE&quot; |
| GENERATE_AUDIO | &quot;GENERATE_AUDIO&quot; |
| GENERATE_VIDEO | &quot;GENERATE_VIDEO&quot; |



## Enum: EvaluatorTypeEnum

| Name | Value |
|---- | -----|
| VALUE_PARAM | &quot;value-param&quot; |
| JAVASCRIPT | &quot;javascript&quot; |
| JSONPATH | &quot;jsonpath&quot; |



