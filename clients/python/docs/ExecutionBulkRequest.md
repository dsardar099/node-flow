# ExecutionBulkRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**workflow_ids** | **List[str]** |  | 
**reason** | **str** |  | [optional] 

## Example

```python
from node_flow_client.models.execution_bulk_request import ExecutionBulkRequest

# TODO update the JSON string below
json = "{}"
# create an instance of ExecutionBulkRequest from a JSON string
execution_bulk_request_instance = ExecutionBulkRequest.from_json(json)
# print the JSON string representation of the object
print(ExecutionBulkRequest.to_json())

# convert the object into a dict
execution_bulk_request_dict = execution_bulk_request_instance.to_dict()
# create an instance of ExecutionBulkRequest from a dict
execution_bulk_request_from_dict = ExecutionBulkRequest.from_dict(execution_bulk_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


