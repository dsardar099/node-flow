# TaskAppendLogsRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**workflow_id** | **str** |  | 
**lease_token** | **str** |  | 
**logs** | [**List[TaskAppendLogsRequestLogsInner]**](TaskAppendLogsRequestLogsInner.md) |  | 

## Example

```python
from node_flow_client.models.task_append_logs_request import TaskAppendLogsRequest

# TODO update the JSON string below
json = "{}"
# create an instance of TaskAppendLogsRequest from a JSON string
task_append_logs_request_instance = TaskAppendLogsRequest.from_json(json)
# print the JSON string representation of the object
print(TaskAppendLogsRequest.to_json())

# convert the object into a dict
task_append_logs_request_dict = task_append_logs_request_instance.to_dict()
# create an instance of TaskAppendLogsRequest from a dict
task_append_logs_request_from_dict = TaskAppendLogsRequest.from_dict(task_append_logs_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


