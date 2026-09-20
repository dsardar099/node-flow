# IncomingWebhookCreateRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** |  | 
**description** | **str** |  | [optional] 
**verifier** | **str** |  | 
**config** | [**IncomingWebhookCreateRequestConfig**](IncomingWebhookCreateRequestConfig.md) |  | [optional] 
**secret_name** | **str** |  | [optional] 
**enabled** | **bool** |  | [optional] 

## Example

```python
from node_flow_client.models.incoming_webhook_create_request import IncomingWebhookCreateRequest

# TODO update the JSON string below
json = "{}"
# create an instance of IncomingWebhookCreateRequest from a JSON string
incoming_webhook_create_request_instance = IncomingWebhookCreateRequest.from_json(json)
# print the JSON string representation of the object
print(IncomingWebhookCreateRequest.to_json())

# convert the object into a dict
incoming_webhook_create_request_dict = incoming_webhook_create_request_instance.to_dict()
# create an instance of IncomingWebhookCreateRequest from a dict
incoming_webhook_create_request_from_dict = IncomingWebhookCreateRequest.from_dict(incoming_webhook_create_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


