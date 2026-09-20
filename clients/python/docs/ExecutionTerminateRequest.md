# ExecutionTerminateRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**reason** | **str** |  | [optional] [default to 'operator request']

## Example

```python
from node_flow_client.models.execution_terminate_request import ExecutionTerminateRequest

# TODO update the JSON string below
json = "{}"
# create an instance of ExecutionTerminateRequest from a JSON string
execution_terminate_request_instance = ExecutionTerminateRequest.from_json(json)
# print the JSON string representation of the object
print(ExecutionTerminateRequest.to_json())

# convert the object into a dict
execution_terminate_request_dict = execution_terminate_request_instance.to_dict()
# create an instance of ExecutionTerminateRequest from a dict
execution_terminate_request_from_dict = ExecutionTerminateRequest.from_dict(execution_terminate_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


