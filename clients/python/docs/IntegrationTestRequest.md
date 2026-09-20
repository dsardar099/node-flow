# IntegrationTestRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**model** | **str** |  | [optional] 

## Example

```python
from node_flow_client.models.integration_test_request import IntegrationTestRequest

# TODO update the JSON string below
json = "{}"
# create an instance of IntegrationTestRequest from a JSON string
integration_test_request_instance = IntegrationTestRequest.from_json(json)
# print the JSON string representation of the object
print(IntegrationTestRequest.to_json())

# convert the object into a dict
integration_test_request_dict = integration_test_request_instance.to_dict()
# create an instance of IntegrationTestRequest from a dict
integration_test_request_from_dict = IntegrationTestRequest.from_dict(integration_test_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


