# TaskReportRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**queue_name** | **str** |  | 
**workflow_id** | **str** |  | 
**lease_token** | **str** |  | 
**status** | **str** |  | 
**output** | **Dict[str, object]** |  | [optional] 
**reason** | **str** |  | [optional] 

## Example

```python
from node_flow_client.models.task_report_request import TaskReportRequest

# TODO update the JSON string below
json = "{}"
# create an instance of TaskReportRequest from a JSON string
task_report_request_instance = TaskReportRequest.from_json(json)
# print the JSON string representation of the object
print(TaskReportRequest.to_json())

# convert the object into a dict
task_report_request_dict = task_report_request_instance.to_dict()
# create an instance of TaskReportRequest from a dict
task_report_request_from_dict = TaskReportRequest.from_dict(task_report_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


