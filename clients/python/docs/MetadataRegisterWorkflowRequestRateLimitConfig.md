# MetadataRegisterWorkflowRequestRateLimitConfig


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**rate_limit_key** | **str** |  | 
**concurrent_exec_limit** | **int** |  | 

## Example

```python
from node_flow_client.models.metadata_register_workflow_request_rate_limit_config import MetadataRegisterWorkflowRequestRateLimitConfig

# TODO update the JSON string below
json = "{}"
# create an instance of MetadataRegisterWorkflowRequestRateLimitConfig from a JSON string
metadata_register_workflow_request_rate_limit_config_instance = MetadataRegisterWorkflowRequestRateLimitConfig.from_json(json)
# print the JSON string representation of the object
print(MetadataRegisterWorkflowRequestRateLimitConfig.to_json())

# convert the object into a dict
metadata_register_workflow_request_rate_limit_config_dict = metadata_register_workflow_request_rate_limit_config_instance.to_dict()
# create an instance of MetadataRegisterWorkflowRequestRateLimitConfig from a dict
metadata_register_workflow_request_rate_limit_config_from_dict = MetadataRegisterWorkflowRequestRateLimitConfig.from_dict(metadata_register_workflow_request_rate_limit_config_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


