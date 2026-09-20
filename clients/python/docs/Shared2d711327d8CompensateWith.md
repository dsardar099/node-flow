# Shared2d711327d8CompensateWith


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** |  | 
**task_reference_name** | **str** |  | 
**type** | **str** |  | 
**description** | **str** |  | [optional] 
**input_parameters** | **Dict[str, object]** |  | [optional] 
**optional** | **bool** |  | [optional] 
**async_complete** | **bool** |  | [optional] 
**start_delay_seconds** | **float** |  | [optional] 
**cache_config** | [**Shared2d711327d8CacheConfig**](Shared2d711327d8CacheConfig.md) |  | [optional] 
**retry_count** | **int** |  | [optional] 
**domain** | **str** |  | [optional] 
**evaluator_type** | **str** |  | [optional] 
**expression** | **str** |  | [optional] 
**decision_cases** | **Dict[str, List[Shared2d711327d8]]** |  | [optional] 
**default_case** | [**List[Shared2d711327d8]**](Shared2d711327d8.md) |  | [optional] 
**fork_tasks** | **List[List[Shared2d711327d8]]** |  | [optional] 
**dynamic_fork_tasks_param** | **str** |  | [optional] 
**dynamic_fork_tasks_input_param_name** | **str** |  | [optional] 
**join_on** | **List[str]** |  | [optional] 
**loop_condition** | **str** |  | [optional] 
**loop_over** | [**List[Shared2d711327d8]**](Shared2d711327d8.md) |  | [optional] 
**dynamic_task_name_param** | **str** |  | [optional] 
**sub_workflow_param** | [**Shared2d711327d8SubWorkflowParam**](Shared2d711327d8SubWorkflowParam.md) |  | [optional] 
**compensate_with** | [**Shared2d711327d8CompensateWith**](Shared2d711327d8CompensateWith.md) |  | [optional] 

## Example

```python
from node_flow_client.models.shared2d711327d8_compensate_with import Shared2d711327d8CompensateWith

# TODO update the JSON string below
json = "{}"
# create an instance of Shared2d711327d8CompensateWith from a JSON string
shared2d711327d8_compensate_with_instance = Shared2d711327d8CompensateWith.from_json(json)
# print the JSON string representation of the object
print(Shared2d711327d8CompensateWith.to_json())

# convert the object into a dict
shared2d711327d8_compensate_with_dict = shared2d711327d8_compensate_with_instance.to_dict()
# create an instance of Shared2d711327d8CompensateWith from a dict
shared2d711327d8_compensate_with_from_dict = Shared2d711327d8CompensateWith.from_dict(shared2d711327d8_compensate_with_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


