# MetadataRegisterWorkflowRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** |  | 
**version** | **int** |  | [optional] [default to 1]
**description** | **str** |  | [optional] 
**tasks** | [**List[Shared2d711327d8]**](Shared2d711327d8.md) |  | 
**input_parameters** | **List[str]** |  | [optional] 
**output_parameters** | **Dict[str, object]** |  | [optional] 
**variables** | **Dict[str, object]** |  | [optional] 
**input_schema** | **object** |  | [optional] 
**output_schema** | **object** |  | [optional] 
**failure_workflow** | **str** |  | [optional] 
**failure_workflow_version** | **int** |  | [optional] 
**restartable** | **bool** |  | [optional] [default to True]
**timeout_seconds** | **float** |  | [optional] [default to 0]
**timeout_policy** | **str** |  | [optional] [default to 'TIME_OUT_WF']
**max_concurrent_executions** | **int** |  | [optional] [default to 0]
**rate_limit_config** | [**MetadataRegisterWorkflowRequestRateLimitConfig**](MetadataRegisterWorkflowRequestRateLimitConfig.md) |  | [optional] 
**masked_fields** | **List[str]** |  | [optional] 
**max_concurrent_tasks** | **int** |  | [optional] [default to 0]
**owner_email** | **str** |  | [optional] 
**tags** | **List[str]** |  | [optional] [default to []]

## Example

```python
from node_flow_client.models.metadata_register_workflow_request import MetadataRegisterWorkflowRequest

# TODO update the JSON string below
json = "{}"
# create an instance of MetadataRegisterWorkflowRequest from a JSON string
metadata_register_workflow_request_instance = MetadataRegisterWorkflowRequest.from_json(json)
# print the JSON string representation of the object
print(MetadataRegisterWorkflowRequest.to_json())

# convert the object into a dict
metadata_register_workflow_request_dict = metadata_register_workflow_request_instance.to_dict()
# create an instance of MetadataRegisterWorkflowRequest from a dict
metadata_register_workflow_request_from_dict = MetadataRegisterWorkflowRequest.from_dict(metadata_register_workflow_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


