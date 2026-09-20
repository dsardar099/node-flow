# IntegrationPutRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**kind** | **str** |  | 
**provider** | **str** |  | 
**description** | **str** |  | [optional] 
**base_url** | **str** |  | [optional] 
**api_key_secret** | **str** |  | [optional] 
**models** | **List[str]** |  | [optional] 
**config** | **Dict[str, object]** |  | [optional] 
**enabled** | **bool** |  | [optional] 

## Example

```python
from node_flow_client.models.integration_put_request import IntegrationPutRequest

# TODO update the JSON string below
json = "{}"
# create an instance of IntegrationPutRequest from a JSON string
integration_put_request_instance = IntegrationPutRequest.from_json(json)
# print the JSON string representation of the object
print(IntegrationPutRequest.to_json())

# convert the object into a dict
integration_put_request_dict = integration_put_request_instance.to_dict()
# create an instance of IntegrationPutRequest from a dict
integration_put_request_from_dict = IntegrationPutRequest.from_dict(integration_put_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


