# ConductorUpdateTaskRequestLogsInner


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**log** | **str** |  | 
**created_time** | **float** |  | [optional] 

## Example

```python
from node_flow_client.models.conductor_update_task_request_logs_inner import ConductorUpdateTaskRequestLogsInner

# TODO update the JSON string below
json = "{}"
# create an instance of ConductorUpdateTaskRequestLogsInner from a JSON string
conductor_update_task_request_logs_inner_instance = ConductorUpdateTaskRequestLogsInner.from_json(json)
# print the JSON string representation of the object
print(ConductorUpdateTaskRequestLogsInner.to_json())

# convert the object into a dict
conductor_update_task_request_logs_inner_dict = conductor_update_task_request_logs_inner_instance.to_dict()
# create an instance of ConductorUpdateTaskRequestLogsInner from a dict
conductor_update_task_request_logs_inner_from_dict = ConductorUpdateTaskRequestLogsInner.from_dict(conductor_update_task_request_logs_inner_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


