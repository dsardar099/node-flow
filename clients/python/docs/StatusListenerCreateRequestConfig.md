# StatusListenerCreateRequestConfig


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**url** | **str** |  | 
**secret_name** | **str** |  | [optional] 
**headers** | **Dict[str, str]** |  | [optional] 
**cluster** | **str** |  | 
**topic** | **str** |  | 
**connection** | **str** |  | 
**destination** | **str** |  | 

## Example

```python
from node_flow_client.models.status_listener_create_request_config import StatusListenerCreateRequestConfig

# TODO update the JSON string below
json = "{}"
# create an instance of StatusListenerCreateRequestConfig from a JSON string
status_listener_create_request_config_instance = StatusListenerCreateRequestConfig.from_json(json)
# print the JSON string representation of the object
print(StatusListenerCreateRequestConfig.to_json())

# convert the object into a dict
status_listener_create_request_config_dict = status_listener_create_request_config_instance.to_dict()
# create an instance of StatusListenerCreateRequestConfig from a dict
status_listener_create_request_config_from_dict = StatusListenerCreateRequestConfig.from_dict(status_listener_create_request_config_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


