# PermissionsPutRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**subject_type** | **str** |  | 
**subject_id** | **str** |  | 
**resource_type** | **str** |  | 
**resource** | **str** |  | 
**access** | **List[str]** |  | 

## Example

```python
from node_flow_client.models.permissions_put_request import PermissionsPutRequest

# TODO update the JSON string below
json = "{}"
# create an instance of PermissionsPutRequest from a JSON string
permissions_put_request_instance = PermissionsPutRequest.from_json(json)
# print the JSON string representation of the object
print(PermissionsPutRequest.to_json())

# convert the object into a dict
permissions_put_request_dict = permissions_put_request_instance.to_dict()
# create an instance of PermissionsPutRequest from a dict
permissions_put_request_from_dict = PermissionsPutRequest.from_dict(permissions_put_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


