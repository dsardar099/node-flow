# StatusListenerUpdateRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**description** | **str** |  | [optional] 
**enabled** | **bool** |  | [optional] 
**workflow_names** | **List[str]** |  | [optional] 
**events** | **List[str]** |  | [optional] 
**sink** | **str** |  | 
**config** | [**StatusListenerCreateRequestConfig**](StatusListenerCreateRequestConfig.md) |  | 
**include_output** | **bool** |  | [optional] 

## Example

```python
from node_flow_client.models.status_listener_update_request import StatusListenerUpdateRequest

# TODO update the JSON string below
json = "{}"
# create an instance of StatusListenerUpdateRequest from a JSON string
status_listener_update_request_instance = StatusListenerUpdateRequest.from_json(json)
# print the JSON string representation of the object
print(StatusListenerUpdateRequest.to_json())

# convert the object into a dict
status_listener_update_request_dict = status_listener_update_request_instance.to_dict()
# create an instance of StatusListenerUpdateRequest from a dict
status_listener_update_request_from_dict = StatusListenerUpdateRequest.from_dict(status_listener_update_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


