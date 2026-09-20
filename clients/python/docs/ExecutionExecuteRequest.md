# ExecutionExecuteRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**version** | **int** |  | [optional] 
**input** | **Dict[str, object]** |  | [optional] 
**task_to_domain** | **Dict[str, str]** |  | [optional] 
**correlation_id** | **str** |  | [optional] 
**idempotency_key** | **str** |  | [optional] 
**idempotency_strategy** | **str** |  | [optional] 
**priority** | **int** |  | [optional] 
**variables** | **Dict[str, object]** |  | [optional] 
**wait_for_seconds** | **float** |  | [optional] [default to 10]
**wait_until_task_ref** | **str** |  | [optional] 

## Example

```python
from node_flow_client.models.execution_execute_request import ExecutionExecuteRequest

# TODO update the JSON string below
json = "{}"
# create an instance of ExecutionExecuteRequest from a JSON string
execution_execute_request_instance = ExecutionExecuteRequest.from_json(json)
# print the JSON string representation of the object
print(ExecutionExecuteRequest.to_json())

# convert the object into a dict
execution_execute_request_dict = execution_execute_request_instance.to_dict()
# create an instance of ExecutionExecuteRequest from a dict
execution_execute_request_from_dict = ExecutionExecuteRequest.from_dict(execution_execute_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


