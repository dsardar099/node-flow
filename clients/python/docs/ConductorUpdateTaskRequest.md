# ConductorUpdateTaskRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**workflow_instance_id** | **str** |  | 
**task_id** | **str** |  | 
**status** | **str** |  | 
**output_data** | **Dict[str, object]** |  | [optional] 
**reason_for_incompletion** | **str** |  | [optional] 
**worker_id** | **str** |  | [optional] 
**callback_after_seconds** | **int** |  | [optional] 
**logs** | [**List[ConductorUpdateTaskRequestLogsInner]**](ConductorUpdateTaskRequestLogsInner.md) |  | [optional] 

## Example

```python
from node_flow_client.models.conductor_update_task_request import ConductorUpdateTaskRequest

# TODO update the JSON string below
json = "{}"
# create an instance of ConductorUpdateTaskRequest from a JSON string
conductor_update_task_request_instance = ConductorUpdateTaskRequest.from_json(json)
# print the JSON string representation of the object
print(ConductorUpdateTaskRequest.to_json())

# convert the object into a dict
conductor_update_task_request_dict = conductor_update_task_request_instance.to_dict()
# create an instance of ConductorUpdateTaskRequest from a dict
conductor_update_task_request_from_dict = ConductorUpdateTaskRequest.from_dict(conductor_update_task_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


