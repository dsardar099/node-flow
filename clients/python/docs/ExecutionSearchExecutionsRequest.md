# ExecutionSearchExecutionsRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**status** | **List[str]** |  | [optional] 
**def_name** | **str** |  | [optional] 
**def_version** | **int** |  | [optional] 
**correlation_id** | **str** |  | [optional] 
**workflow_id** | **str** |  | [optional] 
**idempotency_key** | **str** |  | [optional] 
**exclude_sub_workflows** | **bool** |  | [optional] 
**started_after** | **datetime** |  | [optional] 
**started_before** | **datetime** |  | [optional] 
**finished** | **bool** |  | [optional] 
**limit** | **int** |  | [optional] 
**cursor** | **str** |  | [optional] 
**q** | **str** |  | [optional] 

## Example

```python
from node_flow_client.models.execution_search_executions_request import ExecutionSearchExecutionsRequest

# TODO update the JSON string below
json = "{}"
# create an instance of ExecutionSearchExecutionsRequest from a JSON string
execution_search_executions_request_instance = ExecutionSearchExecutionsRequest.from_json(json)
# print the JSON string representation of the object
print(ExecutionSearchExecutionsRequest.to_json())

# convert the object into a dict
execution_search_executions_request_dict = execution_search_executions_request_instance.to_dict()
# create an instance of ExecutionSearchExecutionsRequest from a dict
execution_search_executions_request_from_dict = ExecutionSearchExecutionsRequest.from_dict(execution_search_executions_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


