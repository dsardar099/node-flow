# ExecutionStartRequest


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

## Example

```python
from node_flow_client.models.execution_start_request import ExecutionStartRequest

# TODO update the JSON string below
json = "{}"
# create an instance of ExecutionStartRequest from a JSON string
execution_start_request_instance = ExecutionStartRequest.from_json(json)
# print the JSON string representation of the object
print(ExecutionStartRequest.to_json())

# convert the object into a dict
execution_start_request_dict = execution_start_request_instance.to_dict()
# create an instance of ExecutionStartRequest from a dict
execution_start_request_from_dict = ExecutionStartRequest.from_dict(execution_start_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


