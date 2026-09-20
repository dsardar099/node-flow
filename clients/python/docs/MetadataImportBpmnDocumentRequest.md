# MetadataImportBpmnDocumentRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**xml** | **str** |  | 
**process_id** | **str** |  | [optional] 

## Example

```python
from node_flow_client.models.metadata_import_bpmn_document_request import MetadataImportBpmnDocumentRequest

# TODO update the JSON string below
json = "{}"
# create an instance of MetadataImportBpmnDocumentRequest from a JSON string
metadata_import_bpmn_document_request_instance = MetadataImportBpmnDocumentRequest.from_json(json)
# print the JSON string representation of the object
print(MetadataImportBpmnDocumentRequest.to_json())

# convert the object into a dict
metadata_import_bpmn_document_request_dict = metadata_import_bpmn_document_request_instance.to_dict()
# create an instance of MetadataImportBpmnDocumentRequest from a dict
metadata_import_bpmn_document_request_from_dict = MetadataImportBpmnDocumentRequest.from_dict(metadata_import_bpmn_document_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


