# ExecutionSkipTaskRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**task_ref** | **str** |  | 

## Example

```python
from node_flow_client.models.execution_skip_task_request import ExecutionSkipTaskRequest

# TODO update the JSON string below
json = "{}"
# create an instance of ExecutionSkipTaskRequest from a JSON string
execution_skip_task_request_instance = ExecutionSkipTaskRequest.from_json(json)
# print the JSON string representation of the object
print(ExecutionSkipTaskRequest.to_json())

# convert the object into a dict
execution_skip_task_request_dict = execution_skip_task_request_instance.to_dict()
# create an instance of ExecutionSkipTaskRequest from a dict
execution_skip_task_request_from_dict = ExecutionSkipTaskRequest.from_dict(execution_skip_task_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


