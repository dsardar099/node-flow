# TaskHeartbeatRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**queue_name** | **str** |  | 
**lease_token** | **str** |  | 
**lease_seconds** | **int** |  | [optional] 

## Example

```python
from node_flow_client.models.task_heartbeat_request import TaskHeartbeatRequest

# TODO update the JSON string below
json = "{}"
# create an instance of TaskHeartbeatRequest from a JSON string
task_heartbeat_request_instance = TaskHeartbeatRequest.from_json(json)
# print the JSON string representation of the object
print(TaskHeartbeatRequest.to_json())

# convert the object into a dict
task_heartbeat_request_dict = task_heartbeat_request_instance.to_dict()
# create an instance of TaskHeartbeatRequest from a dict
task_heartbeat_request_from_dict = TaskHeartbeatRequest.from_dict(task_heartbeat_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


