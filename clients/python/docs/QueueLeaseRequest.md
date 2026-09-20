# QueueLeaseRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**worker_id** | **str** |  | 
**count** | **int** |  | [optional] [default to 1]
**lease_seconds** | **int** |  | [optional] 
**wait_seconds** | **int** |  | [optional] 

## Example

```python
from node_flow_client.models.queue_lease_request import QueueLeaseRequest

# TODO update the JSON string below
json = "{}"
# create an instance of QueueLeaseRequest from a JSON string
queue_lease_request_instance = QueueLeaseRequest.from_json(json)
# print the JSON string representation of the object
print(QueueLeaseRequest.to_json())

# convert the object into a dict
queue_lease_request_dict = queue_lease_request_instance.to_dict()
# create an instance of QueueLeaseRequest from a dict
queue_lease_request_from_dict = QueueLeaseRequest.from_dict(queue_lease_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


