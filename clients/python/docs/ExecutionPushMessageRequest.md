# ExecutionPushMessageRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**payload** | **Dict[str, object]** |  | 

## Example

```python
from node_flow_client.models.execution_push_message_request import ExecutionPushMessageRequest

# TODO update the JSON string below
json = "{}"
# create an instance of ExecutionPushMessageRequest from a JSON string
execution_push_message_request_instance = ExecutionPushMessageRequest.from_json(json)
# print the JSON string representation of the object
print(ExecutionPushMessageRequest.to_json())

# convert the object into a dict
execution_push_message_request_dict = execution_push_message_request_instance.to_dict()
# create an instance of ExecutionPushMessageRequest from a dict
execution_push_message_request_from_dict = ExecutionPushMessageRequest.from_dict(execution_push_message_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


