# StatusListenerCreateRequestConfigAnyOf


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**url** | **str** |  | 
**secret_name** | **str** |  | [optional] 
**headers** | **Dict[str, str]** |  | [optional] 

## Example

```python
from node_flow_client.models.status_listener_create_request_config_any_of import StatusListenerCreateRequestConfigAnyOf

# TODO update the JSON string below
json = "{}"
# create an instance of StatusListenerCreateRequestConfigAnyOf from a JSON string
status_listener_create_request_config_any_of_instance = StatusListenerCreateRequestConfigAnyOf.from_json(json)
# print the JSON string representation of the object
print(StatusListenerCreateRequestConfigAnyOf.to_json())

# convert the object into a dict
status_listener_create_request_config_any_of_dict = status_listener_create_request_config_any_of_instance.to_dict()
# create an instance of StatusListenerCreateRequestConfigAnyOf from a dict
status_listener_create_request_config_any_of_from_dict = StatusListenerCreateRequestConfigAnyOf.from_dict(status_listener_create_request_config_any_of_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


