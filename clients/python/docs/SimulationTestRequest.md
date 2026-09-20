# SimulationTestRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**definition** | **Dict[str, object]** |  | [optional] 
**name** | **str** |  | [optional] 
**version** | **int** |  | [optional] 
**input** | **Dict[str, object]** |  | [optional] 
**variables** | **Dict[str, object]** |  | [optional] 
**mocks** | [**Dict[str, SimulationTestRequestMocksValue]**](SimulationTestRequestMocksValue.md) |  | [optional] 
**run_pure_tasks** | **bool** |  | [optional] [default to True]

## Example

```python
from node_flow_client.models.simulation_test_request import SimulationTestRequest

# TODO update the JSON string below
json = "{}"
# create an instance of SimulationTestRequest from a JSON string
simulation_test_request_instance = SimulationTestRequest.from_json(json)
# print the JSON string representation of the object
print(SimulationTestRequest.to_json())

# convert the object into a dict
simulation_test_request_dict = simulation_test_request_instance.to_dict()
# create an instance of SimulationTestRequest from a dict
simulation_test_request_from_dict = SimulationTestRequest.from_dict(simulation_test_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


