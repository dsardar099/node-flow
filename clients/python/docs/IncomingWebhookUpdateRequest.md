# IncomingWebhookUpdateRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**description** | **str** |  | [optional] 
**verifier** | **str** |  | 
**config** | [**IncomingWebhookCreateRequestConfig**](IncomingWebhookCreateRequestConfig.md) |  | [optional] 
**secret_name** | **str** |  | [optional] 
**enabled** | **bool** |  | [optional] 

## Example

```python
from node_flow_client.models.incoming_webhook_update_request import IncomingWebhookUpdateRequest

# TODO update the JSON string below
json = "{}"
# create an instance of IncomingWebhookUpdateRequest from a JSON string
incoming_webhook_update_request_instance = IncomingWebhookUpdateRequest.from_json(json)
# print the JSON string representation of the object
print(IncomingWebhookUpdateRequest.to_json())

# convert the object into a dict
incoming_webhook_update_request_dict = incoming_webhook_update_request_instance.to_dict()
# create an instance of IncomingWebhookUpdateRequest from a dict
incoming_webhook_update_request_from_dict = IncomingWebhookUpdateRequest.from_dict(incoming_webhook_update_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


