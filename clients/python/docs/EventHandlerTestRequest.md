# EventHandlerTestRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**payload** | **Dict[str, object]** |  | 
**key** | **str** |  | [optional] 

## Example

```python
from node_flow_client.models.event_handler_test_request import EventHandlerTestRequest

# TODO update the JSON string below
json = "{}"
# create an instance of EventHandlerTestRequest from a JSON string
event_handler_test_request_instance = EventHandlerTestRequest.from_json(json)
# print the JSON string representation of the object
print(EventHandlerTestRequest.to_json())

# convert the object into a dict
event_handler_test_request_dict = event_handler_test_request_instance.to_dict()
# create an instance of EventHandlerTestRequest from a dict
event_handler_test_request_from_dict = EventHandlerTestRequest.from_dict(event_handler_test_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


