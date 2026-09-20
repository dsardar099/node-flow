# VectorIndexAddRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**llm_provider** | **str** |  | 
**embedding_model** | **str** |  | [optional] 
**doc_id** | **str** |  | 
**text** | **str** |  | 
**metadata** | **Dict[str, object]** |  | [optional] 
**chunk_size** | **int** |  | [optional] 
**chunk_overlap** | **int** |  | [optional] 

## Example

```python
from node_flow_client.models.vector_index_add_request import VectorIndexAddRequest

# TODO update the JSON string below
json = "{}"
# create an instance of VectorIndexAddRequest from a JSON string
vector_index_add_request_instance = VectorIndexAddRequest.from_json(json)
# print the JSON string representation of the object
print(VectorIndexAddRequest.to_json())

# convert the object into a dict
vector_index_add_request_dict = vector_index_add_request_instance.to_dict()
# create an instance of VectorIndexAddRequest from a dict
vector_index_add_request_from_dict = VectorIndexAddRequest.from_dict(vector_index_add_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


