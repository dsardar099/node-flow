# MetadataSetWorkflowTagsRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**tags** | **List[str]** |  | 

## Example

```python
from node_flow_client.models.metadata_set_workflow_tags_request import MetadataSetWorkflowTagsRequest

# TODO update the JSON string below
json = "{}"
# create an instance of MetadataSetWorkflowTagsRequest from a JSON string
metadata_set_workflow_tags_request_instance = MetadataSetWorkflowTagsRequest.from_json(json)
# print the JSON string representation of the object
print(MetadataSetWorkflowTagsRequest.to_json())

# convert the object into a dict
metadata_set_workflow_tags_request_dict = metadata_set_workflow_tags_request_instance.to_dict()
# create an instance of MetadataSetWorkflowTagsRequest from a dict
metadata_set_workflow_tags_request_from_dict = MetadataSetWorkflowTagsRequest.from_dict(metadata_set_workflow_tags_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


