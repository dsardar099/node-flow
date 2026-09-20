# VectorIndexSearchRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**llm_provider** | **str** |  | 
**embedding_model** | **str** |  | [optional] 
**query** | **str** |  | 
**top_k** | **int** |  | [optional] 
**min_score** | **float** |  | [optional] 

## Example

```python
from node_flow_client.models.vector_index_search_request import VectorIndexSearchRequest

# TODO update the JSON string below
json = "{}"
# create an instance of VectorIndexSearchRequest from a JSON string
vector_index_search_request_instance = VectorIndexSearchRequest.from_json(json)
# print the JSON string representation of the object
print(VectorIndexSearchRequest.to_json())

# convert the object into a dict
vector_index_search_request_dict = vector_index_search_request_instance.to_dict()
# create an instance of VectorIndexSearchRequest from a dict
vector_index_search_request_from_dict = VectorIndexSearchRequest.from_dict(vector_index_search_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


