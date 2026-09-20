# SimulationTestRequestMocksValue


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**status** | **str** |  | 
**output** | **Dict[str, object]** |  | [optional] 
**reason** | **str** |  | [optional] 

## Example

```python
from node_flow_client.models.simulation_test_request_mocks_value import SimulationTestRequestMocksValue

# TODO update the JSON string below
json = "{}"
# create an instance of SimulationTestRequestMocksValue from a JSON string
simulation_test_request_mocks_value_instance = SimulationTestRequestMocksValue.from_json(json)
# print the JSON string representation of the object
print(SimulationTestRequestMocksValue.to_json())

# convert the object into a dict
simulation_test_request_mocks_value_dict = simulation_test_request_mocks_value_instance.to_dict()
# create an instance of SimulationTestRequestMocksValue from a dict
simulation_test_request_mocks_value_from_dict = SimulationTestRequestMocksValue.from_dict(simulation_test_request_mocks_value_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


