

# IntegrationPutRequest


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**kind** | [**KindEnum**](#KindEnum) |  |  |
|**provider** | **String** |  |  |
|**description** | **String** |  |  [optional] |
|**baseUrl** | **String** |  |  [optional] |
|**apiKeySecret** | **String** |  |  [optional] |
|**models** | **List&lt;String&gt;** |  |  [optional] |
|**config** | **Map&lt;String, Object&gt;** |  |  [optional] |
|**enabled** | **Boolean** |  |  [optional] |



## Enum: KindEnum

| Name | Value |
|---- | -----|
| LLM | &quot;LLM&quot; |
| MCP | &quot;MCP&quot; |
| HTTP | &quot;HTTP&quot; |



