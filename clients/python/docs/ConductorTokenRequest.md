# ConductorTokenRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**key_id** | **str** |  | 
**key_secret** | **str** |  | 

## Example

```python
from node_flow_client.models.conductor_token_request import ConductorTokenRequest

# TODO update the JSON string below
json = "{}"
# create an instance of ConductorTokenRequest from a JSON string
conductor_token_request_instance = ConductorTokenRequest.from_json(json)
# print the JSON string representation of the object
print(ConductorTokenRequest.to_json())

# convert the object into a dict
conductor_token_request_dict = conductor_token_request_instance.to_dict()
# create an instance of ConductorTokenRequest from a dict
conductor_token_request_from_dict = ConductorTokenRequest.from_dict(conductor_token_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


