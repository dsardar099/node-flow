# IncomingWebhookCreateRequestConfig


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**header** | **str** |  | [optional] 
**algorithm** | **str** |  | [optional] 
**encoding** | **str** |  | [optional] 
**prefix** | **str** |  | [optional] 

## Example

```python
from node_flow_client.models.incoming_webhook_create_request_config import IncomingWebhookCreateRequestConfig

# TODO update the JSON string below
json = "{}"
# create an instance of IncomingWebhookCreateRequestConfig from a JSON string
incoming_webhook_create_request_config_instance = IncomingWebhookCreateRequestConfig.from_json(json)
# print the JSON string representation of the object
print(IncomingWebhookCreateRequestConfig.to_json())

# convert the object into a dict
incoming_webhook_create_request_config_dict = incoming_webhook_create_request_config_instance.to_dict()
# create an instance of IncomingWebhookCreateRequestConfig from a dict
incoming_webhook_create_request_config_from_dict = IncomingWebhookCreateRequestConfig.from_dict(incoming_webhook_create_request_config_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


