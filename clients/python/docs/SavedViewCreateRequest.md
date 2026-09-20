# SavedViewCreateRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**page** | **str** |  | 
**name** | **str** |  | 
**state** | **Dict[str, object]** |  | 
**shared** | **bool** |  | [optional] 

## Example

```python
from node_flow_client.models.saved_view_create_request import SavedViewCreateRequest

# TODO update the JSON string below
json = "{}"
# create an instance of SavedViewCreateRequest from a JSON string
saved_view_create_request_instance = SavedViewCreateRequest.from_json(json)
# print the JSON string representation of the object
print(SavedViewCreateRequest.to_json())

# convert the object into a dict
saved_view_create_request_dict = saved_view_create_request_instance.to_dict()
# create an instance of SavedViewCreateRequest from a dict
saved_view_create_request_from_dict = SavedViewCreateRequest.from_dict(saved_view_create_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


