# ConductorStartWorkflowRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** |  | 
**version** | **int** |  | [optional] 
**input** | **Dict[str, object]** |  | [optional] 
**correlation_id** | **str** |  | [optional] 
**task_to_domain** | **Dict[str, str]** |  | [optional] 
**priority** | **int** |  | [optional] 
**idempotency_key** | **str** |  | [optional] 

## Example

```python
from node_flow_client.models.conductor_start_workflow_request import ConductorStartWorkflowRequest

# TODO update the JSON string below
json = "{}"
# create an instance of ConductorStartWorkflowRequest from a JSON string
conductor_start_workflow_request_instance = ConductorStartWorkflowRequest.from_json(json)
# print the JSON string representation of the object
print(ConductorStartWorkflowRequest.to_json())

# convert the object into a dict
conductor_start_workflow_request_dict = conductor_start_workflow_request_instance.to_dict()
# create an instance of ConductorStartWorkflowRequest from a dict
conductor_start_workflow_request_from_dict = ConductorStartWorkflowRequest.from_dict(conductor_start_workflow_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


