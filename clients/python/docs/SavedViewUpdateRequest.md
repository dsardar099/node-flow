# SavedViewUpdateRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** |  | [optional] 
**state** | **Dict[str, object]** |  | [optional] 
**shared** | **bool** |  | [optional] 

## Example

```python
from node_flow_client.models.saved_view_update_request import SavedViewUpdateRequest

# TODO update the JSON string below
json = "{}"
# create an instance of SavedViewUpdateRequest from a JSON string
saved_view_update_request_instance = SavedViewUpdateRequest.from_json(json)
# print the JSON string representation of the object
print(SavedViewUpdateRequest.to_json())

# convert the object into a dict
saved_view_update_request_dict = saved_view_update_request_instance.to_dict()
# create an instance of SavedViewUpdateRequest from a dict
saved_view_update_request_from_dict = SavedViewUpdateRequest.from_dict(saved_view_update_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


