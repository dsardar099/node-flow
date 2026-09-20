# TaskAppendLogsRequestLogsInner


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**message** | **str** |  | 
**level** | **str** |  | [optional] 

## Example

```python
from node_flow_client.models.task_append_logs_request_logs_inner import TaskAppendLogsRequestLogsInner

# TODO update the JSON string below
json = "{}"
# create an instance of TaskAppendLogsRequestLogsInner from a JSON string
task_append_logs_request_logs_inner_instance = TaskAppendLogsRequestLogsInner.from_json(json)
# print the JSON string representation of the object
print(TaskAppendLogsRequestLogsInner.to_json())

# convert the object into a dict
task_append_logs_request_logs_inner_dict = task_append_logs_request_logs_inner_instance.to_dict()
# create an instance of TaskAppendLogsRequestLogsInner from a dict
task_append_logs_request_logs_inner_from_dict = TaskAppendLogsRequestLogsInner.from_dict(task_append_logs_request_logs_inner_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


