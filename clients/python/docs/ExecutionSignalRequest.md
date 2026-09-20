# ExecutionSignalRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**status** | **str** |  | [optional] [default to 'COMPLETED']
**output** | **Dict[str, object]** |  | [optional] 
**reason** | **str** |  | [optional] 
**task_ref** | **str** |  | [optional] 
**wait_for_seconds** | **float** |  | [optional] 

## Example

```python
from node_flow_client.models.execution_signal_request import ExecutionSignalRequest

# TODO update the JSON string below
json = "{}"
# create an instance of ExecutionSignalRequest from a JSON string
execution_signal_request_instance = ExecutionSignalRequest.from_json(json)
# print the JSON string representation of the object
print(ExecutionSignalRequest.to_json())

# convert the object into a dict
execution_signal_request_dict = execution_signal_request_instance.to_dict()
# create an instance of ExecutionSignalRequest from a dict
execution_signal_request_from_dict = ExecutionSignalRequest.from_dict(execution_signal_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


