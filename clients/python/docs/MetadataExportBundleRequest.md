# MetadataExportBundleRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**workflows** | **List[str]** |  | [optional] 
**versions** | **str** |  | [optional] 
**include_dependencies** | **bool** |  | [optional] 

## Example

```python
from node_flow_client.models.metadata_export_bundle_request import MetadataExportBundleRequest

# TODO update the JSON string below
json = "{}"
# create an instance of MetadataExportBundleRequest from a JSON string
metadata_export_bundle_request_instance = MetadataExportBundleRequest.from_json(json)
# print the JSON string representation of the object
print(MetadataExportBundleRequest.to_json())

# convert the object into a dict
metadata_export_bundle_request_dict = metadata_export_bundle_request_instance.to_dict()
# create an instance of MetadataExportBundleRequest from a dict
metadata_export_bundle_request_from_dict = MetadataExportBundleRequest.from_dict(metadata_export_bundle_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


