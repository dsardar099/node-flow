# ExecutionRerunRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**from_task_ref** | **str** |  | 

## Example

```python
from node_flow_client.models.execution_rerun_request import ExecutionRerunRequest

# TODO update the JSON string below
json = "{}"
# create an instance of ExecutionRerunRequest from a JSON string
execution_rerun_request_instance = ExecutionRerunRequest.from_json(json)
# print the JSON string representation of the object
print(ExecutionRerunRequest.to_json())

# convert the object into a dict
execution_rerun_request_dict = execution_rerun_request_instance.to_dict()
# create an instance of ExecutionRerunRequest from a dict
execution_rerun_request_from_dict = ExecutionRerunRequest.from_dict(execution_rerun_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


