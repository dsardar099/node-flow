

# IncomingWebhookCreateRequest


## Properties

| Name | Type | Description | Notes |
|------------ | ------------- | ------------- | -------------|
|**name** | **String** |  |  |
|**description** | **String** |  |  [optional] |
|**verifier** | [**VerifierEnum**](#VerifierEnum) |  |  |
|**config** | [**IncomingWebhookCreateRequestConfig**](IncomingWebhookCreateRequestConfig.md) |  |  [optional] |
|**secretName** | **String** |  |  [optional] |
|**enabled** | **Boolean** |  |  [optional] |



## Enum: VerifierEnum

| Name | Value |
|---- | -----|
| GITHUB | &quot;GITHUB&quot; |
| STRIPE | &quot;STRIPE&quot; |
| SLACK | &quot;SLACK&quot; |
| SHOPIFY | &quot;SHOPIFY&quot; |
| HMAC | &quot;HMAC&quot; |
| HEADER | &quot;HEADER&quot; |
| NONE | &quot;NONE&quot; |



