# MetadataImportBundleRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**bundle** | **Dict[str, object]** |  | 
**workflow_conflicts** | **str** |  | [optional] 
**task_definition_conflicts** | **str** |  | [optional] 
**dry_run** | **bool** |  | [optional] 

## Example

```python
from node_flow_client.models.metadata_import_bundle_request import MetadataImportBundleRequest

# TODO update the JSON string below
json = "{}"
# create an instance of MetadataImportBundleRequest from a JSON string
metadata_import_bundle_request_instance = MetadataImportBundleRequest.from_json(json)
# print the JSON string representation of the object
print(MetadataImportBundleRequest.to_json())

# convert the object into a dict
metadata_import_bundle_request_dict = metadata_import_bundle_request_instance.to_dict()
# create an instance of MetadataImportBundleRequest from a dict
metadata_import_bundle_request_from_dict = MetadataImportBundleRequest.from_dict(metadata_import_bundle_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


